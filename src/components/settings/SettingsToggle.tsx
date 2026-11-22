import type { ReactNode } from 'react';

/**
 * A settings group that is on or off: its title with a switch on the same line, a note under it when there is one, and
 * whatever the setting has beyond the switch (`children`). The switch is named by the title.
 */
export default function SettingsToggle({
  id,
  title,
  note,
  on,
  onChange,
  className,
  children
}: Readonly<{
  /** The title's element id, which names the switch. */
  id: string;
  title: string;
  note?: string | undefined;
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string | undefined;
  children?: ReactNode;
}>) {
  const noteId = `${id}-note`;
  return (
    <section className={className ? `settings-group ${className}` : 'settings-group'}>
      <div className="settings-group-head">
        <h5 className="settings-group-title" id={id}>
          {title}
        </h5>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={id}
          aria-describedby={note ? noteId : undefined}
          onClick={() => onChange(!on)}
          className="settings-switch"
        >
          <span className="settings-switch-track" aria-hidden="true">
            <span className="settings-switch-thumb" />
          </span>
        </button>
      </div>
      {note && (
        <p className="settings-group-note text-muted" id={noteId}>
          {note}
        </p>
      )}
      {children}
    </section>
  );
}
