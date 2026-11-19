import { useEffect, useState } from 'react';
import {
  BackHandler,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { errorMessage } from '@arcafold/core/errors';
import { NOT_AN_INVITE, parseInviteInput } from '@arcafold/core/invite-input';

import { useAccount } from '../session/account';
import { useInvites } from '../sharing/invites';
import { joinStatus, spaceName } from '../sharing/sharing-text';
import { Banner, Button, Field, Note } from '../ui/kit';
import { usePalette } from '../ui/theme';
import { Phrase } from './InviteCards';

/**
 * Where an invite code someone sent is typed in (or their invite link pasted). Accepting
 * sends this side's key and can be left at once; who invited you shows up once they're back,
 * and you both check four words before anything is shared.
 */
export function JoinScreen({ onClose }: { onClose: () => void }) {
  const { space } = useAccount();
  const palette = usePalette();
  const invites = useInvites();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const where = spaceName(space);
  const { watch } = invites;
  useEffect(() => watch(), [watch]);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [onClose]);

  const entry = invites.joins.find((each) => each.join.ref === joined);
  const ended = joined !== null && invites.ended.joins.includes(joined);
  const granted = joined !== null && invites.granted.includes(joined);

  const join = () => {
    if (busy) return;
    const ref = parseInviteInput(input);
    if (ref === null) {
      setError(NOT_AN_INVITE);
      return;
    }
    if (invites.invites.some((each) => each.invite.code === ref || each.invite.link === ref)) {
      setError('That’s your own invite. Send it to the person you want to share with.');
      return;
    }
    setBusy(true);
    setError(null);
    invites.accept(ref).then(
      () => {
        setJoined(ref);
        setBusy(false);
      },
      (caught: unknown) => {
        setError(errorMessage(caught));
        setBusy(false);
      },
    );
  };

  let body;
  if (granted) {
    body = (
      <>
        <Text style={[styles.lead, { color: palette.text }]}>
          You’re in. What they shared is in your {where} now.
        </Text>
        <Button label="Done" onPress={onClose} />
      </>
    );
  } else if (joined !== null && !ended) {
    body = (
      <>
        <Text style={[styles.lead, { color: palette.text }]} accessibilityLiveRegion="polite">
          {joinStatus(entry)}
        </Text>
        {entry?.progress.stage === 'check' ? <Phrase words={entry.progress.phrase} /> : null}
        <Note>
          Nothing is shared until they confirm the words match. If they don’t match, tell them, and
          leave the invite.
        </Note>
        <Button kind="secondary" label="Close" onPress={onClose} />
        {entry ? (
          <Button
            kind="link"
            label="Leave this invite"
            onPress={() => {
              void invites.leave(entry.join.id).then(onClose, onClose);
            }}
          />
        ) : null}
      </>
    );
  } else {
    body = (
      <>
        {ended ? <Banner>That invite ended, so nothing was shared.</Banner> : null}
        <Field
          label="Invite code"
          placeholder="TWO-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          value={input}
          returnKeyType="go"
          onSubmitEditing={join}
          onChangeText={(text) => {
            setInput(text);
            setError(null);
          }}
          error={error}
        />
        <Note>
          What they share will appear in your {where}, and only there. You’ll both check four words
          before anything is shared.
        </Note>
        <Button label="Join" busyLabel="Joining…" busy={busy} onPress={join} />
      </>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.screen, { backgroundColor: palette.background }]}
    >
      <View style={[styles.header, { paddingTop: (StatusBar.currentHeight ?? 24) + 12 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          hitSlop={12}
          style={styles.close}
        >
          <Text style={[styles.closeText, { color: palette.text }]}>✕</Text>
        </Pressable>
        <Text style={[styles.title, { color: palette.text }]} accessibilityRole="header">
          Enter an invite code
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {joined === null ? (
          <Text style={[styles.lead, { color: palette.muted }]}>
            Type the code someone sent you, or paste their invite link.
          </Text>
        ) : null}
        {body}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: 22 },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 16 },
  lead: { fontSize: 15, lineHeight: 21 },
});
