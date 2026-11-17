import { useId } from 'react';
import roundel from '../../assets/dashboard/tfl-roundel.png';
import type { TubeBoardProps } from '../../dashboard/props';
import AnimatedRows from './AnimatedRows';
import { byVehicle, Destination, Minutes, visibleDepartures } from './DepartureRows';
import { FALLBACK_LINE_COLOURS, LINE_COLOURS, SideTrain } from './icons';

/**
 * Trains due at a station, headed with its name and the TfL roundel (or, off TfL's network, a plain train): four rows,
 * keyed by the train so a row follows its train.
 */
export default function TubeBoard({ stopName, tfl, departures, now, stale }: Readonly<TubeBoardProps>) {
  const id = useId();
  return (
    <section className="dashboard-board" aria-labelledby={`${id}-mode ${id}-stop`}>
      <div className="dashboard-board-head">
        {tfl ? (
          <img id={`${id}-mode`} className="dashboard-roundel" src={roundel} alt="Tube" />
        ) : (
          <span id={`${id}-mode`} className="dashboard-mode-mark" role="img" aria-label="Trains">
            <SideTrain className="lucide" aria-hidden="true" />
          </span>
        )}
        <h2 id={`${id}-stop`}>{stopName}</h2>
      </div>
      <ol className="dashboard-rows" data-stale={stale}>
        <AnimatedRows
          items={visibleDepartures(departures, now)}
          keyOf={byVehicle}
          render={departure => {
            const [background, text] = LINE_COLOURS[departure.lineId] ?? FALLBACK_LINE_COLOURS;
            return (
              <>
                <span className="dashboard-line-pill" style={{ background, color: text }}>
                  {departure.lineName}
                </span>
                <Destination name={departure.destination} detail={departure.platform} />
                <Minutes expectedAt={departure.expectedAt} now={now} />
              </>
            );
          }}
        />
      </ol>
    </section>
  );
}
