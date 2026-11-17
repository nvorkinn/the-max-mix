import { useLayoutEffect, type RefObject } from 'react';

/**
 * Cuts the list's height down to its last row that fits whole in `frame`, so no row shows cut in half at the foot. It
 * measures again whenever the frame or a row changes size (a title wrapping, a font arriving) or `rows` changes.
 */
export function useWholeRows(frame: RefObject<HTMLElement | null>, list: RefObject<HTMLElement | null>, rows: unknown) {
  useLayoutEffect(() => {
    const frameElement = frame.current;
    const listElement = list.current;
    if (!frameElement || !listElement) return;
    const fit = () => {
      listElement.style.maxHeight = '';
      const top = listElement.getBoundingClientRect().top;
      const room = frameElement.getBoundingClientRect().bottom - top;
      let height = 0;
      for (const row of listElement.children) {
        const bottom = row.getBoundingClientRect().bottom - top + listElement.scrollTop;
        if (bottom > room + 0.5) break;
        height = bottom;
      }
      // Nothing laid out (as in tests): leave the list as the stylesheet has it.
      if (room > 0) listElement.style.maxHeight = `${Math.max(0, Math.floor(height))}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(frameElement);
    for (const row of listElement.children) observer.observe(row);
    return () => observer.disconnect();
  }, [frame, list, rows]);
}
