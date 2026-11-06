import { useEffect, useState } from 'react';
import { BackHandler, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import fingerprint from '../../assets/fingerprint.png';
import { useAccount } from '../session/account';
import { Banner, Button } from '../ui/kit';
import { usePalette } from '../ui/theme';

/**
 * Offers fingerprint and face unlock once, as a sheet over the timeline, just after the main
 * password opened the library. Drawn in the app's own window, like the other sheets.
 */
export function BiometricSheet() {
  const { biometricOffer, answerBiometricOffer } = useAccount();
  const palette = usePalette();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showing = biometricOffer || error !== null;

  // Back answers "Not now", as tapping outside the sheet does.
  useEffect(() => {
    if (!showing) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      setError(null);
      if (biometricOffer) void answerBiometricOffer(false).catch(() => undefined);
      return true;
    });
    return () => {
      back.remove();
    };
  }, [showing, biometricOffer, answerBiometricOffer]);

  if (!showing) return null;

  const answer = (turnOn: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    answerBiometricOffer(turnOn)
      .catch(() => {
        setError('Fingerprint unlock wasn’t turned on. You can try again next time you unlock.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <View style={styles.backdrop}>
      <Pressable
        style={styles.dismiss}
        accessibilityLabel="Not now"
        onPress={() => {
          if (error) setError(null);
          else answer(false);
        }}
      />
      <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
        <View style={[styles.handle, { backgroundColor: palette.border }]} />
        <View style={[styles.badge, { backgroundColor: palette.accent }]}>
          <Image
            source={fingerprint}
            style={[styles.icon, { tintColor: palette.onAccent }]}
            accessible={false}
          />
        </View>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Unlock with your fingerprint
        </Text>
        <Text style={[styles.body, { color: palette.muted }]}>
          Open Arcafold with your fingerprint or face instead of typing your password. It only opens
          your library, and your password always works too.
        </Text>
        {error ? (
          <>
            <Banner>{error}</Banner>
            <Button
              label="OK"
              onPress={() => {
                setError(null);
              }}
            />
          </>
        ) : (
          <View style={styles.actions}>
            <Button
              label="Turn on"
              busyLabel="Waiting for your fingerprint…"
              busy={busy}
              onPress={() => {
                answer(true);
              }}
            />
            <Button
              kind="link"
              label="Not now"
              onPress={() => {
                answer(false);
              }}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  dismiss: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
    alignItems: 'center',
    gap: 14,
  },
  handle: { width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: 44, height: 44 },
  title: { fontSize: 21, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 6 },
  actions: { alignSelf: 'stretch', gap: 4 },
});
