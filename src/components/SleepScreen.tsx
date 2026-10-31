/**
 * The kiosk's black sleep screen (hooks/useScreenSleep). It covers everything, so the tap that wakes the screen lands
 * here and never presses a button behind it. Black also keeps the panel dark if the Pi could not turn its output off.
 */
export default function SleepScreen({ onWake }: Readonly<{ onWake: () => void }>) {
  return (
    <button
      type="button"
      className="sleep-screen"
      aria-label="Wake the screen"
      onPointerDown={event => event.preventDefault()}
      onClick={event => {
        event.stopPropagation();
        onWake();
      }}
    />
  );
}
