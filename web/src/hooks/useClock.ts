import { useEffect, useState } from 'react';

/** The clock now, read again every half minute, for a setting that shows the time as it is. */
export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
