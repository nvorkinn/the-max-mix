import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Check, Speaker } from 'lucide-react';
import {
  controlSonos,
  findSonosOnPi,
  getKioskSonosLeader,
  getSonosNow,
  joinSonosGroup,
  leaveSonosGroup,
  setKioskSonosLeader,
  setSonosVolume,
  subscribeKioskSonosLeader,
  watchSonosOnPi
} from '../sonos/kiosk';
import type { PiSonosGroup, PiSonosRoom } from '../sonos/kiosk';
import { SAFE_START_VOLUME } from '../audio/safeVolume';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
/** After a room joins or leaves, the list is read again this often until Sonos shows the change, at most CONFIRM_READS times. */
const CONFIRM_MS = 1000;
const CONFIRM_READS = 4;

/** Turns the room's group down to SAFE_START_VOLUME when it is louder, before music starts on it. */
async function turnDown(room: string): Promise<void> {
  const { volume } = await getSonosNow(room).catch(() => ({ volume: null }));
  if (volume !== null && volume > SAFE_START_VOLUME) await setSonosVolume(room, SAFE_START_VOLUME);
}

/** The rooms in the kiosk's group: the leading room's group as the Pi last found it, with the changes Sonos may not show yet. */
function kioskRooms(
  leader: string | null,
  groups: readonly PiSonosGroup[] | null,
  pending: Readonly<Record<string, boolean>>
): Set<string> {
  if (!leader) return new Set();
  const group = groups?.find(entry => entry.rooms.some(room => room.name === leader));
  const rooms = new Set(group?.rooms.map(room => room.name) ?? [leader]);
  for (const [name, isIn] of Object.entries(pending)) {
    if (isIn) rooms.add(name);
    else rooms.delete(name);
  }
  return rooms;
}

/** Forgets the pending changes the groups now show. */
function settle(
  setPending: Dispatch<SetStateAction<Record<string, boolean>>>,
  leader: string | null,
  groups: readonly PiSonosGroup[]
): void {
  const shown = kioskRooms(leader, groups, {});
  setPending(current => {
    const left = Object.entries(current).filter(([name, isIn]) => shown.has(name) !== isIn);
    return left.length === Object.keys(current).length ? current : Object.fromEntries(left);
  });
}

/**
 * The kiosk's Sonos rooms, one card each, found by the Pi on the home network. The rooms the kiosk plays on are selected. Tapping another room starts the song
 * on screen there (onPlayOnSonos, through the Pi) or, while the kiosk's group plays, adds the room to that group so the
 * song carries on there too. Tapping a selected room takes it out of the group; the last one is paused instead, and the
 * tablet follows Spotify again. Sonos takes a moment to show a room joining or leaving, so the change shows at once and
 * the list is read again until Sonos agrees. It is also read again whenever the Pi says the rooms' grouping changed.
 */
