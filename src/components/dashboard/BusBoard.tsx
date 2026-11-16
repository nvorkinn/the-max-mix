import { BusFront, ChevronRight } from 'lucide-react';
import type { BusBoardProps } from '../../dashboard/props';
import { Destination, Minutes, visibleDepartures } from './DepartureRows';

/** Buses due at a stop: four rows, keyed by the bus so a row follows its bus. */
export default function BusBoard({ stopName, departures, now, stale }: Readonly<BusBoardProps>) {
  return (
    <section className="dashboard-board" aria-labelledby="dashboard-bus-title">
      <div className="dashboard-board-head">
        <span className="dashboard-bus-mark" aria-hidden="true">
          <BusFront className="lucide" />
        </span>
        <h2 id="dashboard-bus-title">Buses</h2>
        <span className="dashboard-board-stop">
          {stopName} <ChevronRight className="lucide" aria-hidden="true" />
        </span>
      </div>
      <ol className="dashboard-rows" data-stale={stale}>
        {visibleDepartures(departures, now).map(departure => (
          <li key={departure.vehicleId}>
            <span className="dashboard-route">{departure.route}</span>
            <Destination name={departure.destination} detail={departure.stopLetter && `Stop ${departure.stopLetter}`} />
            <Minutes expectedAt={departure.expectedAt} now={now} />
          </li>
        ))}
      </ol>
    </section>
  );
}
