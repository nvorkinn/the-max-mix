import type { ReactNode } from 'react';
import { useT } from '../../i18n/translate';
import { minutesUntil } from './icons';
import { useRollAcross } from './rollAcross';

/** Rows each board shows. */
const ROWS_PER_BOARD = 4;

/** A departure this many minutes away or fewer is drawn green: time to go. */
const SOON_MINUTES = 3;

/** How long past its time a departure stays on the board as "Due" before it goes. */
const DUE_GRACE_MS = 60_000;

/** Later departures a route's row stacks behind its next one. */
const LATER_PER_ROUTE = 3;

/** Those still to leave, soonest first: one leaves a minute after it was due. */
function upcoming<D extends { expectedAt: string }>(departures: readonly D[], now: Date): D[] {
  return departures.filter(d => new Date(d.expectedAt).getTime() > now.getTime() - DUE_GRACE_MS);
}

/** Those still to leave, soonest first, the rows the board has room for. */
export function visibleDepartures<D extends { expectedAt: string }>(departures: readonly D[], now: Date): D[] {
  return upcoming(departures, now).slice(0, ROWS_PER_BOARD);
}

/** One route's row: its next departure and the few after it. */
export interface RouteRow<D> {
  /** The route: its mode, line and destination. Unique within the board. */
  key: string;
  next: D;
  later: D[];
}

/**
 * Those still to leave grouped by route (mode, line and destination), a row each, the routes in the order of their next
 * departure, the rows the board has room for.
 */
export function routeRows<D extends { expectedAt: string; mode: string; line: string; destination: string }>(
  departures: readonly D[],
  now: Date
): RouteRow<D>[] {
  const rows: RouteRow<D>[] = [];
  const byKey = new Map<string, RouteRow<D>>();
  for (const departure of upcoming(departures, now)) {
    const key = [departure.mode, departure.line, departure.destination].join('\n');
    const row = byKey.get(key);
    if (!row) {
      const added = { key, next: departure, later: [] };
      byKey.set(key, added);
      rows.push(added);
    } else if (row.later.length < LATER_PER_ROUTE) {
      row.later.push(departure);
    }
  }
  return rows.slice(0, ROWS_PER_BOARD);
}

/** A departure row's key: its vehicle, so the row follows the vehicle when predictions reorder. */
export const byVehicle = (departure: { vehicleId: string }): string => departure.vehicleId;

/** The minutes to a departure, or "Due". */
export function Minutes({ expectedAt, now }: Readonly<{ expectedAt: string; now: Date }>) {
  const t = useT();
  const minutes = minutesUntil(expectedAt, now);
  return (
    <span className={`dashboard-mins${minutes <= SOON_MINUTES ? ' soon' : ''}`}>
      {minutes <= 0 ? (
        t('board.due')
      ) : (
        <>
          {minutes}
          <small>min</small>
        </>
      )}
    </span>
  );
}

/** A timetabled departure's clock time ("05:42", "5:42 AM"), dimmed: no live prediction to count down. */
export function ScheduledTime({ time }: Readonly<{ time: string }>) {
  const period = /[AaPp]\.?\s?[Mm]\.?$/.exec(time);
  const clock = period ? time.slice(0, period.index).trim() : time;
  return (
    <span className="dashboard-mins scheduled">
      {clock}
      {period && <small>{period[0]}</small>}
    </span>
  );
}

/**
 * A row's destination over its second line. Over a route's queue of times (grouped by route), a long one is cut short
 * and every so often rolls across to show the rest.
 */
export function Destination({
  name,
  detail,
  stopLetter,
  overQueue = false
}: Readonly<{ name: string; detail: ReactNode; stopLetter?: string | undefined; overQueue?: boolean }>) {
  const nameRef = useRollAcross(overQueue);
  return (
    <span className="dashboard-dest" data-over-queue={overQueue || undefined}>
      <strong>
        <span ref={nameRef} className="dashboard-dest-name">
          {name}
        </span>
        {stopLetter && <span className="dashboard-stop-letter dashboard-row-letter">{stopLetter}</span>}
      </strong>
      <span>{detail}</span>
    </span>
  );
}
