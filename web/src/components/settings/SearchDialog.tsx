import { useId, useRef, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import type { SearchResult } from '../../countdown/search';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import { useT } from '../../i18n/translate';
import Modal from '../Modal';
import SearchResults, { ResultButton } from './SearchResults';

/**
 * A small dialog to find one place: a search box the on-screen keyboard types in, and what the search finds, one tap on
 * which picks it and closes the dialog. A box that starts with text (the place chosen now) waits for a change before it
 * searches. With `locate`, a Current location button fills in where the kiosk is, as a result to tap like any other.
 */
export default function SearchDialog<R extends SearchResult>({
  title,
  search,
  initialQuery = '',
  locate,
  onPick,
  onClose
}: Readonly<{
  title: string;
  search: (query: string) => Promise<R[]>;
  /** What the box starts with, such as the place chosen now; it isn't searched for until it is changed. */
  initialQuery?: string;
  /** Finds the result for where the kiosk is: null when there's no telling; rejects when it can't be asked. */
  locate?: (() => Promise<R | null>) | undefined;
  onPick: (result: R) => void;
  onClose: () => void;
}>) {
  const t = useT();
  const titleId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  // Nothing is searched for until the text is changed, so the place chosen now doesn't bring up suggestions.
  const [edited, setEdited] = useState(false);
  const [locating, setLocating] = useState<'busy' | 'failed' | null>(null);
  const [located, setLocated] = useState<R | null>(null);
  useOnScreenKeyboard(fieldRef, { focus: initialQuery === '', hasNumberRow: true });

  const pickHere = (find: () => Promise<R | null>) => {
    setLocating('busy');
    find()
      .then(found => {
        // The place is only filled in: it is saved once it is tapped, like any other result.
        if (found) {
          setLocated(found);
          setQuery(found.name);
          setEdited(false);
        }
        setLocating(found ? null : 'failed');
      })
      .catch(() => setLocating('failed'));
  };

  return (
    <Modal
      labelledBy={titleId}
      onClose={onClose}
      className="app-modal-panel search-dialog border rounded-3xl p-6 shadow-2xl text-left select-none"
    >
      <div className="modal-header">
        <h3 id={titleId} className="text-lg font-semibold">
          {title}
        </h3>
      </div>
      <input
        ref={fieldRef}
        type="search"
        value={query}
        onChange={event => {
          setQuery(event.target.value);
          setEdited(true);
        }}
        aria-label={title}
        autoComplete="off"
        spellCheck={false}
        className="music-search w-full min-h-12 px-4 rounded-xl border text-sm"
      />
      {located && !edited && (
        <ul className="search-dialog-results" aria-label={t('common.results')}>
          <li>
            <ResultButton result={located} onPick={onPick} />
          </li>
        </ul>
      )}
      <SearchResults query={edited ? query.trim() : ''} search={search} onPick={onPick} />
      {locating === 'failed' && (
        <p role="alert" className="text-muted py-2">
          {t('general.location_failed')}
        </p>
      )}
      <div className="search-dialog-actions">
        {locate && (
          <button
            type="button"
            disabled={locating === 'busy'}
            onClick={() => pickHere(locate)}
            className="button button-secondary search-dialog-locate"
          >
            <LocateFixed className="w-6 h-6" aria-hidden="true" />
            {t(locating === 'busy' ? 'general.locating' : 'general.current_location')}
          </button>
        )}
        <button type="button" onClick={onClose} className="button button-secondary">
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  );
}
