import { flushSync } from 'react-dom';

/**
 * Runs a screen change as a full-screen crossfade (the View Transitions API: the browser snapshots the old screen,
 * applies `update`, and fades to the new one over 500 ms, see index.css). Chromium cuts the previous fade
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

/**
 * Like crossfade, but one element flies from where it was to where its counterpart is after `update`, growing or
 * shrinking on the way (a shared-element transition: `from` names the element before the change, `to` after it; both
 * are looked up when needed, so they can be inside what `update` adds or removes). The rest of the screen fades as in
 * crossfade. When either end is missing the whole screen just fades. Only one element carries the name at a time, as
 * the API requires.
 */
export function flyAcross(
  name: string,
  from: () => HTMLElement | null,
  to: () => HTMLElement | null,
  update: () => void
) {
  const start = (document as Partial<Document>).startViewTransition?.bind(document);
  const source = from();
  if (!start || !source || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  let target: HTMLElement | null = null;
  source.style.viewTransitionName = name;
  const transition = start(() => {
    // eslint-disable-next-line @eslint-react/dom-no-flush-sync -- the snapshot of the new screen is taken when this returns
    flushSync(update);
    source.style.viewTransitionName = '';
    target = to();
    if (target) target.style.viewTransitionName = name;
  });
  const clear = () => {
    source.style.viewTransitionName = '';
    if (target) target.style.viewTransitionName = '';
  };
  void transition.finished.finally(clear);
}
