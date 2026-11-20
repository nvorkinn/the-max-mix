import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ROW_FADE_MS } from './AnimatedRows';

/** Where a departure sits in its route's stack: the big time at the front, or a card waiting behind it. */
const SLOTS = ['front', 'card1', 'card2', 'card3'] as const;
type Slot = (typeof SLOTS)[number];

/**
 * Each slot's place, right-aligned in the stack: the cards step out to the left at half size, each fully readable
 * beside the one in front of it.
 */
const SLOT_TRANSFORMS: Record<Slot, string> = {
  front: 'translateY(-50%)',
  card1: 'translateY(-50%) translateX(-92px) scale(0.5)',
  card2: 'translateY(-50%) translateX(-122px) scale(0.5)',
  card3: 'translateY(-50%) translateX(-152px) scale(0.5)'
};

/** How long a card takes to move up a place. */
const MOVE_MS = 500;
const MOVE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** A new front this much later than the last one's time is the one after it: the last one has left. */
const LATER_TRIP_MS = 60_000;

interface Departed<D> {
  /** Bumped each time the front one leaves, so each element keeps its time as it moves up a place. */
  generation: number;
  /** The front one as last drawn. */
  front: D | undefined;
  /** The one that has just left, fading where it was. */
  gone: { generation: number; departure: D } | null;
}

/** Whether `next` at the front means `previous`, which was there, has left: it was due and `next` is a later trip. */
function hasLeft(previous: { expectedAt: string }, next: { expectedAt: string } | undefined, now: Date): boolean {
  const due = Date.parse(previous.expectedAt);
  return due <= now.getTime() && (next === undefined || Date.parse(next.expectedAt) - due >= LATER_TRIP_MS);
}

/**
 * A route's next departures as a stack: the next one's time big on the right as on any row, and up to three after it
 * on cards waiting to its left. When the front one leaves, it fades where it is and each card moves up a place
 * (transforms and opacity only, which the Pi's GPU composites); a new card fades in at the back. The moves are Web
 * Animations rather than CSS transitions, because the row itself may move in the list at the same moment and a moved
 * element drops its transitions. The stack goes by the times rather than vehicles: Entur gives its departures no
 * vehicle to follow.
 */
export default function EtaStack<D extends { expectedAt: string }>({
  departures,
  now,
  render
}: Readonly<{ departures: readonly D[]; now: Date; render: (departure: D) => ReactNode }>) {
  const shown = departures.slice(0, SLOTS.length);
  const [state, setState] = useState<Departed<D>>({ generation: 0, front: shown[0], gone: null });

  const front = shown[0];
  if (state.front !== front && state.front?.expectedAt !== front?.expectedAt) {
    const left = state.front !== undefined && hasLeft(state.front, front, now);
    setState({
      generation: left ? state.generation + 1 : state.generation,
      front,
      gone: left ? { generation: state.generation, departure: state.front } : state.gone
    });
  }
  const { generation, gone } = state;
  useEffect(() => {
    if (!gone) return;
    const timer = window.setTimeout(() => setState(current => ({ ...current, gone: null })), ROW_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [gone]);

  // Each place in the line of departures keeps its element: the card at the second place becomes the front.
  const places = shown.map((departure, index) => ({
    departure,
    place: generation + index,
    slot: SLOTS[index] ?? 'card3'
  }));

  // Each element moves from the slot it was drawn in to its new one; a card reaching the front sheds its card.
  const elementsRef = useRef(new Map<number, HTMLElement>());
  const drawnInRef = useRef(new Map<number, Slot>());
  const slotSignature = places.map(({ place, slot }) => `${String(place)}:${slot}`).join(' ');
  useLayoutEffect(() => {
    const before = drawnInRef.current;
    const after = new Map<number, Slot>();
    for (const { place, slot } of places) {
      after.set(place, slot);
      const was = before.get(place);
      const element = elementsRef.current.get(place);
      if (
        was === undefined ||
        was === slot ||
        typeof element?.animate !== 'function' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        continue;
      }
      const timing = { duration: MOVE_MS, easing: MOVE_EASING };
      element.animate([{ transform: SLOT_TRANSFORMS[was] }, { transform: SLOT_TRANSFORMS[slot] }], timing);
      if (slot === 'front') element.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, pseudoElement: '::before' });
    }
    drawnInRef.current = after;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `places` is summed up by its signature.
  }, [slotSignature]);

  return (
    <span className="dashboard-stack">
      {gone && (
        <span
          key={gone.generation}
          className="dashboard-stack-item"
          data-slot="gone"
          style={{ transform: SLOT_TRANSFORMS.front }}
          aria-hidden
        >
          {render(gone.departure)}
        </span>
      )}
      {places.map(({ departure, place, slot }) => (
        <span
          key={place}
          ref={element => {
            if (element) elementsRef.current.set(place, element);
            else elementsRef.current.delete(place);
          }}
          className="dashboard-stack-item"
          data-slot={slot}
          style={{ transform: SLOT_TRANSFORMS[slot] }}
        >
          {render(departure)}
        </span>
      ))}
    </span>
  );
}
