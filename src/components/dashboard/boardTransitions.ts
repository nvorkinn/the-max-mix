// How a place along the bottom of the Dashboard changes from one stop's board to the next: line by line, the board's
// heading first and each departure after it a beat later, the old lines leaving and the new ones arriving each in its
// own row. One runner times every style (the beat, each line's duration, the easing); a style only says what moves.
import type { ArrivalsTransition } from '../../utils/arrivalsTransition';

/** How long a line takes to change, and the beat between one line and the next. */
const LINE_MS = 600;
const STAGGER_MS = 120;
/** Smoothstep (3t² − 2t³): with these control points a cubic Bézier is exactly that curve. */
const EASING = 'cubic-bezier(0.333, 0, 0.667, 1)';

/** One side of a change: what moves (each line, or what is in its clipped row), how, and when. */
interface Phase {
  moves: 'line' | 'content';
  /** The keyframes for a line `height` pixels tall. Transforms and opacity only, which the Pi's GPU composites. */
  keyframes: (height: number) => Keyframe[];
  /** When the first line starts, after the change begins; each line below it starts a beat later. */
  start: number;
  duration: number;
}

/** How the old board's lines leave and the new board's lines arrive, for a board of `lines` lines. */
type Style = (lines: number) => { leave: Phase; arrive: Phase };

const HALF = LINE_MS / 2;

const STYLES: Record<Exclude<ArrivalsTransition, 'none'>, Style> = {
  // Split-flap: each line folds shut, and opens on the new one.
  flip: () => ({
    leave: {
      moves: 'line',
      start: 0,
      duration: HALF,
      keyframes: () => [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }]
    },
    arrive: {
      moves: 'line',
      start: HALF,
      duration: HALF,
      keyframes: () => [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }]
    }
  }),
  // In each line's row, the old line slides up and out as the new one slides up in under it.
  slide: () => ({
    leave: {
      moves: 'content',
      start: 0,
      duration: LINE_MS,
      keyframes: height => [{ transform: 'translateY(0)' }, { transform: `translateY(${String(-height)}px)` }]
    },
    arrive: {
      moves: 'content',
      start: 0,
      duration: LINE_MS,
      keyframes: height => [{ transform: `translateY(${String(height)}px)` }, { transform: 'translateY(0)' }]
    }
  }),
  // Each line drops out of its row; once the last has gone, the new ones rise into theirs.
  sinkRise: lines => ({
    leave: {
      moves: 'content',
      start: 0,
      duration: LINE_MS,
      keyframes: height => [{ transform: 'translateY(0)' }, { transform: `translateY(${String(height)}px)` }]
    },
    arrive: {
      moves: 'content',
      start: (lines - 1) * STAGGER_MS + LINE_MS,
      duration: LINE_MS,
      keyframes: height => [{ transform: `translateY(${String(height)}px)` }, { transform: 'translateY(0)' }]
    }
  })
};

/** A board's lines, top to bottom: its heading, then each departure's row. */
const linesOf = (board: HTMLElement): HTMLElement[] => [
  ...board.querySelectorAll<HTMLElement>('.dashboard-board-head, .dashboard-rows > li')
];

function play(lines: readonly HTMLElement[], phase: Phase, fill: FillMode): Animation[] {
  return lines.flatMap((line, index) => {
    const keyframes = phase.keyframes(line.offsetHeight);
    const timing: KeyframeAnimationOptions = {
      duration: phase.duration,
      delay: phase.start + index * STAGGER_MS,
      easing: EASING,
      fill
    };
    const moving = phase.moves === 'line' ? [line] : ([...line.children] as HTMLElement[]);
    return moving.map(element => element.animate(keyframes, timing));
  });
}

const lessMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Changes from the board in `from` to the board in `to`, laid over each other, in `style`, and calls `done` once the
 * last line has changed (at once with no transition, or when less motion is asked for). A line one board has and the
 * other hasn't changes to or from an empty row. Returns a function that stops the change part way.
 */
export function runBoardTransition(
  style: ArrivalsTransition,
  from: HTMLElement,
  to: HTMLElement,
  done: () => void
): () => void {
  if (style === 'none' || typeof to.animate !== 'function' || lessMotion()) {
    done();
    return () => undefined;
  }
  const leaving = linesOf(from);
  const arriving = linesOf(to);
  const { leave, arrive } = STYLES[style](Math.max(leaving.length, arriving.length));
  // The old lines stay where they went until the old board goes; the new ones wait where they start until their turn.
  const animations = [...play(leaving, leave, 'forwards'), ...play(arriving, arrive, 'backwards')];
  let stopped = false;
  Promise.all(animations.map(animation => animation.finished)).then(
    () => {
      if (!stopped) done();
    },
    () => undefined
  );
  return () => {
    stopped = true;
    for (const animation of animations) animation.cancel();
  };
}
