import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Library, X } from 'lucide-react';
import { getLikedSongs, getPlaylists, getRecentlyPlayed, searchMusic } from '../spotify/api';
import { recordSpotifyRetryAfter, SpotifyApiError } from '../spotify/http';
import { errorMessage } from '../utils/errorMessage';
import { isKiosk } from '../utils/kiosk';
import type { MusicChoice } from '../types';
import { Artwork } from './TrackImages';
import Modal from './Modal';

type Tab = 'playlists' | 'recent' | 'search';
const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'recent', label: 'Recently played' },
  { id: 'search', label: 'Search' }
];

/** How long typing must pause before Spotify is asked, so each key press does not send a search. */
const SEARCH_DELAY_MS = 400;

/** Reads one list tab's choices: Liked Songs and the playlists, or the tracks played lately. */
async function loadChoices(tab: Exclude<Tab, 'search'>): Promise<MusicChoice[]> {
  if (tab === 'recent') return getRecentlyPlayed();
  const [liked, playlists] = await Promise.all([getLikedSongs(), getPlaylists()]);
  return [liked, ...playlists];
}

function ChoiceRow({
  choice,
  disabled,
  onPick
}: Readonly<{ choice: MusicChoice; disabled: boolean; onPick: (choice: MusicChoice) => void }>) {
  const liked = choice.uri.endsWith(':collection');
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(choice)}
      className="modal-option music-choice w-full p-2 flex gap-3 items-center text-left rounded-xl border"
    >
      {liked ? (
        <span className="music-choice-art music-choice-liked" aria-hidden="true">
          <Heart size={22} fill="currentColor" />
        </span>
      ) : (
        <Artwork src={choice.image} alt="" className="music-choice-art" />
      )}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold truncate">{choice.name}</span>
        {choice.detail && <span className="block text-xs text-muted truncate">{choice.detail}</span>}
      </span>
    </button>
  );
}

