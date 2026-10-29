import TabletView from './components/TabletView.jsx';

/** @param {{ signInError?: string | null }} props signInError: why finishing the Spotify sign-in failed */
export default function App({ signInError = null }) {
  return <TabletView signInError={signInError} />;
}
