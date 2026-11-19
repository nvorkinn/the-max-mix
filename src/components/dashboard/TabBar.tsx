import { AudioLines, Clock3, LayoutGrid, Music2, Search, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatClockTime } from '../../utils/clockFormat';
import type { TabBarProps, TabId } from '../../dashboard/props';
import { useHold } from '../../hooks/useHold';
import { tabPanelId } from '../AppTabs';
import PersonSwitcher from '../PersonSwitcher';
import NowPlaying from './NowPlaying';

// Dashboard, the home screen, sits in the middle, with a tab to either side of it (see TAB_PAN).
const TABS: readonly { id: TabId; label: string; icon: ReactNode }[] = [
  { id: 'spotify', label: 'Spotify', icon: <Music2 aria-hidden="true" className="lucide" /> },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutGrid aria-hidden="true" className="lucide" /> },
  { id: 'settings', label: 'Settings', icon: <Settings aria-hidden="true" className="lucide" /> }
];

/**
 * Which way the photo behind each tab is panned, matching where its tab sits in the bar: -1 left, 0 middle, 1 right.
 * Changing tab slides the photo from the old tab's side to the new one's (`--pan-from` and `--pan`, dashboard.css).
 */
export const TAB_PAN: Readonly<Record<TabId, number>> = { spotify: -1, dashboard: 0, settings: 1 };

// Holding the clock this long opens the debug console; long enough that nobody opens it by accident.
const CLOCK_HOLD_MS = 2000;
const noop = () => {};

/**
 * The brand, the tabs, search, the signed-in person and the clock, floating on the Dashboard's photo; with `nowPlaying`,
 * the song playing in a card hanging under the Spotify tab.
 */
export default function TabBar({
  active,
  onSelect,
  person,
  onSearch,
  now,
  clockFormat,
  onSwitchPerson,
  onClockHold,
  nowPlaying = null
}: Readonly<TabBarProps>) {
  const clockHold = useHold(onClockHold ?? noop, CLOCK_HOLD_MS);
  const face =
    person &&
    (person.pictureUrl ? <img src={person.pictureUrl} alt="" /> : person.name.trim().charAt(0).toUpperCase() || '?');
  return (
    <header className="dashboard-bar shadowed">
      <div className="dashboard-brand">
        <span className="dashboard-brand-mark" aria-hidden="true">
          <AudioLines className="lucide" />
        </span>
        <span className="dashboard-brand-name">The Max Mix.</span>
      </div>
      <div className="dashboard-tabs-place">
        <div className="dashboard-tabs" role="tablist" aria-label="Screens">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="dashboard-tab"
              aria-selected={tab.id === active}
              aria-controls={tabPanelId(tab.id)}
              data-holds-player={nowPlaying && tab.id === 'spotify' ? '' : undefined}
              onClick={() => onSelect(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        {nowPlaying && <NowPlaying {...nowPlaying} />}
      </div>
      <div className="dashboard-bar-end">
        {onSearch && (
          <button
            type="button"
            className="dashboard-icon-button dashboard-search"
            aria-label="Choose music"
            onClick={onSearch}
          >
            <Search className="lucide" style={{ width: 26, height: 26 }} />
          </button>
        )}
        {person &&
          (onSwitchPerson ? (
            <PersonSwitcher className="dashboard-icon-button" onSwitch={onSwitchPerson}>
              <span className="dashboard-avatar">{face}</span>
            </PersonSwitcher>
          ) : (
            <span className="dashboard-avatar" role="img" aria-label={`Signed in as ${person.name}`}>
              {face}
            </span>
          ))}
        <span className="dashboard-clock" {...(onClockHold && clockHold)}>
          <Clock3 className="lucide" style={{ width: 20, height: 20 }} />
          <time>{formatClockTime(now, clockFormat)}</time>
        </span>
      </div>
    </header>
  );
}
