import type { ReactNode } from 'react';
import { minutesUntil } from './icons';

/** Rows each board shows. */
const ROWS_PER_BOARD = 4;

/** A departure this many minutes away or fewer is drawn green: time to go. */
const SOON_MINUTES = 3;

/** How long past its time a departure stays on the board as "Due" before it goes. */
const DUE_GRACE_MS = 60_000;

/** Those still to leave, soonest first, the rows the board has room for: one leaves a minute after it was due. */
export function visibleDepartures<D extends { expectedAt: string }>(departures: D[], now: Date): D[] {
  return departures
    .filter(d => new Date(d.expectedAt).getTime() > now.getTime() - DUE_GRACE_MS)
    .slice(0, ROWS_PER_BOARD);
}

/** A departure row's key: its vehicle, so the row follows the vehicle when predictions reorder. */
export const byVehicle = (departure: { vehicleId: string }): string => departure.vehicleId;

/** The minutes to a departure, or "Due". */
export function Minutes({ expectedAt, now }: Readonly<{ expectedAt: string; now: Date }>) {
  const minutes = minutesUntil(expectedAt, now);
  return (
    <span className={`dashboard-mins${minutes <= SOON_MINUTES ? ' soon' : ''}`}>
      {minutes <= 0 ? (
        'Due'
      ) : (
        <>
          {minutes}
          <small>min</small>
        </>
      )}
    </span>
  );
}

/** A row's destination over its second line. */
export function Destination({ name, detail }: Readonly<{ name: string; detail: ReactNode }>) {
  return (
    <span className="dashboard-dest">
      <strong>{name}</strong>
      <span>{detail}</span>
    </span>
  );
}
