import { useCallback, useEffect, useState } from 'react';
import { Bluetooth, Check, Search } from 'lucide-react';
import {
  connectBluetoothSpeaker,
  forgetBluetoothSpeaker,
  listBluetoothSpeakers,
  scanBluetoothSpeakers
} from '../audio/bluetooth';
import type { BluetoothSpeaker } from '../audio/bluetooth';
import { errorMessage } from '../utils/errorMessage';

function statusOf(speaker: BluetoothSpeaker): string {
  if (speaker.connected) return 'Connected';
  return speaker.paired ? 'Paired, not connected' : 'Not paired';
}

const actionOf = (speaker: BluetoothSpeaker): string => (speaker.paired ? 'Connect' : 'Pair');

/**
 * Pairs Bluetooth speakers through the Pi's audio service. A connected speaker shows up on the AirPlay tab like
 * any other speaker, where it is chosen and its volume is set; this section only finds, connects and forgets them.
 */
export default function BluetoothSpeakers() {
  const [speakers, setSpeakers] = useState<BluetoothSpeaker[] | null>(null);
  // What the service is doing: 'scan', or the address it is connecting.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (task: string, work: () => Promise<BluetoothSpeaker[]>) => {
    setBusy(task);
    setError(null);
    try {
      setSpeakers(await work());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void run('list', () => listBluetoothSpeakers());
  }, [run]);

  const connect = (address: string) =>
    run(address, async () => {
      await connectBluetoothSpeaker(address);
      return listBluetoothSpeakers();
    });
  const forget = (address: string) =>
    run(address, async () => {
      await forgetBluetoothSpeaker(address);
      return listBluetoothSpeakers();
    });

  return (
    <div className="grid gap-2">
      {error && (
        <p role="alert" className="col-span-full text-xs status-danger">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void run('scan', () => scanBluetoothSpeakers())}
        disabled={busy !== null}
        className="col-span-full button-secondary w-full p-2.5 rounded-xl flex gap-2 items-center justify-center text-sm"
      >
        <Search size={16} aria-hidden="true" />
        {busy === 'scan' ? 'Looking for speakers…' : 'Find speakers'}
      </button>
      {speakers?.length === 0 && busy === null && (
        <p className="col-span-full text-xs leading-relaxed text-muted">
          No Bluetooth speakers yet. Put the speaker in pairing mode, then tap Find speakers.
        </p>
      )}
      {speakers?.map(speaker => (
        <div key={speaker.address} className="modal-option w-full px-3 py-2 flex gap-3 items-center rounded-xl border">
          <Bluetooth size={20} className="shrink-0 text-accent" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm truncate">{speaker.name}</span>
            <span className="text-[11px] text-muted">{statusOf(speaker)}</span>
          </span>
          {speaker.connected && (
            <span className="text-xs text-accent flex items-center gap-1">
              <Check size={14} /> Ready
            </span>
          )}
          {!speaker.connected && (
            <button
              type="button"
              onClick={() => void connect(speaker.address)}
              disabled={busy !== null}
              aria-label={`${actionOf(speaker)} ${speaker.name}`}
              className="button-secondary px-3 py-2 rounded-lg text-xs"
            >
              {busy === speaker.address ? 'Connecting…' : actionOf(speaker)}
            </button>
          )}
          {speaker.paired && (
            <button
              type="button"
              onClick={() => void forget(speaker.address)}
              disabled={busy !== null}
              aria-label={`Forget ${speaker.name}`}
              className="button-secondary px-3 py-2 rounded-lg text-xs"
            >
              Forget
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