export default function SonosKioskList({
  disabled,
  onPlayOnSonos,
  onRooms
}: Readonly<{
  disabled: boolean;
  /** Plays the song on screen on this Sonos room (through the Pi); rejects with a message to show. */
  onPlayOnSonos: (room: string) => Promise<void>;
  /** The names of the rooms listed, so the drawer can leave out Connect devices that are the same speaker. */
  onRooms?: ((names: readonly string[]) => void) | undefined;
}>) {
  const leader = useSyncExternalStore(subscribeKioskSonosLeader, getKioskSonosLeader);
  const [groups, setGroups] = useState<PiSonosGroup[] | null>(null);
  // Rooms the kiosk has added (true) or taken out (false) that the list from the Pi may not show yet.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  // The room being started, added or taken out (the Pi and Sonos can take several seconds).
  const [busy, setBusy] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const isMounted = () => mountedRef.current;
  const onRoomsRef = useRef(onRooms);
  useEffect(() => {
    onRoomsRef.current = onRooms;
  });

  /** Reads the rooms from the Pi; the groups, or null when that failed (the reason is shown). */
  const load = useCallback(async (): Promise<PiSonosGroup[] | null> => {
    const started = performance.now();
    try {
      const { groups: list, ms } = await findSonosOnPi();
      if (!isMounted()) return null;
      const names = list.flatMap(group => group.rooms.map(room => room.name));
      debugLog(
        'info',
        'sonos',
        `Found ${names.length} Sonos ${names.length === 1 ? 'room' : 'rooms'} in ${seconds(ms)} ` +
          `(${seconds(performance.now() - started)} with the trip to the Pi).`
      );
      setGroups(list);
      settle(setPending, getKioskSonosLeader(), list);
      setError(null);
      onRoomsRef.current?.(names);
      return list;
    } catch (caught) {
      if (!isMounted()) return null;
      const text = errorMessage(caught);
      debugLog('warn', 'sonos', `Finding the Sonos rooms failed: ${text}`);
      setError(text);
      return null;
    }
  }, []);

  // Reads the list again until Sonos shows the rooms the kiosk added or took out; then trusts what Sonos says.
  const confirm = async (changes: Record<string, boolean>, reads = CONFIRM_READS): Promise<void> => {
    if (!isMounted()) return;
    if (reads === 0) {
      setPending({});
      return;
    }
    await new Promise(resolve => setTimeout(resolve, CONFIRM_MS));
    const list = await load();
    const shown = list && kioskRooms(getKioskSonosLeader(), list, {});
    if (shown && Object.entries(changes).every(([name, isIn]) => shown.has(name) === isIn)) return;
    await confirm(changes, reads - 1);
  };

  useEffect(() => {
    mountedRef.current = true;
    void load();
    // Rooms joined or left, here or in the Sonos app: the Pi says so, and the list is read again.
    const stopWatching = watchSonosOnPi(change => {
      if (change === 'groups') void load();
    });
    return () => {
      mountedRef.current = false;
      stopWatching();
    };
  }, [load]);

  // While the kiosk's group plays, a new room joins it; otherwise the song starts on the room, which then leads.
  // Returns the change Sonos may not show yet, if any.
  const startOrJoin = async (room: PiSonosRoom): Promise<Record<string, boolean> | null> => {
    const current = getKioskSonosLeader();
    const status = current ? await getSonosNow(current) : null;
    await turnDown(room.name);
    if (current && status?.playing) {
      await joinSonosGroup(room.name, current);
      return { [room.name]: true };
    }
    await onPlayOnSonos(room.name);
    setKioskSonosLeader(room.name);
    setPending({});
    return null;
  };

  // A room taken out of the kiosk's group plays on its own; the last room is paused and the tablet lets it go.
  const takeOut = async (room: PiSonosRoom, rest: readonly string[]): Promise<Record<string, boolean> | null> => {
    if (rest.length === 0) {
      setKioskSonosLeader(null);
      setPending({});
      await controlSonos(room.name, 'pause');
      return null;
    }
    await leaveSonosGroup(room.name);
    if (room.name === getKioskSonosLeader()) setKioskSonosLeader(rest[0] ?? null);
    return { [room.name]: false };
  };

  const selected = kioskRooms(leader, groups, pending);

  const toggle = async (room: PiSonosRoom) => {
    setBusy(room.id);
    setError(null);
    let changes: Record<string, boolean> | null;
    try {
      const rest = [...selected].filter(name => name !== room.name);
      changes = await (selected.has(room.name) ? takeOut(room, rest) : startOrJoin(room));
    } catch (caught) {
      if (isMounted()) setError(errorMessage(caught));
      return;
    } finally {
      if (isMounted()) setBusy(null);
    }
    if (!changes) {
      await load();
      return;
    }
    const done = changes;
    setPending(current => ({ ...current, ...done }));
    await confirm(done);
  };

  const rooms = (groups ?? [])
    .flatMap(group => group.rooms.map(room => ({ room, group })))
    .toSorted((a, b) => a.room.name.localeCompare(b.room.name));

  return (
    <div className="contents">
      {error && (
        <p role="alert" className="col-span-full text-xs status-danger">
          {error}
        </p>
      )}
      {groups === null && !error && (
        <p className="col-span-full text-xs text-muted py-2">Looking for Sonos speakers…</p>
      )}
      {groups?.length === 0 && (
        <p className="col-span-full text-xs text-muted py-2">No Sonos speakers found on this network.</p>
      )}
      {rooms.map(({ room, group }) => {
        const isSelected = selected.has(room.name);
        const others = group.rooms.filter(other => other.id !== room.id).map(other => other.name);
        let note = isSelected ? 'Tap to take it out' : 'Sonos';
        if (!isSelected && others.length > 0) note = `Grouped with ${others.join(', ')}`;
        if (busy === room.id) note = 'One moment…';
        return (
          <button
            type="button"
            key={room.id}
            aria-pressed={isSelected}
            disabled={disabled || busy !== null}
            onClick={() => void toggle(room)}
            className="modal-option w-full px-3 py-2 flex gap-3 items-center text-left rounded-xl border"
          >
            <Speaker size={20} className="shrink-0 text-accent" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm truncate">{room.name}</span>
              <span className="text-[11px] text-muted">{note}</span>
            </span>
            {isSelected && (
              <span className="text-xs text-accent flex items-center gap-1">
                <Check size={14} /> Selected
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
