// The owner's parcels on the notice board, from countdown-server's getNotices (DeviceNotices.parcels): what the parcel
// provider stored for the kiosk (v1:parcels:<device id>), already narrowed to the parcels its settings show. They're
// grouped as the e-paper screens group them (countdown's renderer, notices/parcels.py): one notice for the parcels out
// for delivery, one for those that need the owner, one for the late ones, one for each day parcels are due, one for
// those with no day yet and one for those just delivered. A notice for one parcel names it; for several, it counts
// them and names them in its line. The words are the kiosk's own: the e-paper screens word theirs with countdown's
// own catalog, not countdown-api's (strings.ts).

import type { Parcel } from 'countdown-api';
import type { Language } from '../i18n/language';
import { DEFAULT_LANGUAGE, LOCALES } from '../i18n/language';
import { translate } from '../i18n/translate';
import type { StringId } from '../i18n/strings';
import type { Notice } from './data';
import { say } from './messages';

const pad = (n: number) => String(n).padStart(2, '0');
const localDay = (time: Date) => `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;

/** Its own notice whatever day it's due. */
const NOT_BY_DAY: ReadonlySet<Parcel['status']> = new Set(['delivered', 'exception', 'out_for_delivery']);

/** "today", "tomorrow" or "Thu 20 Nov", for a day (YYYY-MM-DD, the owner's) on or after today. */
function arrivingWhen(day: string, now: Date, language: Language): string {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (day === localDay(now)) return say('notice.day.today', {}, language).toLowerCase();
  if (day === localDay(tomorrow)) return say('notice.day.tomorrow', {}, language).toLowerCase();
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date)
    .toLocaleDateString(LOCALES[language], { weekday: 'short', day: 'numeric', month: 'short' })
    .replace(',', '');
}

/** A notice about `group`, titled by `title` with its count, with their names as its line. */
function groupNotice(
  id: string,
  group: readonly Parcel[],
  severity: Notice['severity'],
  language: Language,
  title: StringId,
  args: Record<string, string> = {}
): Notice {
  const names = group.map(parcel => parcel.description.trim() || parcel.tracking_number);
  return {
    id: `parcel:${id}`,
    kind: 'parcel',
    severity,
    title: translate(title, language, { ...args, count: group.length }),
    summary: names.join(', '),
    detail: group.map((parcel, index) => `${names[index]} (${parcel.carrier}, ${parcel.tracking_number})`).join('\n')
  };
}

/**
 * The notices for `parcels` as of `now`: those out for delivery and those that need the owner first (shown in blue),
 * then the late ones, each day's from the soonest, the undated and the delivered (everyday notices, in white).
 */
export function parcelNotices(parcels: readonly Parcel[], now: Date, language: Language = DEFAULT_LANGUAGE): Notice[] {
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
    notices.push(groupNotice('out', out, 'info', language, 'parcel.out'));
  }
  if (held.length > 0) {
    notices.push(groupNotice('held', held, 'info', language, 'parcel.held'));
  }
  if (late.length > 0) {
    notices.push(groupNotice('late', late, 'everyday', language, 'parcel.late'));
  }
  const days = Array.from(byDay, ([day]) => day).toSorted((a, b) => a.localeCompare(b));
  for (const day of days) {
    const when = arrivingWhen(day, now, language);
    notices.push(groupNotice(`day:${day}`, byDay.get(day) ?? [], 'everyday', language, 'parcel.arriving', { when }));
  }
  if (undated.length > 0) {
    notices.push(groupNotice('undated', undated, 'everyday', language, 'parcel.undated'));
  }
  if (delivered.length > 0) {
    notices.push(groupNotice('delivered', delivered, 'everyday', language, 'parcel.delivered'));
  }
  return notices;
}
