import type { ReactNode } from 'react';

/** A setting's row: its icon, what it is set to, and the button that changes it. */
export default function SettingsRow({
  icon,
  name,
  detail,
  children
}: Readonly<{ icon: ReactNode; name: string; detail?: string; children: ReactNode }>) {
  return (
    <div className="settings-box settings-row">
      <span className="settings-box-icon">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="settings-box-title block truncate">{name}</span>
        {detail && <span className="block text-muted truncate">{detail}</span>}
      </span>
      {children}
    </div>
  );
}
