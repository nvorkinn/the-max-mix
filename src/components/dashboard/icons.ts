import {
  CalendarDays,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Construction,
  Moon,
  OctagonX,
  Package,
  Recycle,
  Sun,
  TrainFront,
  TriangleAlert,
  createLucideIcon
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NoticeKind, Sky } from '../../dashboard/props';

/** The icon for each kind of weather, by day and by night. */
/**
 * A train side-on on its rail, drawn like lucide's side-on Bus (lucide's own Train is front-on): heads a station that
 * isn't TfL's, where the roundel would be wrong.
 */
export const SideTrain = createLucideIcon('side-train', [
  ['path', { d: 'M3 17h16.5a2 2 0 0 0 1.9-2.6l-1.2-3.8A6.5 6.5 0 0 0 14 6H5a2 2 0 0 0-2 2z', key: 'body' }],
  ['path', { d: 'M3 11h17.4', key: 'windows' }],
  ['path', { d: 'M8 6v5', key: 'pillar-1' }],
  ['path', { d: 'M13 6v5', key: 'pillar-2' }],
  ['path', { d: 'M2 21h20', key: 'rail' }]
]);

export const SKY_ICONS: Record<Sky, { day: LucideIcon; night: LucideIcon }> = {
  clear: { day: Sun, night: Moon },
  'partly-cloudy': { day: CloudSun, night: CloudMoon },
  cloudy: { day: Cloud, night: Cloud },
  fog: { day: CloudFog, night: CloudFog },
  drizzle: { day: CloudDrizzle, night: CloudDrizzle },
  rain: { day: CloudRain, night: CloudRain },
  snow: { day: CloudSnow, night: CloudSnow },
  thunder: { day: CloudLightning, night: CloudLightning }
};

/** The sun peeks out of these by day, so they are drawn in its yellow. */
export const sunny = (sky: Sky, isDay: boolean): boolean => isDay && (sky === 'clear' || sky === 'partly-cloudy');

export const NOTICE_ICONS: Record<NoticeKind, LucideIcon> = {
  'weather-warning': CloudRainWind,
  delays: TriangleAlert,
  closure: OctagonX,
  'planned-works': TrainFront,
  'road-works': Construction,
  'bank-holiday': CalendarDays,
  bins: Recycle,
  parcel: Package
};

/** TfL's line colours and the text that reads on each, by TfL's line id. */
export const LINE_COLOURS: Record<string, readonly [background: string, text: string]> = {
  bakerloo: ['#a45a2a', '#fff'],
  central: ['#e32017', '#fff'],
  circle: ['#ffd300', '#000'],
  district: ['#00782a', '#fff'],
  dlr: ['#00a4a7', '#fff'],
  elizabeth: ['#6950a1', '#fff'],
  'hammersmith-city': ['#f3a9bb', '#000'],
  jubilee: ['#a0a5a9', '#000'],
  metropolitan: ['#9b0056', '#fff'],
  northern: ['#111', '#fff'],
  overground: ['#ee7c0e', '#fff'],
  piccadilly: ['#003688', '#fff'],
  victoria: ['#0098d4', '#fff'],
  'waterloo-city': ['#95cdba', '#000']
};
export const FALLBACK_LINE_COLOURS: readonly [string, string] = ['#3a4252', '#fff'];

/** Whole minutes until `expectedAt`, none below zero: 0 reads "Due". */
export function minutesUntil(expectedAt: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(expectedAt).getTime() - now.getTime()) / 60_000));
}
