import { useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CloudSun, Megaphone, Plus, TramFront, Trash2 } from 'lucide-react';
import type { NoticeBoard, TouchscreenConfig } from 'countdown-api';
import { describeStop, rememberStop, searchPlaces, searchStops } from '../../countdown/search';
import type { DeviceConfig } from '../../hooks/useDeviceConfig';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import ConfirmButton from '../ConfirmButton';
import Modal from '../Modal';
import SearchDialog from './SearchDialog';

const COUNTRY_NAMES: Record<NonNullable<NoticeBoard['country']>, string> = { GB: 'United Kingdom', NO: 'Norway' };
// Norway's postcodes are four digits; the UK's are an outward code of letters and digits, then a digit and two letters.
const NO_POSTCODE = /^\d{4}$/;
const GB_POSTCODE = /^([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})$/;

/**
 * The notice board for a postcode as typed: its country told by its form, and a UK one spaced as usual. Null when it is
 * neither a UK nor a Norwegian postcode.
 */
export function noticeBoardFor(typed: string): NoticeBoard | null {
  const postcode = typed.trim().toUpperCase().replaceAll(/\s+/g, ' ');
  if (NO_POSTCODE.test(postcode)) return { postcode, country: 'NO' };
  const uk = GB_POSTCODE.exec(postcode);
  return uk ? { postcode: `${uk[1]} ${uk[2]}`, country: 'GB' } : null;
}

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

/**
 * Asks for the notice board's postcode, a UK or a Norwegian one, which tells its country; an empty postcode turns the
 * local notices off.
 */
function NoticeBoardDialog({
  board,
  onSave,
  onClose
}: Readonly<{ board: NoticeBoard; onSave: (board: NoticeBoard) => void; onClose: () => void }>) {
  const titleId = useId();
  const hintId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [postcode, setPostcode] = useState(board.postcode ?? '');
  useOnScreenKeyboard(fieldRef, { hasNumberRow: true, isUppercase: true });
  const off = postcode.trim() === '';
  const wanted = off ? null : noticeBoardFor(postcode);

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
      <input
        ref={fieldRef}
        type="text"
        value={postcode}
        onChange={event => setPostcode(event.target.value)}
        aria-label="Postcode"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={!off && wanted === null}
        aria-describedby={hintId}
        className="music-search w-full min-h-12 px-4 rounded-xl border text-sm"
      />
      <p id={hintId} className="text-muted py-2">
        {off || wanted ? 'A UK or Norwegian postcode. Leave it empty for none.' : 'Enter a UK or Norwegian postcode.'}
      </p>
      <div className="search-dialog-actions">
        <button type="button" onClick={onClose} className="button button-secondary">
          Cancel
        </button>
        <button
          type="button"
          disabled={!off && wanted === null}
          onClick={() => onSave(wanted ?? { postcode: null, country: null })}
          className="button search-dialog-confirm"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

/**
 * What the Dashboard shows: the stops whose departures it lists, the place for the weather and the postcode for the
 * notice board. Each part saves to countdown-server on its own as soon as it changes.
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
          search={searchStops}
          exclude={stops.map(stop => `${stop.source}:${stop.id}`)}
          onClose={() => setDialog(null)}
          onPick={result => {
            rememberStop(result);
            onSave('arrivals', { ...config.arrivals, stops: [...stops, result.value] });
            setDialog(null);
          }}
        />
      )}
      {dialog === 'place' && (
        <SearchDialog
          title="Weather place"
          search={searchPlaces}
          initialQuery={config.weather.key ? config.weather.location : ''}
          onClose={() => setDialog(null)}
          onPick={result => {
            onSave('weather', result.value);
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
