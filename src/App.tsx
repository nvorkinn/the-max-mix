import SetupWizard from './components/setup/SetupWizard';
import TabletView from './components/TabletView';

// isSettingUp: a kiosk still going through its first-time setup, which the wizard covers until it is done.
export default function App({ isSettingUp = false }: Readonly<{ isSettingUp?: boolean }>) {
  return isSettingUp ? <SetupWizard /> : <TabletView />;
}
