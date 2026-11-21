import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ROW_FADE_MS } from './AnimatedRows';

/** The places in a route's queue: the time at the front, two waiting behind it, and one more out of sight to come. */
const PLACES = 4;

/** Each place's look: how much smaller, how far turned to face the front and how dim, further back each time. */
function lookAt(place: number): { scale: number; turn: number; opacity: number } {
  return { scale: SCALE[place] ?? 0.5, turn: Math.min(place, 1) * 28 + 6 * place, opacity: OPACITY[place] ?? 0 };
}
/** How big each place is: each one back a good step smaller than the one in front, to keep the queue short. */
const SCALE = [1, 0.78, 0.62, 0.5];
/** How bright each place is: the front, then the waiting ones; any further back wait out of sight, to come in from there. */
const OPACITY = [1, 0.5, 0.3];
/** How far the eye is from a turned time, as in its transform's perspective(). */
const PERSPECTIVE = 180;
/** The space between a time and the one waiting behind it. */
const GAP = 6;
/** A time's width before it has been measured. */
const UNMEASURED_WIDTH = 90;

/** How long a time takes to move up a place, and a changed minute to roll into place. */
const MOVE_MS = 500;
const ROLL_MS = 350;
const MOVE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** A new front this much later than the last one's time is the one after it: the last one has left. */
const LATER_TRIP_MS = 60_000;

interface Drawn {
  key: string;
  place: number;
  label: string;
  face: ReactNode;
}

interface Queue<D> {
  /** Bumped each time an untracked front one leaves, so the others keep their elements as they move up a place. */
  generation: number;
  /** The untracked front one as last drawn, to tell when it has left. */
  front: D | undefined;
  /** What each element showed as last drawn, by key. */
  drawn: readonly Drawn[];
  /** Times that have left, fading where they were. */
  gone: readonly Drawn[];
  /** Faces whose minute just changed, rolling away above the new one. */
  rolled: ReadonlyMap<string, ReactNode>;
}

/** Whether `next` at the front means `previous`, which was there, has left: it was due and `next` is a later trip. */
function hasLeft(previous: { expectedAt: string }, next: { expectedAt: string } | undefined, now: Date): boolean {
  const due = Date.parse(previous.expectedAt);
  return due <= now.getTime() && (next === undefined || Date.parse(next.expectedAt) - due >= LATER_TRIP_MS);
}

/**
 * How wide a time of `width` looks turned `turn` degrees about its right edge: its left edge swings back by the cosine
 * and toward the eye by the sine, which the perspective makes bigger, so a wide one can look wider than it is.
 */
function turnedWidth(width: number, turn: number): number {
  const angle = (turn * Math.PI) / 180;
  return (width * Math.cos(angle) * PERSPECTIVE) / Math.max(PERSPECTIVE - width * Math.sin(angle), PERSPECTIVE / 4);
}

/** Whether an element is on a hidden tab (the Dashboard stays drawn while another tab shows), so has no size. */
function isHidden(element: HTMLElement): boolean {
  return element.closest('[hidden]') !== null;
}

/**
 * Where each place sits and how it looks, given each place's measured width: each one's right edge just behind the
 * left edge of the one in front of it.
 */
function layout<T>(items: readonly T[], widths: readonly number[]) {
  let edge = 0;
  const placed = items.map((item, place) => {
    const look = lookAt(place);
    const drawnWidth = turnedWidth(widths[place] ?? UNMEASURED_WIDTH, look.turn) * look.scale;
    const style = {
      transform: `translateY(-50%) translateX(${String(edge)}px) scale(${String(look.scale)}) perspective(${String(PERSPECTIVE)}px) rotateY(${String(look.turn)}deg)`,
      opacity: look.opacity
    };
    edge -= drawnWidth + GAP;
    return { ...item, style };
  });
  return placed;
}

