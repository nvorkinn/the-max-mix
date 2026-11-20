import roundel from '../../assets/dashboard/tfl-roundel.png';
import { groupLines } from '../../dashboard/lineStatus';
import type { LineStatusItem, TubeStatusProps } from '../../dashboard/props';
import { useT } from '../../i18n/translate';
import { FALLBACK_LINE_COLOURS, LINE_COLOURS } from './icons';

const Swatch = ({ line }: Readonly<{ line: LineStatusItem }>) => (
  <span
    className="dashboard-line-swatch"
    title={line.name}
    style={{ background: (LINE_COLOURS[line.id] ?? FALLBACK_LINE_COLOURS)[0] }}
  />
);

/** The Tube status panel's rows are this tall (and its heading as tall as the notice board's). */
export const LINE_ROW_HEIGHT = 34;

/**
 * Every Tube line's status, at the bottom of the rail under the notices, in TfL's colours: a line with
 * something wrong is named on its own row; quiet lines sharing a status are one row of their colours, at the bottom.
 */
export default function TubeStatus({ lines }: Readonly<TubeStatusProps>) {
  const t = useT();
  return (
    <section className="dashboard-notices dashboard-tube-status" aria-labelledby="dashboard-lines-title">
      <h2 className="dashboard-eyebrow" id="dashboard-lines-title">
        <img className="dashboard-eyebrow-roundel" src={roundel} alt="" />
        {t('dashboard.tube_status')}
      </h2>
      <ul className="dashboard-line-list">
        {groupLines(lines).map(group => {
          const [only] = group.lines;
          const names = group.lines.map(line => line.name).join(', ');
          return (
            <li key={group.key} className="dashboard-line" data-health={group.health}>
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
