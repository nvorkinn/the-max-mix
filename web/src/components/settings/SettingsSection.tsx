import type { ReactNode } from 'react';

/**
 * One setting on a settings page: its heading, with whatever belongs beside it (a switch, a small button) right after
 * the words rather than at the page's far edge, a line saying what the setting does, and the control. No box: the
 * pages are laid out by these sections' rhythm, each control drawn for its own setting.
 */
export default function SettingsSection({
  id,
  title,
  caption,
  aside,
  className,
  children
}: Readonly<{
  /** The heading's element id, which names the section (and the switch beside it). */
  id: string;
  title: string;
  caption?: string | undefined;
  aside?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
}>) {
  return (
    <section className={className ? `settings-section ${className}` : 'settings-section'} aria-labelledby={id}>
      <div className="settings-section-head">
        <h5 className="settings-section-title" id={id}>
          {title}
        </h5>
        {aside}
      </div>
      {caption !== undefined && caption !== '' && (
        <p className="settings-section-caption" id={`${id}-caption`}>
          {caption}
        </p>
      )}
      {children}
    </section>
  );
}