/**
 * A route's next departures as a queue, as on a rolodex: the next one's time at the front, as on any row, and the ones
 * after it waiting to its left in the same lettering, each a little smaller, dimmer and turned to face the front. When
 * the front one leaves, it fades where it is and each one moves up a place; one that overtakes another passes it while
 * the other dims; a time whose minute changes rolls the new minute into place. Only transforms and opacity change,
 * which the Pi's GPU composites; the moves are Web Animations rather than CSS transitions, because the row itself may
 * move in the list at the same moment and a moved element drops its transitions.
 *
 * A departure is followed by `keyOf`, the source's own vehicle where it has one; where any has none (Entur gives none),
 * the queue goes by place instead and tells that the front one has left by its time.
 */
export default function EtaStack<D extends { expectedAt: string }>({
  departures,
  now,
  keyOf,
  labelOf,
  render
}: Readonly<{
  departures: readonly D[];
  now: Date;
  /** The vehicle a departure is, if the source says. */
  keyOf: (departure: D) => string | undefined;
  /** What its time says, which rolls when it changes. */
  labelOf: (departure: D) => string;
  render: (departure: D) => ReactNode;
}>) {
  const shown = departures.slice(0, PLACES);
  const [queue, setQueue] = useState<Queue<D>>(() => ({
    generation: 0,
    front: undefined,
    drawn: [],
    gone: [],
    rolled: new Map()
  }));

  // Untracked, an element stands for a place in the line, and the front leaving moves every place up.
  const tracked = shown.every(departure => keyOf(departure) !== undefined);
  let { generation } = queue;
  const front = shown[0];
  const frontLeft =
    !tracked &&
    queue.front !== undefined &&
    queue.front !== front &&
    queue.front.expectedAt !== front?.expectedAt &&
    hasLeft(queue.front, front, now);
  if (frontLeft) generation += 1;
  const items: Drawn[] = shown.map((departure, place) => ({
    key: tracked ? `v:${String(keyOf(departure))}` : `p:${String(generation + place)}`,
    place,
    label: labelOf(departure),
    face: render(departure)
  }));

  // Brought into step as it renders: what has left starts fading, a changed minute starts rolling.
  const signature = items.map(({ key, place, label }) => `${key}@${String(place)}=${label}`).join(' ');
  const drawnSignature = queue.drawn.map(({ key, place, label }) => `${key}@${String(place)}=${label}`).join(' ');
  if (signature !== drawnSignature || (!tracked && queue.front !== front)) {
    const keys = new Set(items.map(({ key }) => key));
    const before = new Map(queue.drawn.map(drawn => [drawn.key, drawn]));
    const left = queue.drawn.filter(({ key }) => !keys.has(key));
    const rolled = new Map(queue.rolled);
    for (const item of items) {
      const was = before.get(item.key);
      if (was && was.label !== item.label) rolled.set(item.key, was.face);
    }
    setQueue({
      generation,
      front,
      drawn: items,
      gone: left.length > 0 ? [...queue.gone, ...left] : queue.gone,
      rolled
    });
  }

  const { gone, rolled } = queue;
  useEffect(() => {
    if (gone.length === 0) return;
    const timer = window.setTimeout(() => setQueue(current => ({ ...current, gone: [] })), ROW_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [gone]);
  useEffect(() => {
    if (rolled.size === 0) return;
    const timer = window.setTimeout(() => setQueue(current => ({ ...current, rolled: new Map() })), ROLL_MS);
    return () => window.clearTimeout(timer);
  }, [rolled]);

  // Each place's width as drawn, so each waiting time sits just behind the one in front of it, whatever it says.
  const [widths, setWidths] = useState<readonly number[]>([]);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const placed = layout(items, widths);
  // Measured whenever any of them changes size, not only when they move: a time that gets wider ("9" to "10", or to
  // "Due") moves nothing by itself, and one drawn on the hidden Dashboard has no size until the tab comes back.
  const orderRef = useRef<readonly string[]>([]);
  const measure = useCallback(() => {
    const measured: number[] = [];
    for (const [place, key] of orderRef.current.entries()) {
      const element = elementsRef.current.get(key);
      if (!element || isHidden(element)) return;
      measured[place] = element.offsetWidth;
    }
    setWidths(current =>
      measured.length === current.length &&
      measured.every((width, place) => Math.abs(width - (current[place] ?? -1)) < 1)
        ? current
        : measured
    );
  }, []);
  const observerRef = useRef<ResizeObserver | undefined>(undefined);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  // Each element moves from where it was drawn to its new place; one that drops back dims as the other passes it.
  const drawnRef = useRef(new Map<string, { place: number; transform: string; opacity: number }>());
  const styleSignature = placed.map(({ key, style }) => `${key}:${style.transform}`).join(' ');
  useLayoutEffect(() => {
    const before = drawnRef.current;
    const rolling = rolled.size > 0;
    const after = new Map<string, { place: number; transform: string; opacity: number }>();
    for (const { key, place, style } of placed) {
      const element = elementsRef.current.get(key);
      if (!element) continue;
      after.set(key, { place, ...style });
      const was = before.get(key);
      if (
        !was ||
        was.transform === style.transform ||
        typeof element.animate !== 'function' ||
        // On the hidden Dashboard there is nothing to see, and no place to start from.
        isHidden(element) ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        continue;
      }
      // A move that interrupts another starts from wherever that one had got to.
      const running = element.getAnimations();
      const current = getComputedStyle(element);
      // Read before cancelling: the computed style is live, and would then read the new place.
      const start =
        running.length > 0
          ? { transform: current.transform, opacity: Number(current.opacity) }
          : { transform: was.transform, opacity: was.opacity };
      for (const animation of running) animation.cancel();
      const dropsBack = place > was.place;
      element.animate(
        dropsBack
          ? [start, { opacity: Math.min(start.opacity, style.opacity) * 0.3, offset: 0.5 }, style]
          : [start, style],
        // A time that changed rolls to its new minute first, then they move, so the reason for the move reads first.
        { duration: MOVE_MS, easing: MOVE_EASING, delay: rolling ? ROLL_MS : 0, fill: 'backwards' }
      );
    }
    drawnRef.current = after;
    // Measuring has to follow drawing; the widths settle after one more pass.
    orderRef.current = placed.map(({ key }) => key);
    // eslint-disable-next-line @eslint-react/set-state-in-effect -- set only when a width changed.
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      observerRef.current ??= new ResizeObserver(measure);
      observerRef.current.disconnect();
      for (const element of elementsRef.current.values()) observerRef.current.observe(element);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `placed` is summed up by the signature.
  }, [styleSignature]);

  return (
    // The room a destination leaves; a long one takes it back, down to the front time, and the queue fades under its end.
    <span className="dashboard-stack" style={{ minWidth: Math.ceil(widths[0] ?? UNMEASURED_WIDTH) }}>
      {gone.map(({ key, face }) => (
        <span
          key={`gone:${key}`}
          className="dashboard-stack-item"
          data-slot="gone"
          style={{ transform: drawnRef.current.get(key)?.transform }}
          aria-hidden
        >
          {face}
        </span>
      ))}
      {placed.map(({ key, place, label, face, style }) => (
        <span
          key={key}
          ref={element => {
            if (element) elementsRef.current.set(key, element);
            else elementsRef.current.delete(key);
          }}
          className="dashboard-stack-item"
          data-slot={place === 0 ? 'front' : `queued${String(place)}`}
          style={style}
          aria-hidden={style.opacity === 0 ? true : undefined}
        >
          {rolled.has(key) && (
            <span key={`out:${label}`} className="dashboard-stack-face" data-roll="out" aria-hidden>
              {rolled.get(key)}
            </span>
          )}
          <span key={label} className="dashboard-stack-face" data-roll={rolled.has(key) ? 'in' : undefined}>
            {face}
          </span>
        </span>
      ))}
    </span>
  );
}
