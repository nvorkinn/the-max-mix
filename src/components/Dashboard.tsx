import { useLayoutEffect, useRef, useState } from 'react';
import fallbackBackdrop from '../assets/dashboard/backdrop.jpg';
import type {
  DepartureBoardProps,
  HourlyTrendProps,
  LineIncidentsProps,
  NoticeBoardProps,
  OutlookProps,
  TabBarProps,
  TubeStatusProps,
  WeatherBlockProps
} from '../dashboard/props';
import Backdrop from './dashboard/Backdrop';
import { useArrivalsTransition } from '../utils/arrivalsTransition';
import BoardSlot from './dashboard/BoardSlot';
import { TURN_MS } from './dashboard/carousel';
import TabBar from './dashboard/TabBar';
import RailPages from './dashboard/RailPages';
import WeatherBlock from './dashboard/WeatherBlock';
import './dashboard/dashboard.css';

const PANEL_WIDTH = 1280;
const PANEL_HEIGHT = 800;

/** With more than two stops, how often one of the two places along the bottom changes to another stop. */
export const BOARD_TURN_MS = TURN_MS;

/**
 * Which of `count` boards the two places along the bottom show at `time`, by the boards' clock: left, then right (just
 * the one with a single board). With more than two, every BOARD_TURN_MS one place changes, the left and the right in
 * turn, to the next stop in the owner's order; a board never crosses from one place to the other. With stops A, B and
 * C: A+B, C+B, C+A, B+A, B+C, A+C, then A+B again.
 */
export function shownBoards(count: number, time: number): number[] {
  if (count <= 2) return Array.from({ length: count }, (_, index) => index);
  const turn = Math.floor(time / BOARD_TURN_MS);
  // Turn t brings stop t + 1 in, alternately on the left and on the right: each place shows the latest one it took.
  return [0, 1].map(slot => {
    const latest = turn + 1 - ((turn + 1 - slot) % 2);
    return ((latest % count) + count) % count;
  });
}

/** What the Dashboard draws; each part has its own props (src/dashboard/props.ts). */
export interface DashboardProps {
  tabBar: TabBarProps;
  weather: WeatherBlockProps;
  /** How the weather's hourly trend is drawn; null while there is no forecast to read. */
  hourly: HourlyTrendProps | null;
  notices: NoticeBoardProps;
  /** The days after today, under the weather and its trend while the rail has room; null (or left out) without. */
  outlook?: OutlookProps | null;
  /** Every Tube line's status, at the bottom of the rail under the notices; null (or left out) without. */
  lineStatus?: TubeStatusProps | null;
  /** The incidents on the lines at the kiosk's Norwegian stops, in the Tube status's place; null (or left out) without. */
  incidents?: LineIncidentsProps | null;
  /** A board per stop, in the owner's order: each Tube station and each bus stop has its own. */
  boards: DepartureBoardProps[];
  /** The day's photo; a new one fades in slowly over the old. Left out (or null) for the photo bundled with the app. */
  backdrop?: string | null;
}

/**
 * The Dashboard: the photo full screen, the tab bar floating on it, weather on the left with the coming hours' trend
 * right under it, then (while there's room) the next days, the notices and the Tube's status, and a board per
 * Tube station and bus stop along the bottom, two at a time. It is laid out at 1280×800 and scaled to fit whichever of the
 * space's width or height is tighter, centred, so a smaller panel shows the same layout.
 */
export default function Dashboard({
  tabBar,
  weather,
  hourly,
  notices,
  outlook = null,
  lineStatus = null,
  incidents = null,
  boards,
  backdrop
}: Readonly<DashboardProps>) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ scale: 1, left: 0, top: 0 });
  // Two boards at a time; with more, one place changes stop a turn, with the boards' clock so a hidden Dashboard,
  // whose clock stops, doesn't change. The rail's pages and the weather's periods turn with them, on the same clock.
  const time = (boards[0]?.now ?? tabBar.now).getTime();
  const transition = useArrivalsTransition();

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
              <WeatherBlock {...weather} time={time} trend={hourly} />
              <RailPages
                notices={notices.notices}
                lineStatus={lineStatus}
                incidents={incidents}
                days={outlook?.days}
                time={time}
              />
            </div>
            <div className="dashboard-stage">
              <div className="dashboard-sky" />
              <div className="dashboard-departures">
                <div className="dashboard-departures-track">
                  {shownBoards(boards.length, time).map((index, slot) => {
                    const board = boards[index];
                    return board && <BoardSlot key={slot} slot={slot} board={board} transition={transition} />;
                  })}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
