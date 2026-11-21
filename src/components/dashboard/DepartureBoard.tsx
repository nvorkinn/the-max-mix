import { useId } from 'react';
import roundel from '../../assets/dashboard/tfl-roundel.png';
import ruter from '../../assets/dashboard/ruter-mark.svg';
import type { Departure, Network, StopBoardProps } from '../../dashboard/props';
import AnimatedRows from './AnimatedRows';
import { byVehicle, Destination, Minutes, routeRows, ScheduledTime, visibleDepartures } from './DepartureRows';
import EtaStack from './EtaStack';
import { FALLBACK_LINE_COLOURS, LINE_COLOURS, minutesUntil, pillName } from './icons';

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

/** A departure's time: the minutes to it, or a timetabled one's clock time. */
function Time({ departure, now }: Readonly<{ departure: Departure; now: Date }>) {
  return departure.scheduledAt === undefined ? (
    <Minutes expectedAt={departure.expectedAt} now={now} />
  ) : (
    <ScheduledTime time={departure.scheduledAt} />
  );
}

/**
 * A stop's departures, whatever their modes, headed with its network's mark, its name and (a bus stop's) letter: four
 * rows, soonest first, keyed by the vehicle so a row follows its bus or train. Grouped by route, a row is a route
 * instead, keyed by it, with its next time and the later ones queued behind it (EtaStack).
 */
export default function DepartureBoard({
  network,
  stopName,
  stopLetter,
  departures,
  now,
  stale,
  groupByRoute = false
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
        {/* Keyed apart, so turning grouping on or off starts the rows afresh rather than reading one kind as the other. */}
        {groupByRoute ? (
          <AnimatedRows
            key="routes"
            items={routeRows(departures, now)}
            keyOf={row => row.key}
            render={({ next, later }) => (
              <>
                <Line departure={next} network={network} />
                <Destination name={next.destination} detail={next.detail} overQueue />
                <EtaStack
                  departures={[next, ...later]}
                  now={now}
                  keyOf={departure => (departure.tracked ? departure.vehicleId : undefined)}
                  labelOf={departure => departure.scheduledAt ?? String(minutesUntil(departure.expectedAt, now))}
                  render={departure => <Time departure={departure} now={now} />}
                />
              </>
            )}
          />
        ) : (
          <AnimatedRows
            key="departures"
            items={visibleDepartures(departures, now)}
            keyOf={byVehicle}
            render={departure => (
              <>
                <Line departure={departure} network={network} />
                <Destination name={departure.destination} detail={departure.detail} />
                <Time departure={departure} now={now} />
              </>
            )}
          />
        )}
      </ol>
    </section>
  );
}
