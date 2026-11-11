import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Speaker, Users, Volume2 } from 'lucide-react';
import { getGroupVolume, listSonos, pauseGroup, setGroupRooms, setGroupVolume, spotifyDeviceFor } from '../sonos/api';
import type { SonosGroup, SonosRoom } from '../sonos/api';
import type { SpotifyDevice } from '../types';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

/** How long to wait after the last slider move before sending the volume, so a drag sends a few requests, not dozens. */
const VOLUME_DELAY_MS = 250;

/** What a one-room card says under its name: on the kiosk the Pi plays to it; elsewhere whether Spotify can. */
function note(throughKiosk: boolean, device: SpotifyDevice | undefined): string {
  if (throughKiosk) return 'Sonos';
  return device ? 'Ready in Spotify' : 'Not in Spotify yet';
}

/**
 * The Sonos groups from the Sonos login, one card each. On the kiosk a tap plays the song on screen there through the
 * Pi (onPlayOnSonos, with the room that leads the group); elsewhere it plays there through Spotify Connect, so a group
 * can be picked only while Spotify knows its speaker. Each card holds the group's volume, which can be moved only while the
 * group plays, and a Rooms button that shows every room as a switch to add it to the group or take it out.
 */
export default function SonosGroupList({
  devices,
  playingId,
  disabled,
  onSelect,
  onPlayOnSonos,
  onRooms
}: Readonly<{
  /** Spotify's Connect devices, read by the drawer. */
  devices: readonly SpotifyDevice[];
  playingId?: string | null | undefined;
  disabled: boolean;
  onSelect: (deviceId: string) => unknown;
  /** The kiosk: plays the song on screen on this Sonos room (sonoscli on the Pi); rejects with a message to show. */
  onPlayOnSonos?: ((room: string) => Promise<void>) | undefined;
  /** The names of the rooms (and groups) listed, so the drawer can leave out Connect devices that are the same speaker. */
  onRooms?: ((names: readonly string[]) => void) | undefined;
}>) {
  const [groups, setGroups] = useState<SonosGroup[] | null>(null);
  const [rooms, setRooms] = useState<SonosRoom[]>([]);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The group whose rooms are shown, and whether a change to them is being sent.
  const [editing, setEditing] = useState<string | null>(null);
  const [regrouping, setRegrouping] = useState(false);
  // The group the kiosk is starting the song on (sonoscli can take several seconds to find the speaker).
  const [starting, setStarting] = useState<string | null>(null);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mountedRef = useRef(true);
  const isMounted = () => mountedRef.current;
  const onRoomsRef = useRef(onRooms);
  useEffect(() => {
    onRoomsRef.current = onRooms;
  });

  const load = useCallback(async () => {
    try {
      const found = await listSonos();
      if (!mountedRef.current) return;
      setGroups(found.groups);
      setRooms(found.rooms);
      onRoomsRef.current?.([...found.rooms, ...found.groups].map(entry => entry.name));
      setError(null);
      const read = await Promise.all(
        found.groups.map(async group => [group.id, await getGroupVolume(group.id).catch(() => null)] as const)
      );
      if (!isMounted()) return;
      setVolumes(Object.fromEntries(read.filter((entry): entry is [string, number] => entry[1] !== null)));
    } catch (caught) {
      if (mountedRef.current) setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const pending = timersRef.current;
    return () => {
      mountedRef.current = false;
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, [load]);

  const changeVolume = (group: SonosGroup, volume: number) => {
    setVolumes(current => ({ ...current, [group.id]: volume }));
    clearTimeout(timersRef.current.get(group.id));
    timersRef.current.set(
      group.id,
      setTimeout(() => {
        setGroupVolume(group.id, volume).catch((caught: unknown) => setError(errorMessage(caught)));
      }, VOLUME_DELAY_MS)
    );
  };

  const toggleRoom = async (group: SonosGroup, room: SonosRoom) => {
    const next = group.playerIds.includes(room.id)
      ? group.playerIds.filter(id => id !== room.id)
      : [...group.playerIds, room.id];
    setRegrouping(true);
    try {
      await setGroupRooms(group.id, next);
      // The group may come back under a new id; keep its rooms open by finding it through its coordinator.
      const coordinator = group.playerIds[0];
      await load();
      setEditing(current => (current === group.id ? `player:${coordinator}` : current));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRegrouping(false);
    }
  };

  const playOnSonos = async (group: SonosGroup, play: (room: string) => Promise<void>) => {
    setNotice(null);
    setError(null);
    setStarting(group.id);
    try {
      await pauseOtherGroups(group);
      await play(group.rooms[0] ?? group.name);
      await load();
    } catch (caught) {
      if (isMounted()) setError(errorMessage(caught));
    } finally {
      if (isMounted()) setStarting(null);
    }
  };

  // The song plays on one Sonos group at a time: a group that is playing is paused before another one starts, so
  // tapping a second speaker moves the music instead of starting it again in two places. To play in several rooms,
  // group them first (the Rooms button).
  const pauseOtherGroups = async (group: SonosGroup) => {
    const { groups: current } = await listSonos();
    const leader = group.playerIds[0];
    const others = current.filter(other => other.playing && other.playerIds[0] !== leader);
    await Promise.all(
      others.map(other =>
        pauseGroup(other.id).catch((caught: unknown) => {
          debugLog('warn', 'sonos', `Could not pause ${other.name}: ${errorMessage(caught)}`);
        })
      )
    );
  };

  const select = (group: SonosGroup) => {
    if (onPlayOnSonos) {
      void playOnSonos(group, onPlayOnSonos);
      return;
    }
    const device = spotifyDeviceFor(group, devices);
    if (device?.id) {
      setNotice(null);
      void onSelect(device.id);
      return;
    }
    setNotice(
      `Spotify can't see ${group.name} yet. Play to it once from the Spotify app on a phone, then refresh and try again.`
    );
  };

  const isEditing = (group: SonosGroup) => editing === group.id || editing === `player:${group.playerIds[0]}`;

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-xs status-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs status-warning">
          {notice}
        </p>
      )}
      {groups?.length === 0 && (
        <p className="text-xs text-muted py-2">No Sonos speakers found on this Sonos account.</p>
      )}
      {groups?.map(group => {
        const device = spotifyDeviceFor(group, devices);
        const playing = onPlayOnSonos ? group.playing : Boolean(device?.id) && device?.id === playingId;
        const active = playing || group.playing;
        const volume = volumes[group.id];
        const members = group.rooms.length > 1 ? group.rooms.join(', ') : null;
        const open = isEditing(group);
        const householdRooms = rooms.filter(room => room.householdId === group.householdId);
        return (
          <div key={group.id} className="modal-card rounded-xl border">
            <div className="flex items-center">
              <button
                type="button"
                aria-pressed={playing}
                disabled={disabled || starting !== null}
                onClick={() => select(group)}
                className="flex-1 min-w-0 p-3 flex gap-3 items-center text-left rounded-xl"
              >
                <Speaker size={20} className="shrink-0 text-accent" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{group.name}</span>
                  <span className="text-[11px] text-muted">
                    {starting === group.id ? 'Starting the song…' : (members ?? note(Boolean(onPlayOnSonos), device))}
                  </span>
                </span>
                {active && (
                  <span className="text-xs text-accent flex items-center gap-1">
                    <Check size={14} /> Playing
                  </span>
                )}
              </button>
              {householdRooms.length > 1 && (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`Group rooms with ${group.name}`}
                  onClick={() => setEditing(open ? null : group.id)}
                  className="modal-icon-button w-11 h-11 mr-1.5 rounded-full flex items-center justify-center shrink-0"
                >
                  <Users size={16} />
                </button>
              )}
            </div>
            {volume !== undefined && (
              <label className="speaker-volume pb-3">
                <Volume2 size={16} aria-hidden="true" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  disabled={!active}
                  aria-label={`${group.name} volume`}
                  title={active ? undefined : 'Volume can be changed while this speaker plays'}
                  onChange={event => changeVolume(group, Number(event.target.value))}
                  className="range-control volume-range"
                  style={{ '--range-progress': `${volume}%` } as CSSProperties}
                />
              </label>
            )}
            {open && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-3" role="group" aria-label={`Rooms in ${group.name}`}>
                {householdRooms.map(room => {
                  const leader = room.id === group.playerIds[0];
                  return (
                    <button
                      type="button"
                      key={room.id}
                      aria-pressed={group.playerIds.includes(room.id)}
                      // The room that leads the group stays in it; ungroup the others instead.
                      disabled={leader || regrouping}
                      onClick={() => void toggleRoom(group, room)}
                      className="modal-option min-h-11 px-3 rounded-xl border text-xs font-bold"
                    >
                      {room.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
