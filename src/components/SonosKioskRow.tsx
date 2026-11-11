import { useEffect, useState } from 'react';
import { listSonos } from '../sonos/api';
import { getSonosEngine, setSonosEngine, testOnSonosRoom } from '../sonos/kiosk';
import type { SonosEngine, SonosTest } from '../sonos/kiosk';
import { debugLog } from '../utils/debugLog';
import { errorMessage } from '../utils/errorMessage';

const ENGINES: { id: SonosEngine; label: string }[] = [
  { id: 'cli', label: 'sonoscli' },
  { id: 'library', label: 'sonos-ts' }
];
const TESTS: { id: SonosTest; label: string }[] = [
  { id: 'library-queue', label: 'SwitchToQueue' },
  { id: 'cli-play', label: 'sonos play' }
];

/**
 * On the kiosk, signed in to Sonos: which way the Pi plays a song on a Sonos (sonoscli or the sonos-ts library), and two
 * calls to try on a room that only resume what the speaker has, without naming a song: sonos-ts's SwitchToQueue() then
 * Play(), and `sonos play`. What each did is written here and to the debug console.
 */
export default function SonosKioskRow() {
  const [engine, setEngine] = useState(getSonosEngine);
  const [rooms, setRooms] = useState<string[]>([]);
  const [room, setRoom] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    listSonos()
      .then(found => {
        if (!live) return;
        const names = found.rooms.map(entry => entry.name);
        setRooms(names);
        setRoom(current => current ?? names[0] ?? null);
      })
      .catch((caught: unknown) => {
        if (live) setResult({ ok: false, text: errorMessage(caught) });
      });
    return () => {
      live = false;
    };
  }, []);

  const choose = (next: SonosEngine) => {
    setSonosEngine(next);
    setEngine(next);
  };

  const run = async (test: (typeof TESTS)[number]) => {
    if (!room) return;
    setRunning(true);
    setResult(null);
    try {
      await testOnSonosRoom(room, test.id);
      const text = `${test.label} on ${room}: done. Listen to the speaker to hear what it did.`;
      debugLog('info', 'sonos', text);
      setResult({ ok: true, text });
    } catch (caught) {
      const text = `${test.label} on ${room}: ${errorMessage(caught)}`;
      debugLog('warn', 'sonos', text);
      setResult({ ok: false, text });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-card p-3 rounded-2xl border">
      <div className="text-xs font-bold" id="sonos-engine-label">
        Play to Sonos with
      </div>
      <div className="flex gap-1.5 mt-2" role="group" aria-labelledby="sonos-engine-label">
        {ENGINES.map(choice => (
          <button
            type="button"
            key={choice.id}
            aria-pressed={engine === choice.id}
            onClick={() => choose(choice.id)}
            className="modal-option flex-1 min-h-11 rounded-xl border text-xs font-bold"
          >
            {choice.label}
          </button>
        ))}
      </div>
      <div className="text-xs font-bold mt-3" id="sonos-test-label">
        Try resuming a Sonos without a song
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2" role="group" aria-label="Sonos room to try">
        {rooms.map(name => (
          <button
            type="button"
            key={name}
            aria-pressed={room === name}
            onClick={() => setRoom(name)}
            className="modal-option min-h-11 px-3 rounded-xl border text-xs font-bold"
          >
            {name}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2" role="group" aria-labelledby="sonos-test-label">
        {TESTS.map(test => (
          <button
            type="button"
            key={test.id}
            disabled={!room || running}
            onClick={() => void run(test)}
            className="button button-secondary flex-1"
          >
            {test.label}
          </button>
        ))}
      </div>
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={`mt-2 text-xs ${result.ok ? 'text-muted' : 'status-danger'}`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
