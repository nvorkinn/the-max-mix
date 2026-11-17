import { useId } from 'react';
import { Bus } from 'lucide-react';
import type { BusBoardProps } from '../../dashboard/props';
import AnimatedRows from './AnimatedRows';
import { byVehicle, Destination, Minutes, visibleDepartures } from './DepartureRows';

/** Buses due at a stop, headed with its name and letter: four rows, keyed by the bus so a row follows its bus. */
export default function BusBoard({ stopName, stopLetter, departures, now, stale }: Readonly<BusBoardProps>) {
  const id = useId();
  const labelledBy = [`${id}-mode`, `${id}-stop`, ...(stopLetter ? [`${id}-letter`] : [])].join(' ');
  return (
    <section className="dashboard-board" aria-labelledby={labelledBy}>
      <div className="dashboard-board-head">
        <span id={`${id}-mode`} className="dashboard-bus-mark" role="img" aria-label="Buses">
          <Bus className="lucide" aria-hidden="true" />
        </span>
        <h2 id={`${id}-stop`}>{stopName}</h2>
        {stopLetter && (
          <span id={`${id}-letter`} className="dashboard-stop-letter">
            {stopLetter}
          </span>
        )}
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
                // A hub's departures leave from its several stops: each says which, as the board can't.
                detail={departure.stopLetter && departure.stopLetter !== stopLetter && `Stop ${departure.stopLetter}`}
              />
              <Minutes expectedAt={departure.expectedAt} now={now} />
            </>
          )}
        />
      </ol>
    </section>
  );
}
