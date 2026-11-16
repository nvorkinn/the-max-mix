import type { Page } from '@playwright/test';

/** The durations of the view-transition fades the browser is running right now. */
export const runningFades = (page: Page) =>
  page.evaluate(() =>
    globalThis.document
      .getAnimations()
      .filter(animation =>
        String((animation.effect as KeyframeEffect | null)?.pseudoElement).startsWith('::view-transition')
      )
      .map(animation => Number(animation.effect?.getTiming().duration))
  );
