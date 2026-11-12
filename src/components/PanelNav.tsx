import { Check, ListMusic, LoaderCircle, MicVocal, Speaker } from 'lucide-react';
import type { PanelView } from '../hooks/usePanelView';

/** What the third button does: open the speakers, or save (and then show saving) a changed speaker choice. */
type SpeakersButton = 'speakers' | 'save' | 'saving';

/**
 * The three large buttons down the right-hand edge that pick what the middle panel shows. While a changed speaker
 * choice waits to be saved, the Speakers button becomes Save, then Saving… until the speakers confirm it.
 */
export default function PanelNav({
  view,
  onShow,
  speakersButton = 'speakers',
  onSave
}: Readonly<{
  view: PanelView;
  onShow: (view: PanelView) => void;
  /** 'speakers' unless the Speakers view is open with a changed choice ('save') or one being saved ('saving'). */
  speakersButton?: SpeakersButton;
  onSave?: () => void;
}>) {
  const saveShown = speakersButton !== 'speakers' && onSave !== undefined;
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
        className="panel-nav-button"
        aria-pressed={view === 'lyrics'}
        onClick={() => onShow('lyrics')}
      >
        <MicVocal size={26} aria-hidden="true" />
        <span>Lyrics</span>
      </button>
      {saveShown ? (
        <button
          type="button"
          className="panel-nav-button is-save"
          disabled={speakersButton === 'saving'}
          onClick={onSave}
        >
          {speakersButton === 'saving' ? (
            <LoaderCircle size={26} className="animate-spin" aria-hidden="true" />
          ) : (
            <Check size={26} aria-hidden="true" />
          )}
          <span>{speakersButton === 'saving' ? 'Saving…' : 'Save'}</span>
        </button>
      ) : (
        <button
          type="button"
          className="panel-nav-button"
          aria-pressed={view === 'speakers'}
          onClick={() => onShow('speakers')}
        >
          <Speaker size={26} aria-hidden="true" />
          <span>Speakers</span>
        </button>
      )}
    </nav>
  );
}
