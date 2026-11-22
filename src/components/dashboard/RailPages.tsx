import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { groupLines } from '../../dashboard/lineStatus';
import type {
  DayForecast,
  HourlyTrendProps,
  LineIncidentsProps,
  NoticeItem,
  TubeStatusProps
} from '../../dashboard/props';
import { carouselSlot } from './carousel';
import HourlyTrend from './HourlyTrend';
import LineIncidents, { INCIDENT_ROWS } from './LineIncidents';
import Outlook from './Outlook';
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

/** The space between the weather and the outlook, and each of the outlook's rows. */
const OUTLOOK_GAP = 26;
const OUTLOOK_ROW_HEIGHT = 42;
/** The hourly trend's row, and the space under it. */
const TREND_HEIGHT = 52;
const TREND_GAP = 26;
const NO_DAYS: readonly DayForecast[] = [];
/** The fewest days worth an outlook. */
const OUTLOOK_MIN_DAYS = 3;

/** How tall the notices and the Tube's status are on one page, all of them, the heading alone with neither. */
function contentHeight(noticeCount: number, statusRows: number | null): number {
  const status = statusRows === null ? 0 : EYEBROW_HEIGHT + statusRows * LINE_ROW_HEIGHT;
  if (noticeCount === 0) return status || EYEBROW_HEIGHT;
  const notices = EYEBROW_HEIGHT + noticeCount * NOTICE_ROW_HEIGHT;
  return statusRows === null ? notices : notices + GAP + status;
}

/**
 * How many of `days` days the outlook shows over `noticeCount` notices and `statusRows` rows of Tube status in `height`
 * pixels: as many as fit (up to all of them) while every notice and the status still fit on one page; none if fewer than
 * three would.
 */
export function outlookDays(days: number, noticeCount: number, statusRows: number | null, height: number): number {
  const room = height - contentHeight(noticeCount, statusRows) - OUTLOOK_GAP;
  const rows = Math.min(days, Math.floor(room / OUTLOOK_ROW_HEIGHT));
  return rows >= OUTLOOK_MIN_DAYS ? rows : 0;
}

interface RailPagesProps {
  notices: readonly NoticeItem[];
  lineStatus: TubeStatusProps | null;
  /** The incidents at the kiosk's Norwegian stops, in the Tube's status's place (which wins if there are both). */
  incidents?: LineIncidentsProps | null | undefined;
  /** The days after today, shown over the notices while there is room for them; none when left out. */
  days?: readonly DayForecast[] | undefined;
  /** The coming hours' trend, always under the weather and the outlook; none when null or left out. */
  trend?: HourlyTrendProps | null | undefined;
  /** The Dashboard's clock, which turns the pages with the boards along the bottom. */
  time: number;
}

/**
 * The rail under the weather: the next days' outlook while there is room for it, the coming hours' trend, then the notices with the Tube's
 * status under them, built up from the bottom. When they don't all fit, the outlook makes way and they page through the
 * way the boards along the bottom do, at the same time.
 */
export default function RailPages({
  notices,
  lineStatus,
  incidents = null,
  days = NO_DAYS,
  trend = null,
  time
}: Readonly<RailPagesProps>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [open, setOpen] = useState<NoticeItem | null>(null);
  const arriving = useArrivals(notices);

  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const incidentRows = incidents ? incidents.incidents.length * INCIDENT_ROWS : null;
  const statusRows = lineStatus ? groupLines(lineStatus.lines).length : incidentRows;
  const belowTrend = trend ? height - TREND_HEIGHT - TREND_GAP : height;
  const shownDays = height > 0 ? outlookDays(days.length, notices.length, statusRows, belowTrend) : 0;
  const pagesHeight = shownDays ? belowTrend - OUTLOOK_GAP - shownDays * OUTLOOK_ROW_HEIGHT : belowTrend;
  const pages = railPages(notices.length, statusRows, pagesHeight);

  return (
    <>
      <div className="dashboard-rail-body" ref={bodyRef}>
        {shownDays > 0 && <Outlook days={days.slice(0, shownDays)} />}
        {trend && <HourlyTrend {...trend} />}
        <div className="dashboard-rail-pages">
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
                {page.status && !lineStatus && incidents && <LineIncidents {...incidents} />}
              </div>
            );
          })}
        </div>
      </div>
      {open && <NoticeSheet notice={open} onClose={() => setOpen(null)} />}
    </>
  );
}
