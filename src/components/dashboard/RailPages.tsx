import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { groupLines } from '../../dashboard/lineStatus';
import type { NoticeItem, TubeStatusProps } from '../../dashboard/props';
import { carouselSlot } from './carousel';
import NoticeBoard, { NOTICE_ROW_HEIGHT, NoticeSheet, useArrivals } from './NoticeBoard';
import TubeStatus, { LINE_ROW_HEIGHT } from './TubeStatus';

/** The heading over the notices and over the Tube's status. */
const EYEBROW_HEIGHT = 34;
/** The space between the notices and the Tube's status. */
const GAP = 24;

/** A page of the rail: notices `from` up to `to`, and the Tube's status under them if `status`. */
export interface RailPage {
  from: number;
  to: number;
  status: boolean;
}

/**
 * The rail's pages, for `noticeCount` notices in fixed-height rows and, unless `statusRows` is null, the Tube's status
 * in that many rows, in `height` pixels: one page with the notices over the status when they fit; otherwise as many
 * notices as fit a page, and the status under the last page's notices if it fits there, else on a page of its own.
 * With nothing to show, the notice board's heading on its own.
 */
export function railPages(noticeCount: number, statusRows: number | null, height: number): RailPage[] {
  if (noticeCount === 0) return [{ from: 0, to: 0, status: statusRows !== null }];
  const status = statusRows === null ? null : EYEBROW_HEIGHT + statusRows * LINE_ROW_HEIGHT;
  const noticesHeight = (count: number) => EYEBROW_HEIGHT + count * NOTICE_ROW_HEIGHT;
  if (status !== null && noticesHeight(noticeCount) + GAP + status <= height) {
    return [{ from: 0, to: noticeCount, status: true }];
  }
  const perPage = Math.max(1, Math.floor((height - EYEBROW_HEIGHT) / NOTICE_ROW_HEIGHT));
  const pages: RailPage[] = [];
  for (let from = 0; from < noticeCount; from += perPage) {
    pages.push({ from, to: Math.min(noticeCount, from + perPage), status: false });
  }
  const last = pages.at(-1);
  if (status === null || !last) return pages;
  if (noticesHeight(last.to - last.from) + GAP + status <= height) last.status = true;
  else pages.push({ from: noticeCount, to: noticeCount, status: true });
  return pages;
}

interface RailPagesProps {
  notices: readonly NoticeItem[];
  lineStatus: TubeStatusProps | null;
  /** The Dashboard's clock, which turns the pages with the boards along the bottom. */
  time: number;
}

/**
 * The rail under the weather: the notices with the Tube's status under them, built up from the bottom. When they
 * don't all fit, they page through the way the boards along the bottom do, at the same time.
 */
export default function RailPages({ notices, lineStatus, time }: Readonly<RailPagesProps>) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [open, setOpen] = useState<NoticeItem | null>(null);
  const arriving = useArrivals(notices);

  useLayoutEffect(() => {
    const element = pagesRef.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pages = railPages(notices.length, lineStatus ? groupLines(lineStatus.lines).length : null, height);
  return (
    <>
      <div className="dashboard-rail-pages" ref={pagesRef}>
        {pages.map((page, index) => {
          const slot = carouselSlot(index, pages.length, time, 1);
          return (
            <div
              key={`${String(page.from)}:${String(page.status)}`}
              className="dashboard-rail-page"
              data-slot={slot}
              inert={slot !== 0}
              style={{ '--slot': slot } as CSSProperties}
            >
              {(page.to > page.from || !page.status) && (
                <NoticeBoard
                  notices={notices.slice(page.from, page.to)}
                  count={notices.length}
                  arriving={arriving}
                  onOpen={setOpen}
                />
              )}
              {page.status && lineStatus && <TubeStatus {...lineStatus} />}
            </div>
          );
        })}
      </div>
      {open && <NoticeSheet notice={open} onClose={() => setOpen(null)} />}
    </>
  );
}
