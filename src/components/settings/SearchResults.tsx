import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { SearchResult } from '../../countdown/search';

/** How long typing must pause before the search runs, so each key press does not send one. */
const SEARCH_DELAY_MS = 300;

const NONE: readonly string[] = [];

/**
 * What a search for `query` finds, each result a button that picks it: searched a moment after the query stops changing,
 * and nothing while it is empty. A late answer for an older query is never shown, only the one for the query now.
 */
export default function SearchResults<R extends SearchResult>({
  query,
  search,
  exclude = NONE,
  icon,
  onPick
}: Readonly<{
  /** What to search for, already trimmed; empty searches for nothing. */
  query: string;
  search: (query: string) => Promise<R[]>;
  /** The keys of results already chosen, left out of the list. */
  exclude?: readonly string[];
  /** Shown at the end of each result, such as a plus for one that is added. */
  icon?: ReactNode;
  onPick: (result: R) => void;
}>) {
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
  const shown = answered?.results?.filter(result => !exclude.includes(result.key));
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
                {icon}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
