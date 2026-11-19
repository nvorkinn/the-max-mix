// The owner's parcels on the notice board, from countdown-server's getNotices (DeviceNotices.parcels): what the parcel
// provider stored for the kiosk (v1:parcels:<device id>), already narrowed to the parcels its settings show. They're
// grouped as the e-paper screens group them (countdown's renderer, notices/parcels.py): one notice for the parcels out
// for delivery, one for those that need the owner, one for the late ones, one for each day parcels are due, one for
// those with no day yet and one for those just delivered. A notice for one parcel names it; for several, it counts
// them and names them in its line. The words are the kiosk's own: the e-paper screens word theirs with countdown's
// own catalog, not countdown-api's.

import type { Parcel } from 'countdown-api';
import type { Notice } from './data';
import { say } from './messages';

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (time: Date) => `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;

/** Its own notice whatever day it's due. */
const NOT_BY_DAY: ReadonlySet<Parcel['status']> = new Set(['delivered', 'exception', 'out_for_delivery']);

/** "today", "tomorrow" or "Thu 20 Nov", for a day (YYYY-MM-DD, the owner's) on or after today. */
function arrivingWhen(day: string, now: Date): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (day === localDay(now)) return say('notice.day.today').toLowerCase();
  if (day === localDay(tomorrow)) return say('notice.day.tomorrow').toLowerCase();
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '');
}

/** A notice about `group`: `one` for a single parcel, `several(n)` for more, with their names as its line. */
function groupNotice(
  id: string,
  group: readonly Parcel[],
  severity: Notice['severity'],
  one: string,
  several: (n: number) => string
): Notice {
  const names = group.map(parcel => parcel.description.trim() || parcel.tracking_number);
  return {
    id: `parcel:${id}`,
    kind: 'parcel',
    severity,
    title: group.length === 1 ? one : several(group.length),
    summary: names.join(', '),
    detail: group.map((parcel, index) => `${names[index]} (${parcel.carrier}, ${parcel.tracking_number})`).join('\n')
  };
}

/**
 * The notices for `parcels` as of `now`: those out for delivery and those that need the owner first (shown in blue),
 * then the late ones, each day's from the soonest, the undated and the delivered (everyday notices, in white).
 */
export function parcelNotices(parcels: readonly Parcel[], now: Date): Notice[] {
  const today = localDay(now);
  const out = parcels.filter(parcel => parcel.status === 'out_for_delivery');
  const held = parcels.filter(parcel => parcel.status === 'exception');
  const delivered = parcels.filter(parcel => parcel.status === 'delivered');
  const coming = parcels.filter(parcel => !NOT_BY_DAY.has(parcel.status));
  const late = coming.filter(parcel => parcel.expected_date != null && parcel.expected_date < today);
  const undated = coming.filter(parcel => parcel.expected_date == null);
  const byDay = new Map<string, Parcel[]>();
  for (const parcel of coming) {
    const day = parcel.expected_date;
    if (day != null && day >= today) byDay.set(day, [...(byDay.get(day) ?? []), parcel]);
  }

  const notices: Notice[] = [];
  if (out.length > 0) {
    notices.push(groupNotice('out', out, 'info', 'Parcel out for delivery', n => `${n} parcels out for delivery`));
  }
  if (held.length > 0) {
    notices.push(groupNotice('held', held, 'info', 'Parcel needs attention', n => `${n} parcels need attention`));
  }
  if (late.length > 0) {
    notices.push(groupNotice('late', late, 'everyday', 'Parcel late', n => `${n} parcels late`));
  }
  const days = Array.from(byDay, ([day]) => day).toSorted((a, b) => a.localeCompare(b));
  for (const day of days) {
    const when = arrivingWhen(day, now);
    notices.push(
      groupNotice(
        `day:${day}`,
        byDay.get(day) ?? [],
        'everyday',
        `Parcel arriving ${when}`,
        n => `${n} parcels arriving ${when}`
      )
    );
  }
  if (undated.length > 0) {
    notices.push(groupNotice('undated', undated, 'everyday', 'Parcel on its way', n => `${n} parcels on their way`));
  }
  if (delivered.length > 0) {
    notices.push(groupNotice('delivered', delivered, 'everyday', 'Parcel delivered', n => `${n} parcels delivered`));
  }
  return notices;
}
