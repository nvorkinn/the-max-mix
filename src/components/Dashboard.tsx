import { useLayoutEffect, useRef, useState } from 'react';
import fallbackBackdrop from '../assets/dashboard/backdrop.jpg';
import type {
  DepartureBoardProps,
  HourlyStripProps,
  NoticeBoardProps,
  TabBarProps,
  TubeStatusProps,
  WeatherBlockProps
} from '../dashboard/props';
import Backdrop from './dashboard/Backdrop';
import BusBoard from './dashboard/BusBoard';
import HourlyStrip from './dashboard/HourlyStrip';
import NoticeBoard from './dashboard/NoticeBoard';
import TabBar from './dashboard/TabBar';
import TubeBoard from './dashboard/TubeBoard';
import TubeStatus from './dashboard/TubeStatus';
import WeatherBlock from './dashboard/WeatherBlock';
import './dashboard/dashboard.css';

const PANEL_WIDTH = 1280;
const PANEL_HEIGHT = 800;

/** How long a pair of boards shows before the next pair, when the kiosk has more than two stops. */
export const BOARD_PAGE_MS = 15_000;

/** The boards in pairs, side by side: a page each. */
function pairs<T>(items: readonly T[]): T[][] {
  return Array.from({ length: Math.ceil(items.length / 2) }, (_, index) => items.slice(index * 2, index * 2 + 2));
}

/** What the Dashboard draws; each part has its own props (src/dashboard/props.ts). */
export interface DashboardProps {
  tabBar: TabBarProps;
  weather: WeatherBlockProps;
  /** Null while there is no forecast to read; the strip's space stays empty. */
  hourly: HourlyStripProps | null;
  notices: NoticeBoardProps;
  /** Every Tube line's status, shown in the notice board's place while it has no notices; null (or left out) without. */
  lineStatus?: TubeStatusProps | null;
  /** A board per stop, in the owner's order: each Tube station and each bus stop has its own. */
  boards: DepartureBoardProps[];
  /** The day's photo; a new one fades in slowly over the old. Left out (or null) for the photo bundled with the app. */
  backdrop?: string | null;
}

/**
 * The Dashboard: the photo full screen, the tab bar floating on it, weather and notices on the left (the Tube's status while there
 * are no notices), the hourly forecast
 * top right and a board per Tube station and bus stop along the bottom, two at a time. It is laid out at 1280×800 and scaled to fit whichever of the
 * space's width or height is tighter, centred, so a smaller panel shows the same layout.
 */
export default function Dashboard({
  tabBar,
  weather,
  hourly,
  notices,
  lineStatus,
  boards,
  backdrop
}: Readonly<DashboardProps>) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ scale: 1, left: 0, top: 0 });
  // Two boards at a time; with more, the pairs take turns, moving on with the boards' clock so a hidden Dashboard,
  // whose clock stops, doesn't turn. Every board stays mounted, so its rows keep following their vehicles.
  const pages = pairs(boards);
  const time = boards[0]?.now.getTime() ?? 0;
  const shownPage = pages.length > 1 ? Math.floor(time / BOARD_PAGE_MS) % pages.length : 0;

  useLayoutEffect(() => {
    const element = fitRef.current;
    if (!element) return;
    const measure = () => {
      const { clientWidth, clientHeight } = element;
      if (!clientWidth || !clientHeight) return;
      const scale = Math.min(clientWidth / PANEL_WIDTH, clientHeight / PANEL_HEIGHT);
      setPlacement({
        scale,
        left: (clientWidth - PANEL_WIDTH * scale) / 2,
        top: (clientHeight - PANEL_HEIGHT * scale) / 2
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="dashboard" ref={fitRef}>
      <div
        className="dashboard-scaler"
        style={{ transform: `translate(${placement.left}px, ${placement.top}px) scale(${placement.scale})` }}
      >
        <div className="dashboard-panel">
          <Backdrop url={backdrop ?? fallbackBackdrop} />
          <TabBar {...tabBar} />
          <main className="dashboard-main">
            <div className="dashboard-rail">
              <WeatherBlock {...weather} />
              {lineStatus && notices.notices.length === 0 ? (
                <TubeStatus {...lineStatus} />
              ) : (
                <NoticeBoard {...notices} />
              )}
            </div>
            <div className="dashboard-stage">
              <div className="dashboard-sky shadowed">{hourly && <HourlyStrip {...hourly} />}</div>
              <div className="dashboard-departures">
                {pages.map((page, index) => (
                  <div
                    // A page is its first board's: the pair keeps its fade when another stop is added or removed.
                    key={page[0]?.id}
                    className="dashboard-departures-page"
                    data-shown={index === shownPage}
                    inert={index !== shownPage}
                  >
                    {page.map(board =>
                      board.kind === 'tube' ? (
                        <TubeBoard key={board.id} {...board} />
                      ) : (
                        <BusBoard key={board.id} {...board} />
                      )
                    )}
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
