/** How often a carousel on the Dashboard moves along by one: the boards along the bottom, the rail's pages and the weather's periods. */
export const TURN_MS = 15_000;
/** How long after a turn the one that left stays where it went, before it waits off to the right for its next turn. */
const LEFT_FOR_MS = 1000;

/**
 * Where item `index` of `count` is at `time`, in a carousel showing `shown` at once: 0 to `shown` - 1 are the places
 * on show; -1 is just off to the left, where the one that has just left slid; `shown` is off to the right, where the
 * rest wait to slide in. With more than `shown`, every TURN_MS the left one leaves, the rest move over and the next one
 * comes in on the right. `time` is the Dashboard's clock, so a hidden Dashboard, whose clock stops, doesn't move.
 */
export function carouselSlot(index: number, count: number, time: number, shown: number): number {
  if (count <= shown) return index;
  const turn = Math.floor(time / TURN_MS);
  const position = (((index - turn) % count) + count) % count;
  if (position < shown) return position;
  return position === count - 1 && time % TURN_MS < LEFT_FOR_MS ? -1 : shown;
}
