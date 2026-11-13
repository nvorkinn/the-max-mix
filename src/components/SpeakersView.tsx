import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Airplay, Bluetooth, Check, SlidersHorizontal, Speaker } from 'lucide-react';
import { setSpeakerVolume } from '../audio/airplay';
import type { AudioOutput } from '../audio/airplay';
import {
  connectBluetoothSpeaker,
  forgetBluetoothSpeaker,
  listBluetoothSpeakers,
  scanBluetoothSpeakers
} from '../audio/bluetooth';
import type { BluetoothSpeaker } from '../audio/bluetooth';
import { useSpotifyCooldown } from '../hooks/useSpotifyCooldown';
import { isTicked } from '../speakers/selection';
import type { SpeakerKey } from '../speakers/selection';
import type { SpeakerSelection } from '../speakers/useSpeakerSelection';
import { errorMessage } from '../utils/errorMessage';

/** How long a volume set here wins over the Pi's answer, so a list read during the drag does not move the slider back. */
const HOLD_MS = 5000;
/** How long the amber emphasis lasts when AirPlay is tapped before this tablet plays. */
const FLASH_MS = 1200;

/** The joined tabs' ids. */
type SpeakerTab = 'connect' | 'airplay' | 'bluetooth';
const TABS: readonly { id: SpeakerTab; label: string; Icon: typeof Speaker }[] = [
  { id: 'connect', label: 'Spotify Connect', Icon: Speaker },
  { id: 'airplay', label: 'AirPlay', Icon: Airplay },
  { id: 'bluetooth', label: 'Bluetooth', Icon: Bluetooth }
];

interface Row {
  key: SpeakerKey;
  name: string;
  selectable: boolean;
  /** A speaker output, whose volume slider the row can show. */
  output?: AudioOutput | undefined;
  /** Buttons after the name (Bluetooth's Pair, Connect and Forget). */
  actions?: ReactNode;
}

/** Each output's volume as the Pi says, except for one set here in the last few seconds. */
function useHeldVolumes() {
  const [held, setHeld] = useState<Record<string, { volume: number; at: number }>>({});
  const volumeOf = (output: AudioOutput) => {
    const mine = held[output.id];
    return mine && Date.now() - mine.at < HOLD_MS ? mine.volume : output.volume;
  };
  const change = (output: AudioOutput, volume: number) => {
    setHeld(current => ({ ...current, [output.id]: { volume, at: Date.now() } }));
    setSpeakerVolume(output, volume);
  };
  return { volumeOf, change };
}

/** The Bluetooth speakers the Pi knows, and its Find, Pair, Connect and Forget. */
function useBluetooth(enabled: boolean, onChange: () => void) {
  const [speakers, setSpeakers] = useState<BluetoothSpeaker[] | null>(null);
  // What the Pi is doing: 'scan', or the address it is connecting or forgetting.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (task: string, work: () => Promise<BluetoothSpeaker[]>) => {
      setBusy(task);
      setError(null);
      try {
        setSpeakers(await work());
        onChange();
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setBusy(null);
      }
    },
    [onChange]
  );
  useEffect(() => {
    if (enabled) void run('list', () => listBluetoothSpeakers());
  }, [enabled, run]);
  const then = (address: string, action: (address: string) => Promise<void>) =>
    run(address, async () => {
      await action(address);
      return listBluetoothSpeakers();
    });
  return {
    speakers: speakers ?? [],
    busy,
    error,
    scan: () => void run('scan', () => scanBluetoothSpeakers()),
    connect: (address: string) => void then(address, connectBluetoothSpeaker),
    forget: (address: string) => void then(address, forgetBluetoothSpeaker)
  };
}

/**
 * The Speakers view, in the panel beside the artwork. On the kiosk, joined tabs pick Spotify Connect (this tablet, Spotify
 * Connect devices and the Sonos rooms), AirPlay (every speaker output, Bluetooth ones included) or Bluetooth (pairing,
 * and ticking a connected speaker). Each speaker is a large selector and its name, two to a row; only the selector
 * changes anything, and only the draft: the Save button beside the panel carries it out. AirPlay plays what this tablet
 * plays, so tapping it before this tablet plays only points, in amber, at This tablet. Bluetooth still opens then, for
 * pairing, connecting and forgetting; only ticking a speaker there waits for this tablet.
 */
