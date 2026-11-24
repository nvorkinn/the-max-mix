import PairingScreen from './components/PairingScreen';
import TabletView from './components/TabletView';
import type { KioskScreen } from './countdown/registration';

// pairScreen: the Pi's screen, while the kiosk still has to be added to countdown-server (the pairing QR code covers the
// app until someone owns it).
export default function App({ pairScreen = null }: Readonly<{ pairScreen?: KioskScreen | null }>) {
  return (
    <>
      <TabletView />
      {pairScreen && <PairingScreen screen={pairScreen} />}
    </>
  );
}
