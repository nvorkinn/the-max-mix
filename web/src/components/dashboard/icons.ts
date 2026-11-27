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
  TriangleAlert
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NoticeKind, Sky } from '../../dashboard/props';

/** The icon for each kind of weather, by day and by night. */
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

/** The Overground's orange, which all six of its lines share. */
const OVERGROUND = ['#ee7c0e', '#fff'] as const;

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
  liberty: OVERGROUND,
  lioness: OVERGROUND,
  metropolitan: ['#9b0056', '#fff'],
  mildmay: OVERGROUND,
  northern: ['#111', '#fff'],
  overground: OVERGROUND,
  piccadilly: ['#003688', '#fff'],
  suffragette: OVERGROUND,
  victoria: ['#0098d4', '#fff'],
  'waterloo-city': ['#95cdba', '#000'],
  weaver: OVERGROUND,
  windrush: OVERGROUND
};
export const FALLBACK_LINE_COLOURS: readonly [string, string] = ['#3a4252', '#fff'];

/**
 * The lines whose first letter wouldn't name them, by TfL's line id: the DLR by its own name, the two "& City" lines by
 * TfL's short forms, and the Overground lines that share a letter (and its orange) by their first few.
 */
const LINE_MARKS: Record<string, string> = {
  dlr: 'DLR',
  'hammersmith-city': 'H&C',
  'waterloo-city': 'W&C',
  liberty: 'Lib',
  lioness: 'Lion',
  weaver: 'Wea',
  windrush: 'Win'
};

/**
 * A line as its departure's square writes it: its first letter ("C" for both Central and Circle, told apart by their
 * colours), or the DLR's or TfL's short form for the few a letter wouldn't name ("H&C").
 */
export const lineMark = (lineId: string, name: string): string => LINE_MARKS[lineId] ?? name.charAt(0).toUpperCase();

/** Whole minutes until `expectedAt`, none below zero: 0 reads "Due". */
export function minutesUntil(expectedAt: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(expectedAt).getTime() - now.getTime()) / 60_000));
}
