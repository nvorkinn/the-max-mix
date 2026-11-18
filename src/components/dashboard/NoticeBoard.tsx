import { ChevronRight, Megaphone, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import type { NoticeItem } from '../../dashboard/props';
import { NOTICE_ICONS } from './icons';

/** Every row is this tall, so the number that fit is the same whatever the notices say. */
export const NOTICE_ROW_HEIGHT = 68;
/** How long a notice new to the board takes to fade in. */
export const ARRIVE_MS = 600;

const severityStyle = (notice: NoticeItem) => ({ '--icon': `var(--${notice.severity})` }) as CSSProperties;

interface NoticeBoardPageProps {
  /** The notices on this page, most urgent first. */
  notices: readonly NoticeItem[];
  /** How many notices there are in all, across the pages. */
  count: number;
  /** The notices that are new to the board, fading in. */
  arriving: ReadonlySet<string>;
  /** Opens a notice's full text. */
  onOpen: (notice: NoticeItem) => void;
}

/** A page of the notices, in fixed-height rows. A row with more to say opens it over the whole panel. */
export default function NoticeBoard({ notices, count, arriving, onOpen }: Readonly<NoticeBoardPageProps>) {
  const titleId = useId();
  return (
    <section className="dashboard-notices" aria-labelledby={titleId}>
      <h2 className="dashboard-eyebrow" id={titleId}>
        <Megaphone className="lucide" style={{ width: 16, height: 16 }} aria-hidden="true" />
        Notice board
        <span className="dashboard-eyebrow-count">{count || ''}</span>
      </h2>
      <ul className="dashboard-notice-list">
        {notices.map(notice => {
          const Icon = NOTICE_ICONS[notice.kind];
          const content = (
            <>
              <span className="dashboard-notice-icon">
                <Icon className="lucide" aria-hidden="true" />
              </span>
              <span className="dashboard-notice-body">
                <span className="dashboard-notice-title">{notice.title}</span>
                <span className="dashboard-notice-summary">{notice.summary}</span>
              </span>
              {notice.detail && <ChevronRight className="lucide dashboard-notice-chevron" aria-hidden="true" />}
            </>
          );
          return (
            <li key={notice.id} data-arriving={arriving.has(notice.id) || undefined}>
              {notice.detail ? (
                <button
                  type="button"
                  className="dashboard-notice"
                  style={severityStyle(notice)}
                  onClick={() => onOpen(notice)}
                >
                  {content}
                </button>
              ) : (
                <div className="dashboard-notice" style={severityStyle(notice)}>
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The ids of the notices that weren't on the board the last time it drew, for as long as they take to fade in. Those it
 * starts with are not new: they show at once.
 */
export function useArrivals(notices: readonly NoticeItem[]): ReadonlySet<string> {
  const signature = notices.map(notice => notice.id).join('\n');
  const [known, setKnown] = useState<string | null>(null);
  const [arriving, setArriving] = useState<ReadonlySet<string>>(() => new Set());
  if (signature !== known) {
    if (known !== null) {
      const before = new Set(known.split('\n'));
      const added = notices.map(notice => notice.id).filter(id => !before.has(id));
      if (added.length > 0) setArriving(current => new Set([...current, ...added]));
    }
    setKnown(signature);
  }
  useEffect(() => {
    if (arriving.size === 0) return;
    const timer = window.setTimeout(() => setArriving(new Set()), ARRIVE_MS);
    return () => window.clearTimeout(timer);
  }, [arriving]);
  return arriving;
}

/** A notice's full text over the whole panel; a tap anywhere closes it. */
export function NoticeSheet({ notice, onClose }: Readonly<{ notice: NoticeItem; onClose: () => void }>) {
  const Icon = NOTICE_ICONS[notice.kind];
  return (
    <div className="dashboard-sheet" role="presentation" onClick={onClose}>
      <div className="dashboard-sheet-card" role="dialog" aria-modal="true" aria-labelledby="dashboard-sheet-title">
        <div className="dashboard-sheet-head" style={severityStyle(notice)}>
          <Icon className="lucide" aria-hidden="true" />
          <h2 id="dashboard-sheet-title">{notice.title}</h2>
        </div>
        <p>{notice.detail}</p>
        <button type="button" className="dashboard-icon-button" aria-label="Close" onClick={onClose}>
          <X className="lucide" />
        </button>
      </div>
    </div>
  );
}
