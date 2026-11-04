import { Download } from 'lucide-react';
import Modal from './Modal';

/** Asks whether to update the Pi now, when a newer version is out. "Not now" is remembered for that version. */
export default function UpdatePrompt({
  newer,
  onUpdate,
  onLater
}: Readonly<{ newer: string; onUpdate: () => void; onLater: () => void }>) {
  return (
    <Modal
      labelledBy="update-prompt-title"
      onClose={onLater}
      className="app-modal-panel border rounded-3xl p-6 max-w-md relative shadow-2xl text-left select-none"
    >
      <div className="modal-header mb-2">
        <h3 id="update-prompt-title" className="text-lg font-semibold flex items-center gap-2">
          <Download className="w-5 h-5 text-accent" aria-hidden="true" />
          Update available
        </h3>
      </div>
      <p className="text-sm font-semibold">{newer}.</p>
      <p className="mt-2 text-xs text-muted">
        Updating takes a few minutes, and the tablet restarts by itself if anything changed. If you wait, the Pi picks
        it up on its own and applies it at 04:30.
      </p>
      <div className="mt-5 flex gap-3">
        <button
          type="button"
          data-modal-autofocus
          onClick={onUpdate}
          className="spotify-sign-in flex-1 py-3 px-4 font-extrabold text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-98 transition-all"
        >
          Update now
        </button>
        <button type="button" onClick={onLater} className="button button-secondary flex-1">
          Not now
        </button>
      </div>
    </Modal>
  );
}
