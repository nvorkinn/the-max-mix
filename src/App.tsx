import { useState } from 'react';
import RegistrationProblem from './components/RegistrationProblem';
import TabletView from './components/TabletView';
import { startRegistration } from './countdown/registration';

// signInError: why finishing the Spotify sign-in failed; registrationError: why adding the screen to countdown-server did
export default function App({
  signInError = null,
  registrationError = null
}: Readonly<{ signInError?: string | null; registrationError?: string | null }>) {
  const [registrationProblem, setRegistrationProblem] = useState(registrationError);
  return (
    <>
      <TabletView signInError={signInError} />
      {registrationProblem && (
        <RegistrationProblem
          error={registrationProblem}
          onRetry={() => void startRegistration()}
          onClose={() => setRegistrationProblem(null)}
        />
      )}
    </>
  );
}
