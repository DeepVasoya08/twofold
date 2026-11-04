import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { View, useColorScheme } from 'react-native';

import { Home } from './src/screens/Home';
import { RecoveryWords } from './src/screens/RecoveryWords';
import { SignIn } from './src/screens/SignIn';
import { SignUp } from './src/screens/SignUp';
import { Unlock } from './src/screens/Unlock';
import { AccountProvider, useAccount } from './src/session/account';
import { usePalette } from './src/ui/theme';

function Routes() {
  const { state, pendingSignUp } = useAccount();
  const [signingUp, setSigningUp] = useState(false);
  if (state.status === 'unlocked') return <Home />;
  if (state.status === 'locked') return <Unlock />;
  if (pendingSignUp) return <RecoveryWords />;
  if (signingUp) {
    return (
      <SignUp
        onSignIn={() => {
          setSigningUp(false);
        }}
      />
    );
  }
  return (
    <SignIn
      onSignUp={() => {
        setSigningUp(true);
      }}
    />
  );
}

/** Every touch counts as activity, so the app only auto-locks once it sits untouched. */
function Shell() {
  const { touched } = useAccount();
  const palette = usePalette();
  const scheme = useColorScheme();
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }} onTouchStart={touched}>
      <Routes />
      <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
    </View>
  );
}

export default function App() {
  return (
    <AccountProvider>
      <Shell />
    </AccountProvider>
  );
}
