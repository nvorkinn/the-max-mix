import { TrainFront } from 'lucide-react';
import { groupLines } from '../../dashboard/lineStatus';
import type { LineStatusItem, TubeStatusProps } from '../../dashboard/props';
import { FALLBACK_LINE_COLOURS, LINE_COLOURS } from './icons';

const Swatch = ({ line }: Readonly<{ line: LineStatusItem }>) => (
  <span
    className="dashboard-line-swatch"
    title={line.name}
    style={{ background: (LINE_COLOURS[line.id] ?? FALLBACK_LINE_COLOURS)[0] }}
  />
);

/**
 * Every Tube line's status, in the notice board's place while it has nothing to say, in TfL's colours: a line with a
 * status of its own is named; lines sharing a status are one row of their colours, those rows at the bottom.
 */
export default function TubeStatus({ lines }: Readonly<TubeStatusProps>) {
  return (
    <section className="dashboard-notices" aria-labelledby="dashboard-lines-title">
      <h2 className="dashboard-eyebrow" id="dashboard-lines-title">
        <TrainFront className="lucide" style={{ width: 16, height: 16 }} aria-hidden="true" />
        Tube status
      </h2>
      <ul className="dashboard-line-list">
        {groupLines(lines).map(group => {
          const [only] = group.lines;
          const names = group.lines.map(line => line.name).join(', ');
          return (
            <li key={group.status} className="dashboard-line" data-health={group.health}>
              {only && group.lines.length === 1 ? (
                <>
                  <Swatch line={only} />
                  <span className="dashboard-line-name">{only.name}</span>
                </>
              ) : (
                <span className="dashboard-line-swatches" role="img" aria-label={names}>
                  {group.lines.map(line => (
                    <Swatch key={line.id} line={line} />
                  ))}
                </span>
              )}
              <span className="dashboard-line-status">{group.status}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
