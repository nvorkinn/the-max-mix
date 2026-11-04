import { useEffect, useRef } from 'react';
import { Download, LoaderCircle, X } from 'lucide-react';
import type { KioskUpdate } from '../hooks/useKioskUpdate';
import Modal from './Modal';

const noop = () => {};

/**
 * A full-screen console that follows a software update: what it says it is doing, and everything it prints. It stays up
 * while the update runs (the kiosk restarts by itself when the update needs it, which ends the page), and can be closed
 * once the update has finished, failed or been given up on.
 */
export default function UpdateConsole({ update }: Readonly<{ update: KioskUpdate }>) {
  const { consoleOpen, isUpdating, progress, output, closeConsole } = update;
  const outputRef = useRef<HTMLPreElement>(null);

  // Keep the newest output in view.
  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [output, consoleOpen]);

  if (!consoleOpen) return null;
  return (
    <Modal
      labelledBy="update-console-title"
      // Escape and a tap outside do nothing while the update runs: there is nothing to go back to.
      onClose={isUpdating ? noop : closeConsole}
      className="debug-console update-console"
    >
      <header className="debug-console-header">
        <Download size={22} aria-hidden="true" />
        <h2 id="update-console-title">Updating the Pi</h2>
        {!isUpdating && (
          <div className="debug-console-actions">
            <button
              type="button"
              data-modal-autofocus
              onClick={closeConsole}
              aria-label="Close update console"
              className="debug-console-close"
            >
              <X size={20} />
            </button>
          </div>
        )}
      </header>
      <p role="status" className="update-console-status">
        {isUpdating && <LoaderCircle size={22} className="animate-spin" aria-hidden="true" />}
        {progress ?? 'Updating… this can take a few minutes.'}
      </p>
      <pre ref={outputRef} aria-label="Update output" className="update-console-output">
        {output.length > 0 ? output.join('\n') : 'Starting the update…'}
      </pre>
      {isUpdating && (
        <p className="update-console-hint">
          The tablet restarts by itself when the update needs it. Please leave it on.
        </p>
      )}
    </Modal>
  );
}
