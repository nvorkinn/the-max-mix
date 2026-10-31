import { useEffect, useState, useSyncExternalStore } from 'react';
import { X, Bug, RotateCw, Trash2 } from 'lucide-react';
import { clearDebugLog, getDebugEntries, subscribeDebugLog } from '../utils/debugLog';
import type { DebugEntry } from '../utils/debugLog';
import { widevineProblem } from '../utils/widevine';

/** Set by vite.config.ts at build time; tests and other tooling run without it. */
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

export type DebugStatus = readonly (readonly [label: string, value: string])[];

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function EntryRow({ entry }: Readonly<{ entry: DebugEntry }>) {
  return (
    <li className={`debug-entry debug-entry-${entry.level}`}>
      <span className="debug-entry-time">{formatTime(entry.lastTime)}</span>
      <span className="debug-entry-source">{entry.source}</span>
      <span className="debug-entry-message">
        {entry.message}
        {entry.count > 1 && (
          <span className="debug-entry-count">
            {' '}
            ×{entry.count} since {formatTime(entry.time)}
          </span>
        )}
      </span>
    </li>
  );
}

/** Asks the browser whether Widevine works each time the console opens; the answer can change after an update. */
function useWidevineStatus(): string {
  const [status, setStatus] = useState('Checking…');
  useEffect(() => {
    let cancelled = false;
    widevineProblem()
      .then(problem => {
        if (!cancelled) setStatus(problem ?? 'Available');
      })
      .catch(() => {
        if (!cancelled) setStatus('Could not check');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

function DebugConsolePanel({
  onClose,
  status,
  onReload
}: Readonly<{ onClose: () => void; status: DebugStatus; onReload: () => void }>) {
  const entries = useSyncExternalStore(subscribeDebugLog, getDebugEntries);
  const widevine = useWidevineStatus();
  const rows: DebugStatus = [
    ['Version', APP_VERSION],
    ...status,
    ['Widevine', widevine],
    ['Browser', navigator.userAgent]
  ];

  return (
    <div className="debug-console-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="debug-console-title" className="debug-console">
        <header className="debug-console-header">
          <Bug size={16} aria-hidden="true" />
          <h2 id="debug-console-title">Debug console</h2>
          <div className="debug-console-actions">
            <button type="button" onClick={clearDebugLog} disabled={entries.length === 0}>
              <Trash2 size={14} aria-hidden="true" /> Clear log
            </button>
            <button type="button" onClick={onReload}>
              <RotateCw size={14} aria-hidden="true" /> Reload page
            </button>
            <button type="button" onClick={onClose} aria-label="Close debug console" className="debug-console-close">
              <X size={16} />
            </button>
          </div>
        </header>
        <dl className="debug-status">
          {rows.map(([label, value]) => (
            <div key={label} className={value.length > 40 ? 'debug-status-wide' : undefined}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {entries.length === 0 ? (
          <p className="debug-empty">Nothing logged since the page loaded.</p>
        ) : (
          <ol className="debug-log" aria-label="Log, newest first">
            {entries.toReversed().map(entry => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

const reloadPage = () => location.reload();

/** A full-screen view of the app's state and recent log, opened by a hidden gesture on the kiosk. */
export default function DebugConsole({
  isOpen,
  onClose,
  status,
  onReload = reloadPage
}: Readonly<{ isOpen: boolean; onClose: () => void; status: DebugStatus; onReload?: () => void }>) {
  return isOpen ? <DebugConsolePanel onClose={onClose} status={status} onReload={onReload} /> : null;
}
