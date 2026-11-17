import type { ReactNode } from 'react';

export interface AppTab<Id extends string> {
  id: Id;
  label: string;
  icon: ReactNode;
  /** The tab whose panel this one shows, when it has none of its own. */
  panel?: Id;
}

/** The id of the panel a tab shows, for its aria-controls and the panel's own id. */
export const tabPanelId = (id: string) => `app-tab-${id}`;

/**
 * The large tabs in the header that pick what fills the screen below it. It knows nothing about what each tab holds,
 * so another tab is one more entry in `tabs` and one more panel.
 */
export default function AppTabs<Id extends string>({
  tabs,
  current,
  onSelect
}: Readonly<{ tabs: readonly AppTab<Id>[]; current: Id; onSelect: (id: Id) => void }>) {
  return (
    <div className="app-tabs" role="tablist" aria-label="Screens">
      {tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="app-tab"
          aria-selected={tab.id === current}
          aria-controls={tabPanelId(tab.panel ?? tab.id)}
          onClick={() => onSelect(tab.id)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
