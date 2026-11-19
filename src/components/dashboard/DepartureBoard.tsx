import { useId } from 'react';
import roundel from '../../assets/dashboard/tfl-roundel.png';
import ruter from '../../assets/dashboard/ruter-mark.svg';
import type { Departure, Network, StopBoardProps } from '../../dashboard/props';
import AnimatedRows from './AnimatedRows';
import { byVehicle, Destination, Minutes, ScheduledTime, visibleDepartures } from './DepartureRows';
import { FALLBACK_LINE_COLOURS, LINE_COLOURS, pillName } from './icons';

/** Each network's mark, which heads its stops' boards. */
const MARKS: Record<Network, { src: string; name: string; className: string }> = {
  tfl: { src: roundel, name: 'TfL', className: 'dashboard-roundel' },
  entur: { src: ruter, name: 'Ruter', className: 'dashboard-ruter' }
};

/**
 * A departure's line, the way its network signs it: TfL's buses as a red route number and its Tube lines as a pill in
 * the line's colour, in TfL's short form where the name is too long for it ("H&C"); Norway's lines as a route number in
 * its mode's colour (Ruter's red bus, orange T-bane, blue tram and dark blue train), squeezed rather than widened when
 * the number is long ("VY190").
 */
function Line({ departure, network }: Readonly<{ departure: Departure; network: Network }>) {
  if (network === 'entur') {
    const length = Math.min(departure.line.length, 6);
    return (
      <span className="dashboard-route dashboard-route-ruter" data-mode={departure.mode} data-length={length}>
        {departure.line}
      </span>
    );
  }
  if (departure.mode === 'bus') return <span className="dashboard-route">{departure.line}</span>;
  const [background, text] = LINE_COLOURS[departure.lineId] ?? FALLBACK_LINE_COLOURS;
  return (
    <span className="dashboard-line-pill" style={{ background, color: text }}>
      {pillName(departure.lineId, departure.line)}
    </span>
  );
}

/**
 * A stop's departures, whatever their modes, headed with its network's mark, its name and (a bus stop's) letter: four
 * rows, soonest first, keyed by the vehicle so a row follows its bus or train.
 */
export default function DepartureBoard({
  network,
  stopName,
  stopLetter,
  departures,
  now,
  stale
}: Readonly<StopBoardProps>) {
  const id = useId();
  const mark = MARKS[network];
  const labelledBy = [`${id}-mark`, `${id}-stop`, ...(stopLetter ? [`${id}-letter`] : [])].join(' ');
  return (
    <section className="dashboard-board" aria-labelledby={labelledBy}>
      <div className="dashboard-board-head">
        <img id={`${id}-mark`} className={mark.className} src={mark.src} alt={mark.name} />
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
              <Line departure={departure} network={network} />
              <Destination name={departure.destination} detail={departure.detail} />
              {departure.scheduledAt === undefined ? (
                <Minutes expectedAt={departure.expectedAt} now={now} />
              ) : (
                <ScheduledTime time={departure.scheduledAt} />
              )}
            </>
          )}
        />
      </ol>
    </section>
  );
}
