import ruter from '../../assets/dashboard/ruter-mark.svg';
import type { LineIncidentsProps } from '../../dashboard/props';

/** Each incident's row is as tall as two of the Tube status panel's: its lines, then two lines of its text. */
export const INCIDENT_ROWS = 2;

/**
 * The incidents on the lines serving the kiosk's Norwegian stops, at the bottom of the rail under the notices where a
 * London kiosk has the Tube's status: problems only, each as the operator words it under the lines it's about, in the
 * boards' Ruter route boxes. With nothing wrong there's no panel at all.
 */
export default function LineIncidents({ incidents }: Readonly<LineIncidentsProps>) {
  return (
    <section className="dashboard-notices dashboard-line-incidents" aria-labelledby="dashboard-incidents-title">
      <h2 className="dashboard-eyebrow" id="dashboard-incidents-title">
        <img className="dashboard-eyebrow-ruter" src={ruter} alt="" />
        Disruptions
      </h2>
      <ul className="dashboard-incident-list">
        {incidents.map(incident => (
          <li key={incident.key} className="dashboard-incident" data-health={incident.health}>
            {incident.lines.length > 0 && (
              <span className="dashboard-incident-lines">
                {incident.lines.map(line => (
                  <span
                    key={line.id}
                    className="dashboard-route dashboard-route-ruter dashboard-incident-route"
                    data-mode={line.mode}
                    data-length={Math.min(line.code.length, 6)}
                  >
                    {line.code}
                  </span>
                ))}
              </span>
            )}
            <span className="dashboard-incident-text">{incident.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
