import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View } from 'react-native';

import { ConfirmEmail } from './src/screens/ConfirmEmail';
import { Home } from './src/screens/Home';
import { RecoveryWords } from './src/screens/RecoveryWords';
import { SignIn } from './src/screens/SignIn';
import { SignUp } from './src/screens/SignUp';
import { Unlock } from './src/screens/Unlock';
import { forgetSignUpChoice, routeFor } from './src/routes';
import { AccountProvider, useAccount } from './src/session/account';
import { AppearanceProvider } from './src/ui/appearance';
import { usePalette } from './src/ui/theme';

function Routes() {
  const { state, pendingSignUp } = useAccount();
  const [signingUp, setSigningUp] = useState(false);
  // Once in, the next time the app is signed out it starts at sign-in, not sign-up.
  if (signingUp && forgetSignUpChoice(state)) setSigningUp(false);
  switch (routeFor(state, pendingSignUp !== null, signingUp)) {
    case 'starting':
      return null;
    case 'timeline':
      return state.status === 'unlocked' ? <Home session={state.session} /> : null;
    case 'confirm-email':
      return <ConfirmEmail />;
    case 'unlock':
      return <Unlock />;
    case 'recovery-words':
      return <RecoveryWords />;
    case 'sign-up':
      return (
        <SignUp
          onSignIn={() => {
            setSigningUp(false);
          }}
        />
      );
    case 'sign-in':
      return (
        <SignIn
          onSignUp={() => {
            setSigningUp(true);
          }}
        />
      );
  }
}

/** Every touch counts as activity, so the app only auto-locks once it sits untouched. */
function Shell() {
  const { touched } = useAccount();
  const palette = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }} onTouchStart={touched}>
      <Routes />
      <StatusBar style={palette.dark ? 'light' : 'dark'} />
    </View>
  );
}

export default function App() {
  return (
    <AppearanceProvider>
      <AccountProvider>
        <Shell />
      </AccountProvider>
    </AppearanceProvider>
  );
}
