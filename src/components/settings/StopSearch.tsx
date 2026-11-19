import { useId, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import type { DepartureStop } from 'countdown-api';
import { searchStops } from '../../countdown/search';
import type { StopResult } from '../../countdown/search';
import { useOnScreenKeyboard } from '../../hooks/useOnScreenKeyboard';
import Modal from '../Modal';
import SearchResults from './SearchResults';

/**
 * Finding stops for the Countdown, over the whole screen so nothing hides behind the on-screen keyboard: a search box
 * with Close along the top, and what the search finds filling the rest down to the keyboard. A tap adds a stop and leaves
 * the keyboard up for the next; one already saved shows a tick, and tapping it again removes it. Close (or Escape) goes back to the saved stops.
 */
export default function StopSearch({
  stops,
  onAdd,
  onRemove,
  onClose
}: Readonly<{
  stops: readonly DepartureStop[];
  onAdd: (result: StopResult) => void;
  onRemove: (result: StopResult) => void;
  onClose: () => void;
}>) {
  const titleId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  // Letters only: a station's name rarely has digits, and the shorter keyboard leaves more room for what is found.
  useOnScreenKeyboard(fieldRef);
  const wanted = query.trim();

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="app-modal-panel stop-search select-none">
      <h3 id={titleId} className="sr-only">
        Add stops
      </h3>
      <div className="stop-search-bar">
        <div className="stop-search-field">
          <Search className="stop-search-icon" aria-hidden="true" />
          <input
            ref={fieldRef}
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            aria-label="Search for a stop"
            placeholder="Station or stop"
            autoComplete="off"
            spellCheck={false}
            className="music-search w-full rounded-xl border"
          />
        </div>
        <button type="button" onClick={onClose} className="button search-dialog-confirm stop-search-done">
          Close
        </button>
      </div>
      <div className="stop-search-results">
        {wanted === '' ? (
          <p className="text-muted py-2">Type the name of a station or stop, then tap it to add it.</p>
        ) : (
          <SearchResults
            query={wanted}
            search={searchStops}
            chosen={stops.map(stop => `${stop.source}:${stop.id}`)}
            icon={<Plus className="w-6 h-6 shrink-0 text-accent" aria-hidden="true" />}
            keepFocus
            onPick={onAdd}
            onUnpick={onRemove}
          />
        )}
      </div>
    </Modal>
  );
}
