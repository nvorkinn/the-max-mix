import { ChevronRight } from 'lucide-react';
import type { TubeBoardProps } from '../../dashboard/props';
import { Destination, Minutes, visibleDepartures } from './DepartureRows';
import { FALLBACK_LINE_COLOURS, LINE_COLOURS } from './icons';

/** Trains due at a Tube station: four rows, keyed by the train so a row follows its train. */
export default function TubeBoard({ stopName, departures, now, stale }: Readonly<TubeBoardProps>) {
  return (
    <section className="dashboard-board" aria-labelledby="dashboard-tube-title">
      <div className="dashboard-board-head">
        <span className="dashboard-roundel" aria-hidden="true" />
        <h2 id="dashboard-tube-title">Tube</h2>
        <span className="dashboard-board-stop">
          {stopName} <ChevronRight className="lucide" aria-hidden="true" />
        </span>
      </div>
      <ol className="dashboard-rows" data-stale={stale}>
        {visibleDepartures(departures, now).map(departure => {
          const [background, text] = LINE_COLOURS[departure.lineId] ?? FALLBACK_LINE_COLOURS;
          return (
            <li key={departure.vehicleId}>
              <span className="dashboard-line-pill" style={{ background, color: text }}>
                {departure.lineName}
              </span>
              <Destination name={departure.destination} detail={departure.platform} />
              <Minutes expectedAt={departure.expectedAt} now={now} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
