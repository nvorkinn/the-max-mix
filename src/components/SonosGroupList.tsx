import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Speaker, Volume2 } from 'lucide-react';
import { getGroupVolume, listSonosGroups, setGroupVolume, spotifyDeviceFor } from '../sonos/api';
import type { SonosGroup } from '../sonos/api';
import type { SpotifyDevice } from '../types';
import { errorMessage } from '../utils/errorMessage';

/** How long to wait after the last slider move before sending the volume, so a drag sends a few requests, not dozens. */
const VOLUME_DELAY_MS = 250;

/**
 * The Sonos groups from the Sonos login. A tap plays there through Spotify Connect, so a group can be picked only while
 * Spotify lists its speaker. Each group has a volume slider that sets the whole group's volume through Sonos.
 */
export default function SonosGroupList({
  devices,
  playingId,
  disabled,
  onSelect
}: Readonly<{
  /** Spotify's Connect devices, read by the drawer. */
  devices: readonly SpotifyDevice[];
  playingId?: string | null | undefined;
  disabled: boolean;
  onSelect: (deviceId: string) => unknown;
}>) {
  const [groups, setGroups] = useState<SonosGroup[] | null>(null);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void (async () => {
      try {
        const found = await listSonosGroups();
        if (isCancelled()) return;
        setGroups(found);
        setError(null);
        const read = await Promise.all(
          found.map(async group => [group.id, await getGroupVolume(group.id).catch(() => null)] as const)
        );
        if (isCancelled()) return;
        setVolumes(Object.fromEntries(read.filter((entry): entry is [string, number] => entry[1] !== null)));
      } catch (caught) {
        if (!isCancelled()) setError(errorMessage(caught));
      }
    })();
    const pending = timersRef.current;
    return () => {
      cancelled = true;
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

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

  const select = (group: SonosGroup) => {
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
        const playing = Boolean(device?.id) && device?.id === playingId;
        const volume = volumes[group.id];
        const rooms = group.rooms.length > 1 ? group.rooms.join(', ') : null;
        return (
          <div key={group.id}>
            <button
              type="button"
              aria-pressed={playing}
              disabled={disabled}
              onClick={() => select(group)}
              className="modal-option w-full p-3 flex gap-3 items-center text-left rounded-xl border"
            >
              <Speaker size={20} className="shrink-0 text-accent" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{group.name}</span>
                <span className="text-[11px] text-muted">
                  {rooms ?? (device ? 'Ready in Spotify' : 'Not in Spotify yet')}
                </span>
              </span>
              {playing && (
                <span className="text-xs text-accent flex items-center gap-1">
                  <Check size={14} /> Playing
                </span>
              )}
            </button>
            {volume !== undefined && (
              <label className="speaker-volume">
                <Volume2 size={16} aria-hidden="true" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  aria-label={`${group.name} volume`}
                  onChange={event => changeVolume(group, Number(event.target.value))}
                  className="range-control volume-range"
                  style={{ '--range-progress': `${volume}%` } as CSSProperties}
                />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
