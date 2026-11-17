// The Tube status panel's lines, from countdown-server's tfl_network (getNotices and the feed's notices event): TfL's
// /Line/Mode/tube,elizabeth-line/Status as countdown's TfL notices provider stored it. Each line shows the worst of its
// statuses in force now, in TfL's words in sentence case ("Minor delays").

import type { DeviceNotices } from 'countdown-api';
import type { LineHealth, LineStatusItem, TubeStatusProps } from './props';

/** The parts of TfL's Line read here (the contract leaves TfL's answer open). */
interface TflLine {
  id: string;
  name: string;
  lineStatuses?: {
    statusSeverityDescription: string;
    validityPeriods?: { fromDate: string; toDate: string }[];
  }[];
}

// TfL's statuses (/Line/Meta/Severity) by how they look; any other is shown as a disruption.
const HEALTH = new Map<string, LineHealth>([
  ['Good Service', 'good'],
  ['No Issues', 'good'],
  ['Information', 'good'],
  ['Service Closed', 'closed'],
  ['Closed', 'severe'],
  ['Suspended', 'severe'],
  ['Part Suspended', 'severe'],
  ['Planned Closure', 'severe'],
  ['Part Closure', 'severe'],
  ['Severe Delays', 'severe'],
  ['Not Running', 'severe']
]);
const WORST_FIRST: readonly LineHealth[] = ['severe', 'disruption', 'closed', 'good'];

const sentenceCase = (text: string) => text.charAt(0) + text.slice(1).toLowerCase();

/** Whether a status applies at `now`: it has no periods, or one of them covers now. */
function inForce(periods: { fromDate: string; toDate: string }[] | undefined, now: Date): boolean {
  if (!periods?.length) return true;
  const time = now.getTime();
  return periods.some(period => Date.parse(period.fromDate) <= time && time <= Date.parse(period.toDate));
}

function toItem(line: TflLine, now: Date): LineStatusItem {
  const statuses = (line.lineStatuses ?? [])
    .filter(status => inForce(status.validityPeriods, now))
    .map(status => ({
      status: sentenceCase(status.statusSeverityDescription),
      health: HEALTH.get(status.statusSeverityDescription) ?? 'disruption'
    }));
  const worst = statuses.toSorted((a, b) => WORST_FIRST.indexOf(a.health) - WORST_FIRST.indexOf(b.health))[0];
  return { id: line.id, name: line.name, ...(worst ?? { status: 'Good service', health: 'good' }) };
}

/** The panel's lines at `now`, or null when the server has none (outside London, or its provider is down). */
export function toLineStatus(notices: DeviceNotices | null, now: Date): TubeStatusProps | null {
  // An older countdown-server leaves tfl_network out.
  const lines = (notices?.tfl_network?.lines ?? []) as unknown as TflLine[];
  return lines.length > 0 ? { lines: lines.map(line => toItem(line, now)) } : null;
}

/** A row of the Tube status panel: one line, or every line sharing a status. */
export interface LineGroup {
  status: string;
  health: LineHealth;
  /** In TfL's order. */
  lines: LineStatusItem[];
}

/**
 * The panel's rows: lines that share a status collapse into one row, worst first; among rows as bad as each other, a
 * line on its own comes before a shared status, so the collapsed rows (Good service the last of all) sit at the bottom.
 */
export function groupLines(lines: readonly LineStatusItem[]): LineGroup[] {
  const groups: LineGroup[] = [];
  for (const line of lines) {
    const group = groups.find(each => each.status === line.status);
    if (group) group.lines.push(line);
    else groups.push({ status: line.status, health: line.health, lines: [line] });
  }
  const shared = (group: LineGroup) => Number(group.lines.length > 1);
  return groups.toSorted(
    (a, b) => WORST_FIRST.indexOf(a.health) - WORST_FIRST.indexOf(b.health) || shared(a) - shared(b)
  );
}
