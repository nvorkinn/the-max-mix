import { TrainFront } from 'lucide-react';
import type { TubeStatusProps } from '../../dashboard/props';
import { FALLBACK_LINE_COLOURS, LINE_COLOURS } from './icons';

/** Every Tube line's status, in the notice board's place while it has nothing to say: a line a row, in TfL's colours. */
export default function TubeStatus({ lines }: Readonly<TubeStatusProps>) {
  return (
    <section className="dashboard-notices" aria-labelledby="dashboard-lines-title">
      <h2 className="dashboard-eyebrow" id="dashboard-lines-title">
        <TrainFront className="lucide" style={{ width: 16, height: 16 }} aria-hidden="true" />
        Tube status
      </h2>
      <ul className="dashboard-line-list">
        {lines.map(line => (
          <li key={line.id} className="dashboard-line" data-health={line.health}>
            <span
              className="dashboard-line-swatch"
              style={{ background: (LINE_COLOURS[line.id] ?? FALLBACK_LINE_COLOURS)[0] }}
            />
            <span className="dashboard-line-name">{line.name}</span>
            <span className="dashboard-line-status">{line.status}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
