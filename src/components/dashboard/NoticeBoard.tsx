import { ChevronRight, Megaphone, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { NoticeBoardProps, NoticeItem } from '../../dashboard/props';
import { NOTICE_ICONS } from './icons';

/** Every row is this tall, so the number that fit is the same whatever the notices say. */
const NOTICE_ROW_HEIGHT = 68;
/** How long a page of notices shows before the next. */
const NOTICE_PAGE_MS = 8000;
/** The fade between pages. */
const FADE_MS = 300;

const severityStyle = (notice: NoticeItem) => ({ '--icon': `var(--${notice.severity})` }) as CSSProperties;

/**
 * The notices, most urgent first, in fixed-height rows; those that don't fit page through, a page every few seconds,
 * and a tap on a page's dots moves on. A row with more to say opens it over the whole panel.
 */
export default function NoticeBoard({ notices }: Readonly<NoticeBoardProps>) {
  const listRef = useRef<HTMLUListElement>(null);
  const [perPage, setPerPage] = useState(1);
  const [page, setPage] = useState(0);
  const [fading, setFading] = useState(false);
  const [open, setOpen] = useState<NoticeItem | null>(null);
  const pageCount = Math.max(1, Math.ceil(notices.length / perPage));
  const shownPage = Math.min(page, pageCount - 1);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => setPerPage(Math.max(1, Math.floor(list.clientHeight / NOTICE_ROW_HEIGHT)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // `turn` counts taps on the dots, so a tap starts the 8 seconds again.
  const [turn, setTurn] = useState(0);
  const next = useCallback(() => {
    setFading(true);
    return window.setTimeout(() => {
      setPage(current => (current + 1) % pageCount);
      setFading(false);
    }, FADE_MS);
  }, [pageCount]);
  useEffect(() => {
    if (open || pageCount < 2) return;
    let fade: number | undefined;
    const timer = window.setInterval(() => {
      fade = next();
    }, NOTICE_PAGE_MS);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(fade);
    };
  }, [pageCount, open, next, turn]);

  const rows = notices.slice(shownPage * perPage, (shownPage + 1) * perPage);
  return (
    <section className="dashboard-notices" aria-labelledby="dashboard-notice-title">
      <h2 className="dashboard-eyebrow" id="dashboard-notice-title">
        <Megaphone className="lucide" style={{ width: 16, height: 16 }} aria-hidden="true" />
        Notice board
        <span className="dashboard-eyebrow-count">{notices.length || ''}</span>
        {pageCount > 1 && (
          <button
            type="button"
            className="dashboard-pages"
            aria-label="Next notices"
            onClick={() => {
              setTurn(current => current + 1);
              next();
            }}
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <i key={index} className={index === shownPage ? 'on' : undefined} />
            ))}
          </button>
        )}
      </h2>
      <ul className={`dashboard-notice-list${fading ? ' fading' : ''}`} ref={listRef}>
        {rows.map(notice => {
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
            <li key={notice.id}>
              {notice.detail ? (
                <button
                  type="button"
                  className="dashboard-notice"
                  style={severityStyle(notice)}
                  onClick={() => setOpen(notice)}
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
      {open && <NoticeSheet notice={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** A notice's full text over the whole panel; a tap anywhere closes it. */
function NoticeSheet({ notice, onClose }: Readonly<{ notice: NoticeItem; onClose: () => void }>) {
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
