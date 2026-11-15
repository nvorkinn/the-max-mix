import { useEffect, useId, useRef, useState } from 'react';
import type { SearchResult } from '../../countdown/search';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import Modal from '../Modal';

/** How long typing must pause before the search runs, so each key press does not send one. */
const SEARCH_DELAY_MS = 300;

const NONE: readonly string[] = [];

/**
 * A small dialog to find one stop or place: a search box the on-screen keyboard types in, and what the search finds,
 * one tap on which picks it and closes the dialog. A box that starts with text (the place chosen now) waits for a tap
 * and a change before it searches.
 */
export default function SearchDialog<R extends SearchResult>({
  title,
  search,
  initialQuery = '',
  exclude = NONE,
  onPick,
  onClose
}: Readonly<{
  title: string;
  search: (query: string) => Promise<R[]>;
  /** What the box starts with, such as the place chosen now; it isn't searched for until it is changed. */
  initialQuery?: string;
  /** The keys of results already chosen, left out of the list. */
  exclude?: readonly string[];
  onPick: (result: R) => void;
  onClose: () => void;
}>) {
  const titleId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  // What the last search came to: its results, or null when it couldn't be made.
  const [found, setFound] = useState<{ query: string; results: R[] | null }>();
  // Nothing is searched for until the text is changed, so the place chosen now doesn't bring up suggestions.
  const [edited, setEdited] = useState(false);
  const wanted = edited ? query.trim() : '';
  useOnScreenKeyboard(fieldRef, { focus: initialQuery === '', hasNumberRow: true, isUppercase: true });

  useEffect(() => {
    if (!wanted) return;
    // A late answer for an older query is never shown: only the one for what the box says now is.
    const timer = setTimeout(() => {
      search(wanted)
        .then(results => setFound({ query: wanted, results }))
        .catch(() => setFound({ query: wanted, results: null }));
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [wanted, search]);

  const answered = found?.query === wanted ? found : undefined;
  const shown = answered?.results?.filter(result => !exclude.includes(result.key));
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
      <div className="search-dialog-results">
        {wanted && !answered && (
          <p role="status" className="text-muted py-2">
            Searching...
          </p>
        )}
        {answered?.results === null && (
          <p role="alert" className="text-muted py-2">
            Couldn't search. Try again in a moment.
          </p>
        )}
        {shown?.length === 0 && <p className="text-muted py-2">Nothing found.</p>}
        {shown && shown.length > 0 && (
          <ul className="space-y-2" aria-label="Results">
            {shown.map(result => (
              <li key={result.key} className={result.indent ? 'search-result-indent' : undefined}>
                <button
                  type="button"
                  onClick={() => onPick(result)}
                  className="modal-option w-full px-4 py-2 flex gap-3 items-center text-left rounded-xl border"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold truncate">{result.name}</span>
                    <span className="block text-xs text-muted truncate">{result.detail}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="search-dialog-actions">
        <button type="button" onClick={onClose} className="button button-secondary">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
