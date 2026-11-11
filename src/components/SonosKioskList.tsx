import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Check, Speaker } from 'lucide-react';
import {
  controlSonos,
  findSonosOnPi,
  getKioskSonosLeader,
  getSonosEngine,
  getSonosNow,
  joinSonosGroup,
  leaveSonosGroup,
  setKioskSonosLeader,
  setSonosVolume,
  subscribeKioskSonosLeader
} from '../sonos/kiosk';
import type { PiSonosGroup, PiSonosRoom } from '../sonos/kiosk';
import { SAFE_START_VOLUME } from '../audio/safeVolume';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

const ENGINE_NAMES = { cli: 'sonoscli', library: 'sonos-ts' } as const;

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Turns the room's group down to SAFE_START_VOLUME when it is louder, before music starts on it. */
async function turnDown(room: string): Promise<void> {
  const { volume } = await getSonosNow(room).catch(() => ({ volume: null }));
  if (volume !== null && volume > SAFE_START_VOLUME) await setSonosVolume(room, SAFE_START_VOLUME);
}

/**
 * The kiosk's Sonos rooms, one card each, found by the Pi on the home network (sonoscli or sonos-ts, as picked in
 * Settings), with how long that took. The rooms the kiosk plays on are selected. Tapping another room starts the song
 * on screen there (onPlayOnSonos, through the Pi) or, while the kiosk's group plays, adds the room to that group so the
 * song carries on there too. Tapping a selected room takes it out of the group; the last one is paused instead, and the
 * tablet follows Spotify again. Everything goes through the Pi, the same way.
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
  const [engine] = useState(getSonosEngine);
  const [groups, setGroups] = useState<PiSonosGroup[] | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The room being started, added or taken out (the Pi and Sonos can take several seconds).
  const [busy, setBusy] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const isMounted = () => mountedRef.current;
  const onRoomsRef = useRef(onRooms);
  useEffect(() => {
    onRoomsRef.current = onRooms;
  });

  const load = useCallback(async () => {
    const started = performance.now();
    try {
      const { groups: list, ms } = await findSonosOnPi();
      if (!isMounted()) return;
      const names = list.flatMap(group => group.rooms.map(room => room.name));
      const text =
        `Found ${names.length} Sonos ${names.length === 1 ? 'room' : 'rooms'} with ${ENGINE_NAMES[engine]} in ` +
        `${seconds(ms)} (${seconds(performance.now() - started)} with the trip to the Pi).`;
      debugLog('info', 'sonos', text);
      setGroups(list);
      setFound(text);
      setError(null);
      onRoomsRef.current?.(names);
    } catch (caught) {
      if (!isMounted()) return;
      const text = errorMessage(caught);
      debugLog('warn', 'sonos', `Finding the Sonos rooms with ${ENGINE_NAMES[engine]} failed: ${text}`);
      setError(text);
    }
  }, [engine]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // While the kiosk's group plays, a new room joins it; otherwise the song starts on the room.
  const startOrJoin = async (room: PiSonosRoom) => {
    const current = getKioskSonosLeader();
    const status = current ? await getSonosNow(current) : null;
    await turnDown(room.name);
    if (current && status?.playing) {
      await joinSonosGroup(room.name, current);
    } else {
      await onPlayOnSonos(room.name);
      setKioskSonosLeader(room.name);
    }
  };

  // A room taken out of the kiosk's group plays on its own; the last room is paused and the tablet lets it go.
  const takeOut = async (room: PiSonosRoom, rest: readonly string[]) => {
    if (rest.length === 0) {
      setKioskSonosLeader(null);
      await controlSonos(room.name, 'pause');
      return;
    }
    await leaveSonosGroup(room.name);
    if (room.name === getKioskSonosLeader()) setKioskSonosLeader(rest[0] ?? null);
  };

  // The rooms in the group the kiosk leads are selected; until the list shows that group, the leading room alone.
  const kioskGroup = leader ? groups?.find(group => group.rooms.some(room => room.name === leader)) : undefined;
  const selected = new Set(kioskGroup?.rooms.map(room => room.name) ?? (leader ? [leader] : []));

  const toggle = async (room: PiSonosRoom) => {
    setBusy(room.id);
    setError(null);
    try {
      const rest = [...selected].filter(name => name !== room.name);
      await (selected.has(room.name) ? takeOut(room, rest) : startOrJoin(room));
      await load();
    } catch (caught) {
      if (isMounted()) setError(errorMessage(caught));
    } finally {
      if (isMounted()) setBusy(null);
    }
  };

  const rooms = (groups ?? [])
    .flatMap(group => group.rooms.map(room => ({ room, group })))
    .toSorted((a, b) => a.room.name.localeCompare(b.room.name));

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-xs status-danger">
          {error}
        </p>
      )}
      {groups === null && !error && (
        <p className="text-xs text-muted py-2">Looking for Sonos speakers with {ENGINE_NAMES[engine]}…</p>
      )}
      {groups?.length === 0 && <p className="text-xs text-muted py-2">No Sonos speakers found on this network.</p>}
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
            className="modal-option w-full p-3 flex gap-3 items-center text-left rounded-xl border"
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
      {found && <p className="text-[11px] text-muted">{found}</p>}
    </div>
  );
}
