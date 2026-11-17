import { useId } from 'react';
import { BusFront, ChevronRight } from 'lucide-react';
import type { BusBoardProps } from '../../dashboard/props';
import AnimatedRows from './AnimatedRows';
import { byVehicle, Destination, Minutes, visibleDepartures } from './DepartureRows';

/** Buses due at a stop: four rows, keyed by the bus so a row follows its bus. */
export default function BusBoard({ stopName, departures, now, stale }: Readonly<BusBoardProps>) {
  const titleId = useId();
  return (
    <section className="dashboard-board" aria-labelledby={titleId}>
      <div className="dashboard-board-head">
        <span className="dashboard-bus-mark" aria-hidden="true">
          <BusFront className="lucide" />
        </span>
        <h2 id={titleId}>Buses</h2>
        <span className="dashboard-board-stop">
          {stopName} <ChevronRight className="lucide" aria-hidden="true" />
        </span>
      </div>
      <ol className="dashboard-rows" data-stale={stale}>
        <AnimatedRows
          items={visibleDepartures(departures, now)}
          keyOf={byVehicle}
          render={departure => (
            <>
              <span className="dashboard-route">{departure.route}</span>
              <Destination
                name={departure.destination}
                detail={departure.stopLetter && `Stop ${departure.stopLetter}`}
              />
              <Minutes expectedAt={departure.expectedAt} now={now} />
            </>
          )}
        />
      </ol>
    </section>
  );
}