export default function SpeakersView({
  selection,
  onKiosk,
  browserDeviceId
}: Readonly<{
  selection: SpeakerSelection;
  onKiosk: boolean;
  browserDeviceId: string | null;
}>) {
  const [pickedTab, setPickedTab] = useState<SpeakerTab>('connect');
  const [showVolumes, setShowVolumes] = useState(false);
  const [flash, setFlash] = useState<SpeakerTab | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(flashTimerRef.current), []);
  const tabletRef = useRef<HTMLButtonElement>(null);
  const waitingForSpotify = useSpotifyCooldown() > 0;
  const { shown, confirmed, saving, tabletPlaying } = selection;
  // AirPlay needs this tablet to play; Bluetooth opens anyway, for pairing, with its speakers' selectors greyed out.
  const tabLocked = (id: SpeakerTab) => id === 'airplay' && !tabletPlaying;
  const tab: SpeakerTab = tabLocked(pickedTab) ? 'connect' : pickedTab;
  const volumes = useHeldVolumes();
  const { readOutputs } = selection;
  const onBluetoothChange = useCallback(() => void readOutputs(), [readOutputs]);
  const bluetooth = useBluetooth(onKiosk && tab === 'bluetooth', onBluetoothChange);

  const pickTab = (id: SpeakerTab) => {
    if (!tabLocked(id)) {
      setPickedTab(id);
      return;
    }
    // AirPlay needs this tablet to play first: point at it, without choosing it.
    setPickedTab('connect');
    setFlash(id);
    clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_MS);
    requestAnimationFrame(() => tabletRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const rowsFor = (id: SpeakerTab): Row[] => {
    if (id === 'airplay') {
      return selection.outputs.map(output => ({
        key: `output:${output.id}`,
        name: output.name,
        selectable: tabletPlaying,
        output
      }));
    }
    if (id === 'bluetooth') {
      return bluetooth.speakers.map(speaker => {
        const output = selection.outputs.find(candidate => candidate.address === speaker.address);
        const action = speaker.paired ? 'Connect' : 'Pair';
        // Not connected: no output yet, so a key of its own that nothing is ticked by.
        const outputId = output?.id ?? `bluetooth:${speaker.address}`;
        return {
          key: `output:${outputId}`,
          name: speaker.name,
          selectable: tabletPlaying && output !== undefined,
          output,
          actions: (
            <span className="speaker-row-actions">
              {!speaker.connected && (
                <button
                  type="button"
                  onClick={() => bluetooth.connect(speaker.address)}
                  disabled={bluetooth.busy !== null}
                  aria-label={`${action} ${speaker.name}`}
                  className="button-secondary speaker-row-action"
                >
                  {bluetooth.busy === speaker.address ? 'Connecting…' : action}
                </button>
              )}
              {speaker.paired && (
                <button
                  type="button"
                  onClick={() => bluetooth.forget(speaker.address)}
                  disabled={bluetooth.busy !== null}
                  aria-label={`Forget ${speaker.name}`}
                  className="button-secondary speaker-row-action"
                >
                  Forget
                </button>
              )}
            </span>
          )
        };
      });
    }
    const rows: Row[] = [];
    if (browserDeviceId) {
      rows.push({ key: 'tablet', name: 'This tablet', selectable: !waitingForSpotify });
    }
    for (const device of selection.connectDevices) {
      const deviceId = device.id ?? `unavailable:${device.name}`;
      rows.push({
        key: `connect:${deviceId}`,
        name: device.name,
        selectable: Boolean(device.id) && !device.is_restricted && !waitingForSpotify
      });
    }
    for (const room of selection.sonosRooms) rows.push({ key: `sonos:${room}`, name: room, selectable: true });
    // Whatever plays comes first.
    return rows.toSorted((a, b) => Number(isTicked(confirmed, b.key)) - Number(isTicked(confirmed, a.key)));
  };

  const renderRow = (row: Row) => {
    const ticked = isTicked(shown, row.key);
    const playing = isTicked(confirmed, row.key);
    const volume = row.output ? volumes.volumeOf(row.output) : null;
    let detail: ReactNode = null;
    if (showVolumes && playing && tab !== 'connect' && volume !== null && row.output) {
      const output = row.output;
      detail = (
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          aria-label={`${row.name} volume`}
          onChange={event => volumes.change(output, Number(event.target.value))}
          className="range-control volume-range speaker-row-volume"
          style={{ '--range-progress': `${volume}%` } as CSSProperties}
        />
      );
    } else if (ticked && playing) detail = <span className="speaker-row-status">Playing</span>;
    else if (ticked && saving) detail = <span className="speaker-row-status">Connecting…</span>;
    const flashing = flash !== null && row.key === 'tablet';
    return (
      <div key={row.key} className="speaker-row">
        <button
          type="button"
          role="checkbox"
          aria-checked={ticked}
          aria-label={row.name}
          ref={row.key === 'tablet' ? tabletRef : undefined}
          disabled={!row.selectable || saving}
          onClick={() => selection.toggle(row.key)}
          className={`speaker-select${flashing ? ' is-flashing' : ''}`}
        >
          <span className="speaker-select-box">{ticked && <Check size={20} strokeWidth={3} aria-hidden="true" />}</span>
        </button>
        <span className="speaker-row-text">
          <span className="speaker-row-name">{row.name}</span>
          {detail}
        </span>
        {row.actions}
      </div>
    );
  };

  const error = tab === 'bluetooth' ? (bluetooth.error ?? selection.error) : selection.error;
  return (
    <div className="speakers-view">
      {onKiosk && (
        <div className="speaker-tabs-row">
          <div className="speaker-tabs" role="group" aria-label="Kind of speaker">
            {TABS.map(({ id, label, Icon }) => (
              <button
                type="button"
                key={id}
                aria-pressed={tab === id}
                aria-disabled={tabLocked(id)}
                onClick={() => pickTab(id)}
                className={`speaker-tab${flash === id ? ' is-flashing' : ''}`}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          {tab !== 'connect' && tabletPlaying && (
            <button
              type="button"
              onClick={() => setShowVolumes(shownNow => !shownNow)}
              aria-pressed={showVolumes}
              aria-label="Volumes"
              title="Volumes"
              className="speaker-volumes-button"
            >
              <SlidersHorizontal size={20} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="speaker-error">
          {error}
        </p>
      )}
      {tab === 'bluetooth' && (
        <button
          type="button"
          onClick={bluetooth.scan}
          disabled={bluetooth.busy !== null}
          className="button-secondary speaker-find"
        >
          {bluetooth.busy === 'scan' ? 'Looking for speakers…' : 'Find speakers'}
        </button>
      )}
      <div
        className={`speaker-grid${tab === 'bluetooth' ? ' is-single' : ''}`}
        role="group"
        aria-label={TABS.find(entry => entry.id === tab)?.label}
      >
        {rowsFor(tab).map(row => renderRow(row))}
      </div>
    </div>
  );
}
