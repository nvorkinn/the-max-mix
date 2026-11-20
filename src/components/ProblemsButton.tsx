import { TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { useProblems } from '../problems/problems';
import { useT } from '../i18n/translate';
import Modal from './Modal';

/**
 * The warning in the tab bar while anything is wrong. It opens the list of what is wrong now, each with the button that
 * fixes it, and goes once nothing is.
 */
export default function ProblemsButton({ onDetails }: Readonly<{ onDetails?: (() => void) | undefined }>) {
  const t = useT();
  const problems = useProblems();
  const [isOpen, setIsOpen] = useState(false);
  if (problems.length === 0) return null;
  const close = () => setIsOpen(false);
  return (
    <>
      <button
        type="button"
        className="dashboard-icon-button dashboard-problems"
        aria-label={t('problems.title')}
        onClick={() => setIsOpen(true)}
      >
        <TriangleAlert className="lucide" style={{ width: 26, height: 26 }} aria-hidden="true" />
      </button>
      {isOpen && (
        <Modal labelledBy="problems-title" onClose={close} className="app-modal-panel problems-sheet">
          <div className="problems-sheet-header">
            <h3 id="problems-title">{t('problems.title')}</h3>
            <button type="button" className="problems-sheet-close" aria-label={t('common.close')} onClick={close}>
              <X aria-hidden="true" />
            </button>
          </div>
          <ul className="problems-list">
            {problems.map(problem => (
              <li key={problem.id}>
                <TriangleAlert size={20} aria-hidden="true" />
                <span>{problem.title}</span>
                {problem.action && (
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={problem.busy}
                    onClick={() => {
                      close();
                      problem.action?.run();
                    }}
                  >
                    {problem.busy ? t('notice.checking') : problem.action.label}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {onDetails && (
            <button
              type="button"
              className="button button-secondary problems-details"
              onClick={() => {
                close();
                onDetails();
              }}
            >
              {t('common.details')}
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
