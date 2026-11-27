import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/** How long a leaving row takes to fade out before the rows below it move up. */
export const ROW_FADE_MS = 400;
/** How long a row takes to slide to its new place. */
const ROW_SLIDE_MS = 500;

interface AnimatedRowsProps<T> {
  /** The rows to show, in order. A row is followed by its key, so it keeps its element when the order changes. */
  items: readonly T[];
  keyOf: (item: T) => string;
  /** The row's content, inside its `li`. */
  render: (item: T) => ReactNode;
}

const keysOf = <T,>(items: readonly T[], keyOf: (item: T) => string) => items.map(item => keyOf(item));
const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

function rowState(key: string, leaving: ReadonlySet<string>, entering: ReadonlySet<string>): string | undefined {
  if (leaving.has(key)) return 'leaving';
  return entering.has(key) ? 'entering' : undefined;
}

/** The vertical translation a running slide has left the element at, in its own (unscaled) pixels. */
function currentShift(element: HTMLElement): number {
  const { transform } = getComputedStyle(element);
  if (!transform || transform === 'none') return 0;
  const match = /matrix(?:3d)?\(([^)]+)\)/.exec(transform);
  if (!match?.[1]) return 0;
  const values = match[1].split(',').map(Number);
  // matrix(a, b, c, d, tx, ty) or matrix3d(..., tx, ty, tz, 1).
  const shift = (values.length === 16 ? values[13] : values[5]) ?? 0;
  return Number.isFinite(shift) ? shift : 0;
}

/**
 * A board's rows, animated with opacity and transforms only. A row whose vehicle leaves fades out where it is; then the
 * rows below slide up into its place and a row new to the board fades in. Rows are keyed, so when the order changes (a
 * vehicle overtaking another) each row slides from where it was to where it now belongs instead of the list snapping.
 * A row's content always comes from the latest `items`; a leaving row keeps what it last showed.
 */
export default function AnimatedRows<T>({ items, keyOf, render }: Readonly<AnimatedRowsProps<T>>) {
  // `shown` is the order on screen, which trails `items` while leaving rows fade out.
  const [shown, setShown] = useState<readonly T[]>(items);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const [entering, setEntering] = useState<ReadonlySet<string>>(() => new Set());

  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;

  const targetKeys = keysOf(items, keyOf);
  const shownKeys = keysOf(shown, keyOf);
  const shownSignature = shownKeys.join('\n');

  // Brought into step as it renders: rows that left start fading, and once none is fading the new order shows.
  if (leaving.size === 0) {
    const target = new Set(targetKeys);
    const gone = shownKeys.filter(key => !target.has(key));
    if (gone.length > 0) {
      setLeaving(new Set(gone));
    } else if (!sameKeys(shownKeys, targetKeys)) {
      const before = new Set(shownKeys);
      setEntering(new Set(targetKeys.filter(key => !before.has(key))));
      setShown(items);
    }
  }

  // Once the leaving rows have faded, they go; the effect above then brings in the new order.
  useEffect(() => {
    if (leaving.size === 0) return;
    const timer = window.setTimeout(() => {
      setShown(current => current.filter(item => !leaving.has(keyRef.current(item))));
      setLeaving(new Set());
    }, ROW_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  // A new row's fade-in is a CSS animation; the class comes off once it has run, so a later reorder doesn't replay it.
  useEffect(() => {
    if (entering.size === 0) return;
    const timer = window.setTimeout(() => setEntering(new Set()), ROW_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [entering]);

  // FLIP: after each change of order, a row that moved is put back where it was with a transform, then let slide home.
  const elementsRef = useRef(new Map<string, HTMLLIElement>());
  const topsRef = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const previous = topsRef.current;
    const next = new Map<string, number>();
    for (const [key, element] of elementsRef.current) {
      const top = element.offsetTop;
      next.set(key, top);
      const was = previous.get(key);
      if (was === undefined) continue;
      const from = was + currentShift(element) - top;
      if (Math.abs(from) < 0.5) continue;
      element.style.transition = 'none';
      element.style.transform = `translateY(${from}px)`;
      // Reading layout commits the start position before the slide's transition is set.
      element.getBoundingClientRect();
      element.style.transition = `transform ${ROW_SLIDE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
      element.style.transform = '';
      // A row that drops back (it was overtaken) dims as the other passes it, so their text never reads as one jumble.
      if (from < 0 && typeof element.animate === 'function') {
        element.animate(
          [{ opacity: 1 }, { opacity: 0.15, offset: 0.2 }, { opacity: 0.15, offset: 0.7 }, { opacity: 1 }],
          { duration: ROW_SLIDE_MS }
        );
      }
    }
    topsRef.current = next;
  }, [shownSignature]);

  const fresh = new Map(items.map(item => [keyOf(item), item]));
  return (
    <>
      {shown.map(old => {
        const key = keyOf(old);
        const item = fresh.get(key) ?? old;
        const state = rowState(key, leaving, entering);
        return (
          <li
            key={key}
            data-row={state}
            ref={element => {
              if (element) elementsRef.current.set(key, element);
              else elementsRef.current.delete(key);
            }}
          >
            {render(item)}
          </li>
        );
      })}
    </>
  );
}
