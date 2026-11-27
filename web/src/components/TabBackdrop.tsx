import fallbackBackdrop from '../assets/dashboard/backdrop.jpg';
import { useDayPhoto } from '../dashboard/useDayPhoto';
import Backdrop from './dashboard/Backdrop';

/**
 * The Dashboard's photo behind the Spotify and Settings tabs: the day's from countdown-server, or else the one bundled
 * with the app.
 */
export default function TabBackdrop({ now }: Readonly<{ now: Date }>) {
  return <Backdrop url={useDayPhoto(now) ?? fallbackBackdrop} />;
}
