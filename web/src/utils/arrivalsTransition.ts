// How the Dashboard's arrivals change from one stop's board to the next: a setting of this tablet's own, kept in its
// browser, since it only changes how the screen looks (not part of the countdown device's config).
import { useSyncExternalStore } from 'react';

export const ARRIVALS_TRANSITIONS = ['flip', 'slide', 'sinkRise', 'none'] as const;
export type ArrivalsTransition = (typeof ARRIVALS_TRANSITIONS)[number];
const DEFAULT_ARRIVALS_TRANSITION: ArrivalsTransition = 'slide';

const KEY = 'maxmix.arrivalsTransition';
const listeners = new Set<() => void>();

const isTransition = (value: unknown): value is ArrivalsTransition =>
  ARRIVALS_TRANSITIONS.includes(value as ArrivalsTransition);

export function loadArrivalsTransition(): ArrivalsTransition {
  try {
    const stored = localStorage.getItem(KEY);
    return isTransition(stored) ? stored : DEFAULT_ARRIVALS_TRANSITION;
  } catch {
    return DEFAULT_ARRIVALS_TRANSITION;
  }
}

/** Stores the choice and tells every board showing at once, so it takes effect without a reload. */
export function saveArrivalsTransition(transition: ArrivalsTransition): void {
  try {
    if (transition === DEFAULT_ARRIVALS_TRANSITION) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, transition);
  } catch {
    // Storage is unavailable; the setting then lasts only until the page reloads.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The chosen transition, following changes made in Settings as they happen. */
export function useArrivalsTransition(): ArrivalsTransition {
  return useSyncExternalStore(subscribe, loadArrivalsTransition, () => DEFAULT_ARRIVALS_TRANSITION);
}
