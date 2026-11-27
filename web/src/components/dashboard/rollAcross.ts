// A line of the Dashboard too long for its place: a destination over a route's queue of times, a notice's title.
import { useEffect, useRef } from 'react';

/** How often a line of words cut short rolls across to show the rest of it. */
export const ROLL_ACROSS_EVERY_MS = 20_000;
/** How fast it rolls, in pixels a second, and how long it waits at its end before rolling back. */
const ROLL_ACROSS_SPEED = 60;
const ROLL_ACROSS_HOLD_MS = 1500;

/**
 * Every so often rolls a line cut short across, to its end and back, so the whole of it is read in turn: only a
 * transform, which the Pi's GPU composites. The ref goes on the words; the element around them is the box that cuts
 * them off, and it carries data-rolling while they roll, for the style sheet to set their "…" aside. A line that fits
 * is left alone, as is every line when less motion is asked for.
 */
export function useRollAcross(enabled = true) {
  const nameRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const name = nameRef.current;
    const box = name?.parentElement;
    if (!enabled || !name || !box) return;
    let rolling: Animation | undefined;
    const roll = () => {
      const overflow = name.scrollWidth - name.clientWidth;
      if (
        overflow < 1 ||
        typeof name.animate !== 'function' ||
        name.closest('[hidden]') !== null ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }
      const moveMs = (overflow / ROLL_ACROSS_SPEED) * 1000;
      const total = moveMs * 2 + ROLL_ACROSS_HOLD_MS;
      const end = `translateX(${String(-overflow)}px)`;
      box.dataset['rolling'] = 'true';
      rolling = name.animate(
        [
          { transform: 'translateX(0)' },
          { transform: end, offset: moveMs / total },
          { transform: end, offset: (moveMs + ROLL_ACROSS_HOLD_MS) / total },
          { transform: 'translateX(0)' }
        ],
        { duration: total, easing: 'ease-in-out' }
      );
      rolling.onfinish = () => {
        delete box.dataset['rolling'];
      };
    };
    const timer = window.setInterval(roll, ROLL_ACROSS_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      rolling?.cancel();
      delete box.dataset['rolling'];
    };
  }, [enabled]);
  return nameRef;
}
