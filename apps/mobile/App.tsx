import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';

import { colors } from './src/theme';

/** The first screen. Sign-in and unlock arrive in the next build. */
export default function App() {
  const scheme = useColorScheme() === 'light' ? 'light' : 'dark';
  const palette = colors[scheme];
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <Text style={[styles.title, { color: palette.text }]}>Arcafold</Text>
      <Text style={[styles.body, { color: palette.muted }]}>
        Your photos, encrypted on this phone before they leave it.
      </Text>
      <Text style={[styles.note, { color: palette.muted }]}>
        Sign-in is coming in the next build.
      </Text>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '700' },
  body: { fontSize: 16, textAlign: 'center' },
  note: { fontSize: 14, textAlign: 'center' },
});
