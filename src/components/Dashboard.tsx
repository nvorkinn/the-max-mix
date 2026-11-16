import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import backdrop from '../assets/dashboard/backdrop.jpg';
import type {
  BusBoardProps,
  HourlyStripProps,
  NoticeBoardProps,
  TabBarProps,
  TubeBoardProps,
  WeatherBlockProps
} from '../dashboard/props';
import BusBoard from './dashboard/BusBoard';
import HourlyStrip from './dashboard/HourlyStrip';
import NoticeBoard from './dashboard/NoticeBoard';
import TabBar from './dashboard/TabBar';
import TubeBoard from './dashboard/TubeBoard';
import WeatherBlock from './dashboard/WeatherBlock';
import './dashboard/dashboard.css';

const PANEL_WIDTH = 1280;
const PANEL_HEIGHT = 800;

/** What the Dashboard draws; each part has its own props (src/dashboard/props.ts). */
export interface DashboardProps {
  tabBar: TabBarProps;
  weather: WeatherBlockProps;
  /** Null while there is no forecast to read; the strip's space stays empty. */
  hourly: HourlyStripProps | null;
  notices: NoticeBoardProps;
  /** Null while there is no Tube stop's departures; the board's space stays empty. */
  tube: TubeBoardProps | null;
  /** As `tube`, for the bus stop. */
  bus: BusBoardProps | null;
}

/**
 * The Dashboard: the photo full screen, the tab bar floating on it, weather and notices on the left, the hourly forecast
 * top right and the Tube and bus boards along the bottom. It is laid out at 1280×800 and scaled to fit whichever of the
 * space's width or height is tighter, centred, so a smaller panel shows the same layout.
 */
export default function Dashboard({ tabBar, weather, hourly, notices, tube, bus }: Readonly<DashboardProps>) {
  const fitRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({ scale: 1, left: 0, top: 0 });

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
        <div className="dashboard-panel" style={{ '--backdrop': `url(${backdrop})` } as CSSProperties}>
          <TabBar {...tabBar} />
          <main className="dashboard-main">
            <div className="dashboard-rail">
              <WeatherBlock {...weather} />
              <NoticeBoard {...notices} />
            </div>
            <div className="dashboard-stage">
              <div className="dashboard-sky shadowed">{hourly && <HourlyStrip {...hourly} />}</div>
              <div className="dashboard-departures">
                {tube ? <TubeBoard {...tube} /> : <div className="dashboard-board" />}
                {bus ? <BusBoard {...bus} /> : <div className="dashboard-board" />}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
