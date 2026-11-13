import { useEffect, useState } from 'react';
import { scanBluetoothSpeakers } from '../audio/bluetooth';
import { pairPhone, readBluetoothReport, setBluetoothVerbose } from '../utils/bluetoothMonitor';
import type { BluetoothReport, PairedDevice, PairingStatus } from '../utils/bluetoothMonitor';
import { errorMessage } from '../utils/errorMessage';

const POLL_MS = 2000;

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const yesNo = (on: boolean) => (on ? 'Yes' : 'No');

function heardAgo(lastSeen: number | null, now: number): string {
  if (lastSeen === null) return '–';
  const seconds = Math.max(0, Math.round((now - lastSeen) / 1000));
  return seconds < 120 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
}

function state(device: PairedDevice): string {
  const parts = [device.connected ? 'Connected' : 'Paired'];
  if (device.bonded) parts.push('bonded');
  if (device.trusted) parts.push('trusted');
  return parts.join(', ');
}

function pairingText(pairing: PairingStatus): string {
  switch (pairing.state) {
    case 'waiting': {
      return `Waiting for a phone, ${pairing.secondsLeft} s left`;
    }
    case 'paired': {
      return `Paired ${pairing.name} (${pairing.address})`;
    }
    case 'failed': {
      return pairing.error;
    }
    default: {
      return 'Not pairing';
    }
  }
}

/** Reads the Pi's Bluetooth report every POLL_MS while `isOpen`. */
function useBluetoothReport(isOpen: boolean) {
  const [report, setReport] = useState<BluetoothReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const read = () => {
      readBluetoothReport()
        .then(next => {
          if (cancelled) return;
          setReport(next);
          setError(null);
          setNow(Date.now());
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(errorMessage(caught));
        });
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOpen]);
  return { report, error, now, setReport };
}

/**
 * The debug console's Bluetooth section on the kiosk: the Pi's adapter, the devices paired with it and when each was
 * last heard, how many unpaired devices are nearby, and the Pi's Bluetooth log. Read only while the section is open.
 */
export default function BluetoothDebug() {
  const [isOpen, setIsOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { report, error, now, setReport } = useBluetoothReport(isOpen);
  const adapter = report?.adapter ?? null;

  const scan = () => {
    setIsScanning(true);
    setActionError(null);
    scanBluetoothSpeakers()
      .catch((caught: unknown) => setActionError(errorMessage(caught)))
      .finally(() => setIsScanning(false));
  };
  const pair = (isStarting: boolean) => {
    setActionError(null);
    pairPhone(isStarting).catch((caught: unknown) => setActionError(errorMessage(caught)));
  };
  const toggleVerbose = (verbose: boolean) => {
    if (report) setReport({ ...report, verbose });
    setBluetoothVerbose(verbose).catch((caught: unknown) => setActionError(errorMessage(caught)));
  };

  return (
    <details className="debug-bluetooth" onToggle={event => setIsOpen(event.currentTarget.open)}>
      <summary>Bluetooth</summary>
      {(error ?? actionError) && <p className="debug-bluetooth-error">{error ?? actionError}</p>}
      {report && (
        <>
          <dl className="debug-status">
            {(
              [
                ['Adapter', adapter ? `${adapter.name} ${adapter.address}` : 'None'],
                ['Powered', adapter ? yesNo(adapter.powered) : '–'],
                ['Scanning', adapter ? yesNo(adapter.discovering) : '–'],
                ['Discoverable', adapter ? yesNo(adapter.discoverable) : '–'],
                ['Pairable', adapter ? yesNo(adapter.pairable) : '–'],
                ['Unpaired nearby', String(report.nearby)],
                ['Pairing', pairingText(report.pairing)]
              ] as const
            ).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="debug-options">
            <label>
              <input type="checkbox" checked={report.verbose} onChange={event => toggleVerbose(event.target.checked)} />
              Log unpaired devices
            </label>
            <button type="button" className="debug-bluetooth-button" onClick={scan} disabled={isScanning}>
              {isScanning ? 'Scanning…' : 'Scan for 8 s'}
            </button>
            <button type="button" className="debug-bluetooth-button" onClick={() => pair(true)}>
              Pair my phone
            </button>
            {report.pairing.state === 'waiting' && (
              <button type="button" className="debug-bluetooth-button" onClick={() => pair(false)}>
                Stop pairing
              </button>
            )}
          </div>
          {report.devices.length === 0 ? (
            <p className="debug-empty">No paired devices.</p>
          ) : (
            <table className="debug-bluetooth-devices">
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">Address</th>
                  <th scope="col">Kind</th>
                  <th scope="col">State</th>
                  <th scope="col">Signal</th>
                  <th scope="col">Heard</th>
                </tr>
              </thead>
              <tbody>
                {report.devices.map(device => (
                  <tr key={device.address}>
                    <td>{device.name}</td>
                    <td>
                      {device.address} {device.addressType}
                    </td>
                    <td>{device.icon || '–'}</td>
                    <td>{state(device)}</td>
                    <td>{device.rssi === null ? '–' : `${device.rssi} dBm`}</td>
                    <td>{heardAgo(device.lastSeen, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ol className="debug-bluetooth-log" aria-label="Bluetooth log, newest first">
            {report.log.toReversed().map(line => (
              <li key={line.id} className="debug-entry">
                <span className="debug-entry-time">{formatTime(line.time)}</span>
                <span className="debug-entry-source">bluez</span>
                <span className="debug-entry-message">{line.message}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}
