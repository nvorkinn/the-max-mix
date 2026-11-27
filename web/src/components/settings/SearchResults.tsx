import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { SearchResult } from '../../countdown/search';
import { useT } from '../../i18n/translate';
import StopLetter from './StopLetter';

/** How long typing must pause before the search runs, so each key press does not send one. */
const SEARCH_DELAY_MS = 300;

const NONE: readonly string[] = [];

/** One result, a button that picks it: its name, the line under it, and what shows at its end. */
export function ResultButton<R extends SearchResult>({
  result,
  disabled = false,
  keepFocus = false,
  end,
  onPick
}: Readonly<{ result: R; disabled?: boolean; keepFocus?: boolean; end?: ReactNode; onPick: (result: R) => void }>) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={keepFocus ? event => event.preventDefault() : undefined}
      onClick={() => onPick(result)}
      className="modal-option search-result w-full px-4 py-2 flex gap-3 items-center text-left rounded-xl border"
    >
      <span className="flex-1 min-w-0">
        <span className="stop-name text-sm font-semibold">
          <span className="truncate">{result.name}</span>
          {result.letter && <StopLetter letter={result.letter} />}
        </span>
        <span className="block text-xs text-muted truncate">{result.detail}</span>
      </span>
      {end}
    </button>
  );
}

/**
 * What a search for `query` finds, each result a button that picks it: searched a moment after the query stops changing,
 * and nothing while it is empty. A late answer for an older query is never shown, only the one for the query now.
 */
export default function SearchResults<R extends SearchResult>({
  query,
  search,
  chosen = NONE,
  icon,
  keepFocus = false,
  onPick,
  onUnpick
}: Readonly<{
  /** What to search for, already trimmed; empty searches for nothing. */
  query: string;
  search: (query: string) => Promise<R[]>;
  /** The keys of results already chosen: shown with a tick and Added, and not picked again. */
  chosen?: readonly string[];
  /** Shown at the end of each result not yet chosen, such as a plus for one that is added. */
  icon?: ReactNode;
  /**
   * Leaves the focus in the search box when a result is tapped, so the on-screen keyboard stays up (and nothing moves
   * under the finger) while more are picked.
   */
  keepFocus?: boolean;
  onPick: (result: R) => void;
  /** Takes back a chosen result tapped again. Without it a chosen result can't be tapped. */
  onUnpick?: (result: R) => void;
}>) {
  const t = useT();
  // What the last search came to: its results, or null when it couldn't be made.
  const [found, setFound] = useState<{ query: string; results: R[] | null }>();

  useEffect(() => {
    if (!query) return;
    const timer = setTimeout(() => {
      search(query)
        .then(results => setFound({ query, results }))
        .catch(() => setFound({ query, results: null }));
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, search]);

  const answered = found?.query === query ? found : undefined;
  const shown = answered?.results;
  return (
    <div className="search-dialog-results">
      {query && !answered && (
        <p role="status" className="text-muted py-2">
          Searching...
        </p>
      )}
      {answered?.results === null && (
        <p role="alert" className="text-muted py-2">
          Couldn't search. Try again in a moment.
        </p>
      )}
      {shown?.length === 0 && <p className="text-muted py-2">{t('common.nothing_found')}</p>}
      {shown && shown.length > 0 && (
        <ul className="space-y-2" aria-label={t('common.results')}>
          {shown.map(result => {
            const isChosen = chosen.includes(result.key);
            return (
              <li key={result.key} className={result.indent ? 'search-result-indent' : undefined}>
                <ResultButton
                  result={result}
                  disabled={isChosen && !onUnpick}
                  keepFocus={keepFocus}
                  onPick={isChosen && onUnpick ? onUnpick : onPick}
                  end={
                    isChosen ? (
                      <span className="search-result-added">
                        <Check className="w-5 h-5 shrink-0" aria-hidden="true" />
                        {t('common.added')}
                      </span>
                    ) : (
                      icon
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
