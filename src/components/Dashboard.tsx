import { useLayoutEffect, useRef, useState } from 'react';
import fallbackBackdrop from '../assets/dashboard/backdrop.jpg';
import type {
  DepartureBoardProps,
  HourlyStripProps,
  NoticeBoardProps,
  TabBarProps,
  WeatherBlockProps
} from '../dashboard/props';
import Backdrop from './dashboard/Backdrop';
import BusBoard from './dashboard/BusBoard';
import HourlyStrip from './dashboard/HourlyStrip';
import NoticeBoard from './dashboard/NoticeBoard';
import TabBar from './dashboard/TabBar';
import TubeBoard from './dashboard/TubeBoard';
import WeatherBlock from './dashboard/WeatherBlock';
import './dashboard/dashboard.css';

const PANEL_WIDTH = 1280;
const PANEL_HEIGHT = 800;

/** The most boards the bottom has room for: three across, two deep. Any more (the owner's last stops) aren't shown. */
const MAX_BOARDS = 6;

/**
 * How the boards share the bottom: up to three side by side with four rows each (one or two take half each, as two
 * always have), and four to six in two lines of two or three, with two rows each.
 */
function boardsLayout(count: number): { columns: 2 | 3; rows: 2 | 4 } {
  return { columns: count === 4 || count <= 2 ? 2 : 3, rows: count > 3 ? 2 : 4 };
}

/** What the Dashboard draws; each part has its own props (src/dashboard/props.ts). */
export interface DashboardProps {
  tabBar: TabBarProps;
  weather: WeatherBlockProps;
  /** Null while there is no forecast to read; the strip's space stays empty. */
  hourly: HourlyStripProps | null;
  notices: NoticeBoardProps;
  /** A board per stop, in the owner's order: each Tube station and each bus stop has its own. */
  boards: DepartureBoardProps[];
  /** The day's photo; a new one fades in slowly over the old. Left out (or null) for the photo bundled with the app. */
  backdrop?: string | null;
}

/**
 * The Dashboard: the photo full screen, the tab bar floating on it, weather and notices on the left, the hourly forecast
 * top right and a board per Tube station and bus stop along the bottom. It is laid out at 1280×800 and scaled to fit whichever of the
 * space's width or height is tighter, centred, so a smaller panel shows the same layout.
 */
export default function Dashboard({ tabBar, weather, hourly, notices, boards, backdrop }: Readonly<DashboardProps>) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ scale: 1, left: 0, top: 0 });
  const shown = boards.slice(0, MAX_BOARDS);
  const { columns, rows } = boardsLayout(shown.length);

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
              <NoticeBoard {...notices} />
            </div>
            <div className="dashboard-stage">
              <div className="dashboard-sky shadowed">{hourly && <HourlyStrip {...hourly} />}</div>
              <div className="dashboard-departures" data-columns={columns} data-rows={rows}>
                {shown.map(board =>
                  board.kind === 'tube' ? (
                    <TubeBoard key={board.id} {...board} rows={rows} />
                  ) : (
                    <BusBoard key={board.id} {...board} rows={rows} />
                  )
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
