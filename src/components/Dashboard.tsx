import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
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
import HourlyStrip from './dashboard/HourlyStrip';
import { carouselSlot, TURN_MS } from './dashboard/carousel';
import DepartureBoard from './dashboard/DepartureBoard';
import TabBar from './dashboard/TabBar';
import RailPages from './dashboard/RailPages';
import { DayOutlook, HourCurve } from './dashboard/RailExtras';
import WeatherBlock from './dashboard/WeatherBlock';
import './dashboard/dashboard.css';

const PANEL_WIDTH = 1280;
const PANEL_HEIGHT = 800;

/** With more than two stops, how often the boards move along by one. */
export const BOARD_TURN_MS = TURN_MS;

/**
 * Where board `index` of `count` is at `time`, by the boards' clock: 0 and 1 are the two places along the bottom; -1
 * is just off to the left, where the board that has just left slid; 2 is off to the right, where the rest wait.
 */
export const boardSlot = (index: number, count: number, time: number): number => carouselSlot(index, count, time, 2);

/** What the Dashboard draws; each part has its own props (src/dashboard/props.ts). */
export interface DashboardProps {
  tabBar: TabBarProps;
  weather: WeatherBlockProps;
  /** Null while there is no forecast to read; the strip's space stays empty. */
  hourly: HourlyStripProps | null;
  notices: NoticeBoardProps;
  /** Every Tube line's status, at the bottom of the rail under the notices; null (or left out) without. */
  lineStatus?: TubeStatusProps | null;
  /** A board per stop, in the owner's order: each Tube station and each bus stop has its own. */
  boards: DepartureBoardProps[];
  /** The day's photo; a new one fades in slowly over the old. Left out (or null) for the photo bundled with the app. */
  backdrop?: string | null;
}

/**
 * The Dashboard: the photo full screen, the tab bar floating on it, weather on the left with the notices and the Tube's
 * status under it, the hourly forecast
 * top right and a board per Tube station and bus stop along the bottom, two at a time. It is laid out at 1280×800 and scaled to fit whichever of the
 * space's width or height is tighter, centred, so a smaller panel shows the same layout.
 */
export default function Dashboard({
  tabBar,
  weather,
  hourly,
  notices,
  lineStatus = null,
  boards,
  backdrop
}: Readonly<DashboardProps>) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ scale: 1, left: 0, top: 0 });
  // Two boards at a time; with more, they move along one at a time, with the boards' clock so a hidden Dashboard,
  // whose clock stops, doesn't move. Every board stays mounted, so its rows keep following their vehicles. The rail's
  // pages turn with them.
  const time = (boards[0]?.now ?? tabBar.now).getTime();
  // Prototype: which use of the rail's empty space to draw (?rail=days|hours|photo), with no notices only.
  const quiet = notices.notices.length === 0;
  const railOption = quiet ? new URLSearchParams(window.location.search).get('rail') : null;

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
    <div className="dashboard" ref={fitRef} data-rail={railOption ?? undefined}>
      <div
        className="dashboard-scaler"
        style={{ transform: `translate(${placement.left}px, ${placement.top}px) scale(${placement.scale})` }}
      >
        <div className="dashboard-panel">
          <Backdrop url={backdrop ?? fallbackBackdrop} />
          <TabBar {...tabBar} />
          <main className="dashboard-main">
            <div className="dashboard-rail">
              <WeatherBlock {...weather} hero={railOption !== null} />
              {railOption === 'days' && hourly && <DayOutlook days={hourly.days ?? []} />}
              {railOption === 'hours' && hourly && <HourCurve hours={hourly.hours} clockFormat={hourly.clockFormat} />}
              <RailPages notices={notices.notices} lineStatus={lineStatus} time={time} />
            </div>
            <div className="dashboard-stage">
              <div className="dashboard-sky shadowed">{hourly && railOption !== 'hours' && <HourlyStrip {...hourly} />}</div>
              <div className="dashboard-departures">
                <div className="dashboard-departures-track">
                  {boards.map((board, index) => {
                    const slot = boardSlot(index, boards.length, time);
                    const isShown = slot === 0 || slot === 1;
                    return (
                      <div
                        key={board.id}
                        className="dashboard-departures-slot"
                        data-slot={slot}
                        data-board={board.id}
                        inert={!isShown}
                        style={{ '--slot': slot } as CSSProperties}
                      >
                        <DepartureBoard {...board} />
                      </div>
                    );
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
