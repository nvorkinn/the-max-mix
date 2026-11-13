import { Check, ListMusic, LoaderCircle, MicVocal, Speaker, X } from 'lucide-react';
import type { PanelView } from '../hooks/usePanelView';

/** What the third button does: open the speakers, or save (and then show saving) a changed speaker choice. */
type SpeakersButton = 'speakers' | 'save' | 'saving';

/**
 * The three large buttons down the right-hand edge that pick what the middle panel shows. While a changed speaker
 * choice waits to be saved, the Speakers button becomes Save, then Saving… until the speakers confirm it, Lyrics
 * becomes Cancel, and Queue goes blank, so the view can only be left by saving or cancelling. Tapping Lyrics while the
 * lyrics show turns their sync mode on or off; the button fills in while it is on.
 */
export default function PanelNav({
  view,
  onShow,
  speakersButton = 'speakers',
  onSave,
  onCancel,
  lyricsSyncing = false
}: Readonly<{
  view: PanelView;
  onShow: (view: PanelView) => void;
  /** 'speakers' unless the Speakers view is open with a changed choice ('save') or one being saved ('saving'). */
  speakersButton?: SpeakersButton;
  onSave?: () => void;
  /** Drops the changed speaker choice. */
  onCancel?: () => void;
  /** Whether the lyrics are in sync mode, waiting for a tap on the line being sung. */
  lyricsSyncing?: boolean;
}>) {
  const saveShown = speakersButton !== 'speakers' && onSave !== undefined && onCancel !== undefined;
  if (saveShown) {
    const saving = speakersButton === 'saving';
    return (
      <nav className="panel-nav" aria-label="Beside the artwork">
        <button type="button" className="panel-nav-button" disabled aria-hidden="true" tabIndex={-1} />
        <button type="button" className="panel-nav-button" disabled={saving} onClick={onCancel}>
          <X size={26} aria-hidden="true" />
          <span>Cancel</span>
        </button>
        <button type="button" className="panel-nav-button is-save" disabled={saving} onClick={onSave}>
          {saving ? (
            <LoaderCircle size={26} className="animate-spin" aria-hidden="true" />
          ) : (
            <Check size={26} aria-hidden="true" />
          )}
          <span>{saving ? 'Saving…' : 'Save'}</span>
        </button>
      </nav>
    );
  }
  return (
    <nav className="panel-nav" aria-label="Beside the artwork">
      <button
        type="button"
        className="panel-nav-button"
        aria-pressed={view === 'queue'}
        onClick={() => onShow('queue')}
      >
        <ListMusic size={26} aria-hidden="true" />
        <span>Queue</span>
      </button>
      <button
        type="button"
        className={`panel-nav-button ${lyricsSyncing ? 'is-syncing' : ''}`}
        aria-pressed={view === 'lyrics'}
        onClick={() => onShow('lyrics')}
      >
        <MicVocal size={26} aria-hidden="true" />
        <span>Lyrics</span>
      </button>
      <button
        type="button"
        className="panel-nav-button"
        aria-pressed={view === 'speakers'}
        onClick={() => onShow('speakers')}
      >
        <Speaker size={26} aria-hidden="true" />
        <span>Speakers</span>
      </button>
    </nav>
  );
}