function ChoiceList({
  label,
  choices,
  disabled,
  onPick
}: Readonly<{ label: string; choices: MusicChoice[]; disabled: boolean; onPick: (choice: MusicChoice) => void }>) {
  return (
    <ul className="space-y-2" aria-label={label}>
      {choices.map(choice => (
        <li key={choice.uri}>
          <ChoiceRow choice={choice} disabled={disabled} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}

function FailedRead({ error, onRetry }: Readonly<{ error: string; onRetry: () => void }>) {
  return (
    <div className="space-y-2">
      <p role="alert" className="text-xs status-danger">
        {error}
      </p>
      <button type="button" className="button button-secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** A search box and what Spotify finds for it. On the kiosk the on-screen keyboard types in the box. */
function SearchPanel({ disabled, onPick }: Readonly<{ disabled: boolean; onPick: (choice: MusicChoice) => void }>) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; choices?: MusicChoice[]; error?: string }>();
  const [searchVersion, setSearchVersion] = useState(0);
  const wanted = query.trim();

  useEffect(() => {
    const field = fieldRef.current;
    field?.focus();
    // The touch screen has no keyboard of its own, and a modal dialog makes the rest of the page untouchable, so the
    // keyboard goes inside the dialog. Loaded only on the kiosk.
    const dialog = field?.closest('dialog');
    if (!dialog || !isKiosk()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('../../pi/kiosk-keyboard/keyboard').then(keyboard => {
      if (!cancelled) stop = keyboard.start(document, dialog);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchMusic(wanted)
        .then(choices => ({ query: wanted, choices }))
        .catch((caught: unknown) => {
          if (caught instanceof SpotifyApiError) recordSpotifyRetryAfter(caught);
          return { query: wanted, error: errorMessage(caught) };
        })
        .then(found => {
          if (!cancelled) setResult(found);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [wanted, searchVersion]);

  const shown = result?.query === wanted ? result : undefined;
  return (
    <div className="space-y-3">
      <input
        ref={fieldRef}
        type="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        aria-label="Search Spotify"
        placeholder="Songs, albums or playlists"
        autoComplete="off"
        spellCheck={false}
        className="music-search w-full min-h-11 px-3 rounded-xl border text-sm"
      />
      {!wanted && <p className="text-xs text-muted py-2">Type to search Spotify.</p>}
      {wanted && !shown && (
        <p role="status" className="text-xs text-muted py-2">
          Searching...
        </p>
      )}
      {shown?.error !== undefined && (
        <FailedRead
          error={shown.error}
          onRetry={() => {
            setResult(undefined);
            setSearchVersion(version => version + 1);
          }}
        />
      )}
      {shown?.choices && (
        <ChoiceList label="Search results" choices={shown.choices} disabled={disabled} onPick={onPick} />
      )}
      {shown?.choices?.length === 0 && <p className="text-xs text-muted py-2">Nothing found.</p>}
    </div>
  );
}

function MusicPickerContent({
  onClose,
  onPlay,
  disabled
}: Readonly<{ onClose: () => void; onPlay: (choice: MusicChoice) => Promise<unknown>; disabled: boolean }>) {
  const [tab, setTab] = useState<Tab>('playlists');
  // Each list tab is read once per opening; switching back shows what was read without asking Spotify again.
  const [choices, setChoices] = useState<Partial<Record<Tab, MusicChoice[]>>>({});
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [readVersion, setReadVersion] = useState(0);
  const shown = choices[tab];

  const read = useCallback(async (which: Exclude<Tab, 'search'>, isCancelled: () => boolean) => {
    try {
      const list = await loadChoices(which);
      if (isCancelled()) return;
      setChoices(current => ({ ...current, [which]: list }));
      setError(null);
    } catch (caught) {
      if (isCancelled()) return;
      if (caught instanceof SpotifyApiError) recordSpotifyRetryAfter(caught);
      setError(errorMessage(caught));
    }
  }, []);

  const loaded = shown !== undefined;
  useEffect(() => {
    if (loaded || tab === 'search') return;
    let cancelled = false;
    void read(tab, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [tab, loaded, read, readVersion]);

  const pick = async (choice: MusicChoice) => {
    setStarting(true);
    try {
      await onPlay(choice);
      // A choice that failed closes too: the player's banner then says why and how to recover.
      onClose();
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal
      labelledBy="music-title"
      onClose={onClose}
      className={`app-modal-panel music-picker${tab === 'search' ? ' music-picker-search' : ''} border rounded-3xl p-6 max-w-lg relative shadow-2xl text-left select-none`}
    >
      <div className="modal-header flex items-center justify-between gap-2">
        <h3 id="music-title" className="text-lg font-semibold flex items-center gap-2">
          <Library className="w-5 h-5 text-accent" />
          Choose music
        </h3>
        <button
          type="button"
          data-modal-autofocus
          onClick={onClose}
          aria-label="Close music"
          className="modal-icon-button w-11 h-11 rounded-full flex items-center justify-center"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex gap-1.5 mb-3" role="group" aria-label="Music to choose from">
        {TABS.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
              setError(null);
            }}
            className="modal-option flex-1 min-h-11 rounded-xl border text-xs font-bold"
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'search' ? (
        <SearchPanel disabled={disabled || starting} onPick={picked => void pick(picked)} />
      ) : (
        <>
          {error && (
            <FailedRead
              error={error}
              onRetry={() => {
                setError(null);
                setReadVersion(version => version + 1);
              }}
            />
          )}
          {shown && (
            <ChoiceList
              label={TABS.find(({ id }) => id === tab)?.label ?? ''}
              choices={shown}
              disabled={disabled || starting}
              onPick={picked => void pick(picked)}
            />
          )}
          {!shown && !error && (
            <p role="status" className="text-xs text-muted py-2">
              Loading...
            </p>
          )}
          {shown?.length === 0 && <p className="text-xs text-muted py-2">Nothing here yet.</p>}
        </>
      )}
    </Modal>
  );
}

/** Lets the user start a playlist, Liked Songs, a recently played track or something searched for from the screen. */
export default function MusicPicker({
  isOpen,
  ...props
}: Readonly<{
  isOpen: boolean;
  onClose: () => void;
  /** Starts the choice; the picker closes once it settles. */
  onPlay: (choice: MusicChoice) => Promise<unknown>;
  /** True while playback cannot be started (offline, signed out, waiting for Spotify). */
  disabled: boolean;
}>) {
  return isOpen ? <MusicPickerContent {...props} /> : null;
}
