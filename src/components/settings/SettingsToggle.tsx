import type { ReactNode } from 'react';
import SettingsSection from './SettingsSection';

/**
 * A setting that is on or off: its heading with the switch straight after it, the line saying what it does, and
 * whatever the setting has beyond the switch (`children`). The switch is named by the heading.
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
  /** The heading's element id, which names the switch. */
  id: string;
  title: string;
  note?: string | undefined;
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string | undefined;
  children?: ReactNode;
}>) {
  return (
    <SettingsSection
      id={id}
      title={title}
      caption={note}
      className={className}
      aside={
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={id}
          aria-describedby={note ? `${id}-caption` : undefined}
          onClick={() => onChange(!on)}
          className="settings-switch"
        >
          <span className="settings-switch-track" aria-hidden="true">
            <span className="settings-switch-thumb" />
          </span>
        </button>
      }
    >
      {children}
    </SettingsSection>
  );
}
