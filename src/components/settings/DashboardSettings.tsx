import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CloudSun, Megaphone, Plus, TramFront, Trash2 } from 'lucide-react';
import type { NoticeBoard, TouchscreenConfig } from 'countdown-api';
import { describeStop, searchPlaces, searchStops } from '../../countdown/search';
import type { DeviceConfig } from '../../hooks/useDeviceConfig';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import ConfirmButton from '../ConfirmButton';
import Modal from '../Modal';
import SearchDialog from './SearchDialog';

const CLOCK_FORMATS = [
  { id: '24h', label: '24-hour' },
  { id: '12h', label: '12-hour' }
] as const;

const COUNTRY_NAMES: Record<NonNullable<NoticeBoard['country']>, string> = { GB: 'United Kingdom', NO: 'Norway' };
const COUNTRIES = ['GB', 'NO'] as const;

/** The postcode and its country, as the notice board's row shows them. */
export function noticeBoardLabel(board: NoticeBoard): string | null {
  return board.postcode && board.country ? `${board.postcode}, ${COUNTRY_NAMES[board.country]}` : null;
}

/** A setting's row: its icon, what it is set to, and the button that changes it. */
function Row({
  icon,
  name,
  detail,
  children
}: Readonly<{ icon: ReactNode; name: string; detail?: string; children: ReactNode }>) {
  return (
    <div className="settings-box dashboard-row">
      <span className="settings-box-icon">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="settings-box-title block truncate">{name}</span>
        {detail && <span className="block text-muted truncate">{detail}</span>}
      </span>
      {children}
    </div>
  );
}

/** Asks for the notice board's country and postcode; an empty postcode turns the local notices off. */
function NoticeBoardDialog({
  board,
  onSave,
  onClose
}: Readonly<{ board: NoticeBoard; onSave: (board: NoticeBoard) => void; onClose: () => void }>) {
  const titleId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [country, setCountry] = useState<(typeof COUNTRIES)[number]>(board.country ?? 'GB');
  const [postcode, setPostcode] = useState(board.postcode ?? '');
  useOnScreenKeyboard(fieldRef);
  const wanted = postcode.trim().toUpperCase();

  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      className="app-modal-panel search-dialog border rounded-3xl p-6 shadow-2xl text-left select-none"
    >
      <div className="modal-header">
        <h3 id={titleId} className="text-lg font-semibold">
          Notice board
        </h3>
      </div>
      <div className="settings-segmented dashboard-segmented" role="group" aria-label="Country">
        {COUNTRIES.map(choice => (
          <button
            type="button"
            key={choice}
            aria-pressed={country === choice}
            onClick={() => setCountry(choice)}
            className="settings-segment"
          >
            {COUNTRY_NAMES[choice]}
          </button>
        ))}
      </div>
      <input
        ref={fieldRef}
        type="text"
        value={postcode}
        onChange={event => setPostcode(event.target.value)}
        aria-label="Postcode"
        autoComplete="off"
        spellCheck={false}
        className="music-search w-full min-h-12 mt-4 px-4 rounded-xl border text-sm"
      />
      <div className="search-dialog-actions">
        <button type="button" onClick={onClose} className="button button-secondary">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(wanted ? { postcode: wanted, country } : { postcode: null, country: null })}
          className="button search-dialog-confirm"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

/**
 * What the Dashboard shows: the clock's format, the stops whose departures it lists, the place for the weather and the
 * postcode for the notice board. Each part saves to countdown-server on its own as soon as it changes.
 */
export default function DashboardSettings({
  config,
  onSave
}: Readonly<{ config: TouchscreenConfig; onSave: DeviceConfig['save'] }>) {
  const [dialog, setDialog] = useState<'stop' | 'place' | 'notices' | null>(null);
  const stops = config.arrivals.stops;
  const notices = noticeBoardLabel(config.notice_board);

  return (
    <div className="settings-stack">
      <section className="settings-group">
        <h5 className="settings-group-title" id="clock-format-label">
          Time format
        </h5>
        <div className="settings-segmented dashboard-segmented" role="group" aria-labelledby="clock-format-label">
          {CLOCK_FORMATS.map(choice => (
            <button
              type="button"
              key={choice.id}
              aria-pressed={config.clock_format === choice.id}
              onClick={() => onSave('clock_format', choice.id)}
              className="settings-segment"
            >
              {choice.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-group">
        <h5 className="settings-group-title" id="departures-label">
          Departures
        </h5>
        {stops.length > 0 && (
          <ul className="settings-people" aria-labelledby="departures-label">
            {stops.map(stop => {
              const { name, detail } = describeStop(stop);
              return (
                <li key={`${stop.source}:${stop.id}`}>
                  <Row icon={<TramFront className="w-6 h-6" aria-hidden="true" />} name={name} detail={detail}>
                    <ConfirmButton
                      label="Remove"
                      confirmLabel="Tap again to remove"
                      className="shrink-0"
                      icon={<Trash2 className="w-5 h-5 shrink-0" aria-hidden="true" />}
                      onConfirm={() =>
                        onSave('arrivals', {
                          ...config.arrivals,
                          stops: stops.filter(kept => kept.source !== stop.source || kept.id !== stop.id)
                        })
                      }
                    />
                  </Row>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          onClick={() => setDialog('stop')}
          className="button button-secondary settings-wide-button settings-action"
        >
          <Plus className="w-5 h-5" aria-hidden="true" />
          Add stop
        </button>
      </section>

      <section className="settings-group">
        <h5 className="settings-group-title">Weather</h5>
        <Row
          icon={<CloudSun className="w-6 h-6" aria-hidden="true" />}
          name={config.weather.key ? config.weather.location : 'No place'}
        >
          <button
            type="button"
            onClick={() => setDialog('place')}
            className="modal-option settings-action shrink-0 rounded-2xl border font-bold"
          >
            Change
          </button>
        </Row>
      </section>

      <section className="settings-group">
        <h5 className="settings-group-title">Notice board</h5>
        <Row icon={<Megaphone className="w-6 h-6" aria-hidden="true" />} name={notices ?? 'Off'}>
          <button
            type="button"
            onClick={() => setDialog('notices')}
            className="modal-option settings-action shrink-0 rounded-2xl border font-bold"
          >
            Change
          </button>
        </Row>
      </section>

      {dialog === 'stop' && (
        <SearchDialog
          title="Add stop"
          confirmLabel="Add"
          search={searchStops}
          exclude={stops.map(stop => stop.id)}
          onClose={() => setDialog(null)}
          onConfirm={result => {
            onSave('arrivals', { ...config.arrivals, stops: [...stops, { source: result.source, id: result.id }] });
            setDialog(null);
          }}
        />
      )}
      {dialog === 'place' && (
        <SearchDialog
          title="Weather place"
          confirmLabel="Save"
          search={searchPlaces}
          onClose={() => setDialog(null)}
          onConfirm={result => {
            onSave('weather', { location: result.name, key: result.id });
            setDialog(null);
          }}
        />
      )}
      {dialog === 'notices' && (
        <NoticeBoardDialog
          board={config.notice_board}
          onClose={() => setDialog(null)}
          onSave={board => {
            onSave('notice_board', board);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
