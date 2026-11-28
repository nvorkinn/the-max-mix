// The volume of the Sonos rooms that play along with this tablet. They take the tablet's sound at full Spotify volume
// (useSpeakerSelection.ts), so while they play, the tablet's volume slider moves their group's volume instead.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSonosNow, setSonosVolume, watchSonosOnPi } from '../sonos/kiosk';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

/** A slider moves often; the group's volume is set once it rests this long. */
const VOLUME_DELAY_MS = 250;

/** The group volume of the rooms `room` leads (null while unknown or without a room), and how to set it. */
export function useAlongVolume(room: string | null) {
  const [reading, setReading] = useState<{ room: string; volume: number | null } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!room) return;
    let isCancelled = false;
    const read = () =>
      getSonosNow(room)
        .then(now => {
          if (!isCancelled) setReading({ room, volume: now.volume });
        })
        .catch((caught: unknown) => {
          debugLog('warn', 'sonos', `Reading ${room}'s volume failed: ${errorMessage(caught)}`);
        });
    void read();
    const stop = watchSonosOnPi(change => {
      if (change === 'now') void read();
    });
    return () => {
      isCancelled = true;
      stop();
      clearTimeout(timerRef.current);
    };
  }, [room]);

  const setVolume = useCallback(
    (level: number) => {
      if (!room) return;
      setReading({ room, volume: level });
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setSonosVolume(room, level).catch((caught: unknown) => {
          debugLog('warn', 'sonos', `Setting ${room}'s volume failed: ${errorMessage(caught)}`);
        });
      }, VOLUME_DELAY_MS);
    },
    [room]
  );

  return { volume: room && reading?.room === room ? reading.volume : null, setVolume };
}
