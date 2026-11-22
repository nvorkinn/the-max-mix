import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { X, Bug, RotateCw, Trash2, KeyRound, ChevronDown, ChevronRight } from 'lucide-react';
import { forgetDeviceConfig } from '../countdown/config';
import { deviceCredentials, forgetRegistration } from '../countdown/registration';
import { clearDebugLog, getDebugEntries, subscribeDebugLog } from '../utils/debugLog';
import type { DebugEntry } from '../utils/debugLog';
import { getHttpLogMode, getMutedHttpGroups, HTTP_GROUPS, setHttpGroupMuted, setHttpLogMode } from '../utils/httpLog';
import type { HttpLogMode } from '../utils/httpLog';
import { useSpotifyPolling } from '../hooks/useSpotifyPolling';
import { setPollSpotify } from '../spotify/polling';
import { isKiosk } from '../utils/kiosk';
import { widevineProblem } from '../utils/widevine';
import BluetoothDebug from './BluetoothDebug';
import Modal from './Modal';

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

const STATUS_OPEN_KEY = 'maxmix.debugStatusOpen';

/** Whether the status panel was left open last time; storage can be unavailable, which reads as closed. */
function readStatusOpen(): boolean {
  try {
    return localStorage.getItem(STATUS_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveStatusOpen(isOpen: boolean): void {
  try {
    if (isOpen) localStorage.setItem(STATUS_OPEN_KEY, 'true');
    else localStorage.removeItem(STATUS_OPEN_KEY);
  } catch {
    // Not remembered, which only means it opens closed next time.
  }
}

/** A button in the options row that shows or hides a panel below it. */
function ToggleButton({
  isOpen,
  onToggle,
  children
}: Readonly<{ isOpen: boolean; onToggle: () => void; children: ReactNode }>) {
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  return (
    <button type="button" className="debug-toggle" aria-expanded={isOpen} onClick={onToggle}>
      <Chevron size={14} aria-hidden="true" />
      {children}
    </button>
  );
}

/**
 * The options in one row above the log: the status panel's toggle; whether the app reads Spotify on a timer to keep up
 * with changes made elsewhere (unticked, playback is read when the page opens and after each button press only: the
 * way to stop the calls when something makes too many of them); and logging every HTTP call, with or without headers,
 * and which kinds of call to log. The status and the kinds of call open in panels under the row.
 */
function LogOptions({ status }: Readonly<{ status: DebugStatus }>) {
  const { enabled: isPolling, quotaExceeded } = useSpotifyPolling();
  const [isStatusOpen, setIsStatusOpen] = useState(readStatusOpen);
  const [areGroupsOpen, setAreGroupsOpen] = useState(false);
  const [mode, setMode] = useState<HttpLogMode>(getHttpLogMode);
  const [muted, setMuted] = useState(getMutedHttpGroups);
  const toggleStatus = () => {
    saveStatusOpen(!isStatusOpen);
    setIsStatusOpen(!isStatusOpen);
  };
  const change = (next: HttpLogMode) => {
    setMode(next);
    setHttpLogMode(next);
  };
  const toggleGroup = (id: string, isLogged: boolean) => {
    setHttpGroupMuted(id, !isLogged);
    setMuted(getMutedHttpGroups());
  };
  return (
    <>
      <div className="debug-options">
        <ToggleButton isOpen={isStatusOpen} onToggle={toggleStatus}>
          Status
        </ToggleButton>
        <label>
          <input type="checkbox" checked={isPolling} onChange={event => setPollSpotify(event.target.checked)} />
          Poll Spotify for updates
        </label>
        <label>
          <input
            type="checkbox"
            checked={mode !== 'off'}
            onChange={event => change(event.target.checked ? 'calls' : 'off')}
          />
          Log every HTTP call and response
        </label>
        <label>
          <input
            type="checkbox"
            checked={mode === 'headers'}
            disabled={mode === 'off'}
            onChange={event => change(event.target.checked ? 'headers' : 'calls')}
          />
          Include headers
        </label>
        {mode !== 'off' && (
          <ToggleButton isOpen={areGroupsOpen} onToggle={() => setAreGroupsOpen(!areGroupsOpen)}>
            Calls to log ({HTTP_GROUPS.length - muted.size} of {HTTP_GROUPS.length})
          </ToggleButton>
        )}
        {quotaExceeded && (
          <p className="debug-options-alert">Stopped: Spotify’s quota is used up. Restart the app to poll again.</p>
        )}
      </div>
      {mode !== 'off' && areGroupsOpen && (
        <div className="debug-options debug-http-groups">
          {HTTP_GROUPS.map(group => (
            <label key={group.id}>
              <input
                type="checkbox"
                checked={!muted.has(group.id)}
                onChange={event => toggleGroup(group.id, event.target.checked)}
              />
              {group.label}
            </label>
          ))}
        </div>
      )}
      {isStatusOpen && (
        <dl className="debug-status">
          {status.map(([label, value]) => (
            <div key={label} className={value.length > 40 ? 'debug-status-wide' : undefined}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

type DebugTab = 'log' | 'bluetooth';

const TABS: readonly (readonly [tab: DebugTab, label: string])[] = [
  ['log', 'Log'],
  ['bluetooth', 'Bluetooth']
];

function DebugConsolePanel({
  onClose,
  status,
  onReload,
  onRegisterAgain
}: Readonly<{ onClose: () => void; status: DebugStatus; onReload: () => void; onRegisterAgain: () => void }>) {
  const entries = useSyncExternalStore(subscribeDebugLog, getDebugEntries);
  const widevine = useWidevineStatus();
  const [tab, setTab] = useState<DebugTab>('log');
  const rows: DebugStatus = [
    ['Version', APP_VERSION],
    ...status,
    ['Widevine', widevine],
    ['Device ID', deviceCredentials()?.deviceId ?? 'Not registered'],
    ['Browser', navigator.userAgent]
  ];

  return (
    <Modal labelledBy="debug-console-title" onClose={onClose} className="debug-console">
      <header className="debug-console-header">
        <Bug size={16} aria-hidden="true" />
        <h2 id="debug-console-title">Debug console</h2>
        {isKiosk() && (
          <div className="debug-console-tabs" role="tablist" aria-label="Debug console sections">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`debug-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={`debug-panel-${id}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="debug-console-actions">
          {tab === 'log' && (
            <button type="button" onClick={clearDebugLog} disabled={entries.length === 0}>
              <Trash2 size={14} aria-hidden="true" /> Clear log
            </button>
          )}
          <button type="button" onClick={onReload}>
            <RotateCw size={14} aria-hidden="true" /> Reload page
          </button>
          {isKiosk() && (
            <button type="button" onClick={onRegisterAgain}>
              <KeyRound size={14} aria-hidden="true" /> Register again
            </button>
          )}
          <button
            type="button"
            data-modal-autofocus
            onClick={onClose}
            aria-label="Close debug console"
            className="debug-console-close"
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {tab === 'bluetooth' ? (
        <div
          className="debug-console-panel"
          role="tabpanel"
          id="debug-panel-bluetooth"
          aria-labelledby="debug-tab-bluetooth"
        >
          <BluetoothDebug />
        </div>
      ) : (
        <div
          className="debug-console-panel"
          {...(isKiosk() && { role: 'tabpanel', id: 'debug-panel-log', 'aria-labelledby': 'debug-tab-log' })}
        >
          <LogOptions status={rows} />
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
      )}
    </Modal>
  );
}

const reloadPage = () => location.reload();

/** Forgets the kiosk's device ID, secret and config, so the app starts again as a new screen to countdown-server. */
function forgetDevice(): void {
  forgetRegistration();
  forgetDeviceConfig();
}

/** A full-screen view of the app's state and recent log, opened by a hidden gesture on the kiosk. */
export default function DebugConsole({
  isOpen,
  onClose,
  status,
  onReload = reloadPage,
  onRegisterAgain
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  status: DebugStatus;
  onReload?: () => void;
  onRegisterAgain?: () => void;
}>) {
  return isOpen ? (
    <DebugConsolePanel
      onClose={onClose}
      status={status}
      onReload={onReload}
      onRegisterAgain={
        onRegisterAgain ??
        (() => {
          forgetDevice();
          onReload();
        })
      }
    />
  ) : null;
}
