import type { ReactNode } from 'react';

/** A short list of values to pick one of, as pills that wrap rather than a bar stretched across the page. */
export default function SettingsChips<T extends string | number>({
  labelledBy,
  label,
  options,
  value,
  onChange
}: Readonly<{
  /** The id of the heading that names the choice, or else its name. */
  labelledBy?: string;
  label?: string;
  options: readonly { id: T; label: ReactNode; icon?: ReactNode; name?: string }[];
  value: T;
  onChange: (value: T) => void;
}>) {
  return (
    <div className="settings-chips" role="group" aria-labelledby={labelledBy} aria-label={label}>
      {options.map(option => (
        <button
          type="button"
          key={option.id}
          aria-pressed={option.id === value}
          aria-label={option.name}
          onClick={() => onChange(option.id)}
          className="settings-chip"
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
