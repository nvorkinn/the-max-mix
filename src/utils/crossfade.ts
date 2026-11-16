import { flushSync } from 'react-dom';

/**
 * Runs a screen change as a full-screen crossfade (the View Transitions API: the browser snapshots the old screen,
 * applies `update`, and fades to the new one over 300 ms, see index.css). Chromium cuts the previous fade
 * short when a new one starts, so rapid taps cannot leave a fade half done. Without the API, or when the person asks
 * for less motion, the screen changes at once.
 */
export function crossfade(update: () => void) {
  // Older browsers and jsdom lack the API, which the DOM types take for granted.
  const start = (document as Partial<Document>).startViewTransition?.bind(document);
  if (!start || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  // flushSync: the new screen has to be in the DOM when the callback returns, or the fade would end on the old one.
  // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- the snapshot of the new screen is taken when this returns
  start(() => flushSync(update));
}
