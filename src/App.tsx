import TabletView from './components/TabletView';

// signInError: why finishing the Spotify sign-in failed
export default function App({ signInError = null }: Readonly<{ signInError?: string | null }>) {
  return <TabletView signInError={signInError} />;
}
