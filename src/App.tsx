import PairingScreen from './components/PairingScreen';
import TabletView from './components/TabletView';
import type { KioskScreen } from './countdown/registration';

// signInError: why finishing the Spotify sign-in failed; pairScreen: the Pi's screen, while the kiosk still has to be
// added to countdown-server (the pairing QR code covers the app until someone owns it).
export default function App({
  signInError = null,
  pairScreen = null
}: Readonly<{ signInError?: string | null; pairScreen?: KioskScreen | null }>) {
  return (
    <>
      <TabletView signInError={signInError} />
      {pairScreen && <PairingScreen screen={pairScreen} />}
    </>
  );
}
