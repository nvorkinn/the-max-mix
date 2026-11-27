/** A London bus stop's letter, white on a red disc as on the stop's flag (and the Dashboard's board for it). */
export default function StopLetter({ letter }: Readonly<{ letter: string }>) {
  return (
    <span className="stop-letter">
      <span className="sr-only">Stop </span>
      {letter}
    </span>
  );
}
