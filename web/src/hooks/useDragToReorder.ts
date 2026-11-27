// Dragging a list's rows into a new order by touch (or mouse), from a handle on each row. While a row is dragged it
// follows the finger, the rows it passes slide out of its way, and the list scrolls when the finger nears its top or
// bottom edge. Letting go calls onMove with the row's old and new place; nothing moves in the list itself until the
// caller gives it the new order. The arrow keys move a focused handle's row one place up or down.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from 'react';

/** How near the list's top or bottom edge (px) the finger makes it scroll, and how fast (px per frame) at most. */
const EDGE_PX = 56;
const MAX_SCROLL_PX = 12;

/** The row being dragged: where it was, the place it would go now, and how far it has moved (px). */
interface Drag {
  from: number;
  to: number;
  offset: number;
  /** The dragged row's height: how far the rows it passes slide. */
  height: number;
}

interface Gesture {
  from: number;
  pointerId: number;
  startY: number;
  lastY: number;
  startScroll: number;
  /** Each row's middle and the dragged row's height, in the list's own coordinates, when the drag began. */
  middles: number[];
  height: number;
  frame: number;
}

/** The place a row dragged from `from` with its middle at `middle` would take among rows with these middles. */
function placeFor(middles: readonly number[], from: number, middle: number): number {
  let to = from;
  for (let index = from + 1; index < middles.length && middle > (middles[index] ?? Infinity); index++) to = index;
  for (let index = from - 1; index >= 0 && middle < (middles[index] ?? -Infinity); index--) to = index;
  return to;
}

export interface DragToReorder {
  /** Whether a row is being dragged now. */
  dragging: boolean;
  /** The props for the handle of the row at `index`. */
  handleProps: (index: number) => {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: (event: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
  /** Where the row at `index` is drawn while a row is dragged, and whether it is the dragged one. */
  rowStyle: (index: number) => { style?: CSSProperties; isDragged: boolean };
}

/**
 * Lets the rows of `list` (each a direct child) be dragged into a new order; `onMove(from, to)` when one is let go
 * somewhere else. Without onMove nothing can be dragged. `count` is how many rows there are, for the arrow keys.
 */
export function useDragToReorder(
  list: RefObject<HTMLElement | null>,
  count: number,
  onMove: ((from: number, to: number) => unknown) | undefined
): DragToReorder {
  const [drag, setDrag] = useState<Drag | null>(null);
  const gestureRef = useRef<Gesture | null>(null);

  // A drag still under way when the list goes stops scrolling it.
  useEffect(() => {
    const held = gestureRef;
    return () => {
      if (held.current) cancelAnimationFrame(held.current.frame);
    };
  }, []);

  /** Where the dragged row would go now, and how far it has moved, counting what the list scrolled meanwhile. */
  const placeNow = (current: Gesture, element: HTMLElement) => {
    const offset = current.lastY - current.startY + element.scrollTop - current.startScroll;
    const middle = (current.middles[current.from] ?? 0) + offset;
    return { to: placeFor(current.middles, current.from, middle), offset };
  };

  const follow = (current: Gesture, element: HTMLElement) => {
    setDrag({ from: current.from, height: current.height, ...placeNow(current, element) });
  };

  const end = (isDropped: boolean) => {
    const current = gestureRef.current;
    if (!current) return;
    cancelAnimationFrame(current.frame);
    gestureRef.current = null;
    setDrag(null);
    const element = list.current;
    if (!isDropped || !element) return;
    const { to } = placeNow(current, element);
    if (to !== current.from) void onMove?.(current.from, to);
  };

  const handleProps = (index: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const element = list.current;
      if (!onMove || !element || gestureRef.current || !event.isPrimary) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      const listTop = element.getBoundingClientRect().top - element.scrollTop;
      const rows = [...element.children].map(row => row.getBoundingClientRect());
      const current: Gesture = {
        from: index,
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        startScroll: element.scrollTop,
        middles: rows.map(row => row.top - listTop + row.height / 2),
        height: rows[index]?.height ?? 0,
        frame: 0
      };
      // Scrolls the list while the finger is near its top or bottom edge, faster the nearer it is.
      const scrollNearEdges = () => {
        const { top, bottom } = element.getBoundingClientRect();
        const nearTop = top + EDGE_PX - current.lastY;
        const nearBottom = current.lastY - (bottom - EDGE_PX);
        let speed = 0;
        if (nearTop > 0) speed = -Math.min(MAX_SCROLL_PX, nearTop / 4);
        else if (nearBottom > 0) speed = Math.min(MAX_SCROLL_PX, nearBottom / 4);
        const before = element.scrollTop;
        if (speed !== 0) element.scrollTop += speed;
        if (element.scrollTop !== before) follow(current, element);
        current.frame = requestAnimationFrame(scrollNearEdges);
      };
      current.frame = requestAnimationFrame(scrollNearEdges);
      gestureRef.current = current;
      setDrag({ from: index, to: index, offset: 0, height: current.height });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = gestureRef.current;
      const element = list.current;
      if (!element || current?.pointerId !== event.pointerId) return;
      current.lastY = event.clientY;
      follow(current, element);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (gestureRef.current?.pointerId === event.pointerId) end(true);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (gestureRef.current?.pointerId === event.pointerId) end(false);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!onMove || gestureRef.current) return;
      let to = -1;
      if (event.key === 'ArrowUp') to = index - 1;
      else if (event.key === 'ArrowDown') to = index + 1;
      if (to < 0 || to >= count) return;
      event.preventDefault();
      void onMove(index, to);
    }
  });

  const rowStyle = (index: number): { style?: CSSProperties; isDragged: boolean } => {
    if (!drag) return { isDragged: false };
    if (index === drag.from) return { style: { transform: `translateY(${drag.offset}px)` }, isDragged: true };
    let shift = 0;
    if (drag.from < index && index <= drag.to) shift = -drag.height;
    else if (drag.to <= index && index < drag.from) shift = drag.height;
    return shift === 0 ? { isDragged: false } : { style: { transform: `translateY(${shift}px)` }, isDragged: false };
  };

  return { dragging: drag !== null, handleProps, rowStyle };
}
