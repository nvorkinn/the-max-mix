import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DepartureBoardProps } from '../../dashboard/props';
import type { ArrivalsTransition } from '../../utils/arrivalsTransition';
import { runBoardTransition } from './boardTransitions';
import DepartureBoard from './DepartureBoard';

interface BoardSlotProps {
  /** Which of the two places along the bottom: 0 on the left, 1 on the right. */
  slot: number;
  board: DepartureBoardProps;
  transition: ArrivalsTransition;
}

/**
 * One of the two places along the bottom of the Dashboard, showing a stop's board. When its stop changes, the old board
 * stays laid under the new one while their lines change over (boardTransitions), then goes.
 */
export default function BoardSlot({ slot, board, transition }: Readonly<BoardSlotProps>) {
  // The board last shown, and the one leaving while a change runs; brought into step as it renders.
  const [state, setState] = useState<{ board: DepartureBoardProps; leaving: DepartureBoardProps | null }>({
    board,
    leaving: null
  });
  if (state.board !== board) {
    setState({ board, leaving: state.board.id === board.id ? state.leaving : state.board });
  }
  const { leaving } = state;

  const fromRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLDivElement>(null);
  const transitionRef = useRef(transition);
  transitionRef.current = transition;
  useLayoutEffect(() => {
    const from = fromRef.current;
    const to = toRef.current;
    if (!leaving || !from || !to) return;
    return runBoardTransition(transitionRef.current, from, to, () =>
      setState(current => (current.leaving === leaving ? { ...current, leaving: null } : current))
    );
  }, [leaving]);

  return (
    <div
      className="dashboard-departures-slot"
      data-slot={slot}
      data-board={board.id}
      data-turning={leaving ? 'true' : undefined}
      style={{ '--slot': slot } as CSSProperties}
    >
      {leaving && (
        <div key={leaving.id} ref={fromRef} className="dashboard-board-layer" data-leaving="true" inert>
          <DepartureBoard {...leaving} />
        </div>
      )}
      <div key={board.id} ref={toRef} className="dashboard-board-layer">
        <DepartureBoard {...board} />
      </div>
    </div>
  );
}
