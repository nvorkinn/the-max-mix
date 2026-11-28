// The redesigned Dashboard's live data for React: opens countdown-server's feed while mounted (live.ts) and gives the
// components' props as of `now` (dashboardProps.ts), in the tablet's language, with the next holiday from
// `holidayDaysAhead` days before it. The caller owns the clock, so the boards count down on the same tick as the tab
// bar's clock, and a test or the fixture's simulated clock can drive it.

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useLanguage } from '../i18n/language';
import type { ClockFormat } from '../utils/clockFormat';
import { dashboardProps } from './dashboardProps';
import type { LiveProps } from './dashboardProps';
import { liveDashboard } from './live';
import { DEFAULT_HOLIDAY_DAYS_AHEAD } from './notices';
import type { LiveDashboard } from './live';
import { useLastKnown } from './useDayPhoto';

export function useLiveDashboard(
  now: Date,
  clockFormat: ClockFormat,
  source: LiveDashboard = liveDashboard(),
  holidayDaysAhead = DEFAULT_HOLIDAY_DAYS_AHEAD
): LiveProps {
  useEffect(() => {
    source.start();
    return () => source.stop();
  }, [source]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  const language = useLanguage();
  const time = now.getTime();
  const props = useMemo(
    () => dashboardProps(snapshot, new Date(time), clockFormat, language, holidayDaysAhead),
    [snapshot, time, clockFormat, language, holidayDaysAhead]
  );
  // Before the new day's first photo is due, yesterday's last one stays rather than the app's own.
  const backdrop = useLastKnown(props.backdrop);
  return backdrop === (props.backdrop ?? null) ? props : { ...props, backdrop };
}
