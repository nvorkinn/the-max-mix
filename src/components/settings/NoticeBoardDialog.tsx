import { useId, useRef, useState } from 'react';
import type { NoticeBoard } from 'countdown-api';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import Modal from '../Modal';
import CountryFlag from './CountryFlag';

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

/** The notice board's postcode and its country, or null when it is off. Its country shows as a flag beside it. */
export function noticeBoardPlace(board: NoticeBoard): { postcode: string; country: 'GB' | 'NO' } | null {
  return board.postcode && board.country ? { postcode: board.postcode, country: board.country } : null;
}

/**
 * Asks for the notice board's postcode, a UK or a Norwegian one, which tells its country; an empty postcode turns the
 * local notices off.
 */
export default function NoticeBoardDialog({
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
          Postcode
        </h3>
      </div>
      <div className="postcode-field">
        {wanted?.country && <CountryFlag country={wanted.country} className="postcode-field-flag" />}
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
      </div>
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
