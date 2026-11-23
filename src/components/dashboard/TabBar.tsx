import { AudioLines, Clock3, LayoutGrid, Search, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatClockTime } from '../../utils/clockFormat';
import type { TabBarProps, TabId } from '../../dashboard/props';
import type { StringId } from '../../i18n/strings';
import { useT } from '../../i18n/translate';
import { useHold } from '../../hooks/useHold';
import { tabPanelId } from '../AppTabs';
import PersonSwitcher from '../PersonSwitcher';
import ProblemsButton from '../ProblemsButton';
import SpotifyIcon from '../SpotifyIcon';
import NowPlaying from './NowPlaying';

// Dashboard, the home screen, sits in the middle, with a tab to either side of it.
const TABS: readonly { id: TabId; label: StringId; icon: ReactNode }[] = [
  // Spotify's own logo in one colour, as its brand rules allow: white like the other tabs.
  { id: 'spotify', label: 'tabs.spotify', icon: <SpotifyIcon className="lucide" /> },
  { id: 'dashboard', label: 'tabs.dashboard', icon: <LayoutGrid aria-hidden="true" className="lucide" /> },
  { id: 'settings', label: 'tabs.settings', icon: <Settings aria-hidden="true" className="lucide" /> }
];

// Holding the clock this long opens the debug console; long enough that nobody opens it by accident.
const CLOCK_HOLD_MS = 2000;
const noop = () => {};

/**
 * The brand, the tabs, search, a warning while anything is wrong, the signed-in person and the clock, floating on the
 * Dashboard's photo; with `nowPlaying`, the song playing in a card under the clock.
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
  const t = useT();
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
        <div className="dashboard-tabs" role="tablist" aria-label={t('tabs.screens')}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="dashboard-tab"
              aria-selected={tab.id === active}
              aria-controls={tabPanelId(tab.id)}
              onClick={() => onSelect(tab.id)}
            >
              {tab.icon}
              {t(tab.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="dashboard-bar-end">
        {onSearch && (
          <button
            type="button"
            className="dashboard-icon-button dashboard-search"
            aria-label={t('tabs.choose_music')}
            onClick={onSearch}
          >
            <Search className="lucide" style={{ width: 26, height: 26 }} />
          </button>
        )}
        <ProblemsButton onDetails={onClockHold ?? undefined} />
        {person &&
          (onSwitchPerson ? (
            <PersonSwitcher className="dashboard-icon-button" onSwitch={onSwitchPerson}>
              <span className="dashboard-avatar">{face}</span>
            </PersonSwitcher>
          ) : (
            <span className="dashboard-avatar" role="img" aria-label={t('tabs.signed_in_as', { name: person.name })}>
              {face}
            </span>
          ))}
        <span className="dashboard-clock" {...(onClockHold && clockHold)}>
          <Clock3 className="lucide" style={{ width: 20, height: 20 }} />
          <time>{formatClockTime(now, clockFormat)}</time>
        </span>
        {nowPlaying && <NowPlaying {...nowPlaying} />}
      </div>
    </header>
  );
}
