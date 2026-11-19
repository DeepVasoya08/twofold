import { useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';

import { errorMessage } from '@arcafold/core/errors';
import type { Album } from '@arcafold/core/library/model';
import type { InviteEntry, JoinEntry } from '@arcafold/core/sharing-pass';

import { useAccount } from '../session/account';
import { useInvites } from '../sharing/invites';
import { inviteStatus, spaceName, untilText } from '../sharing/sharing-text';
import { Button } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { PillButton } from '../ui/rows';
import { usePalette } from '../ui/theme';

/** The four safety words both people compare, numbered. */
export function Phrase({ words }: { words: readonly string[] }) {
  const palette = usePalette();
  return (
    <View style={styles.phrase} accessibilityLabel={`Safety words: ${words.join(', ')}`}>
      {words.map((word, index) => (
        <View
          key={`${String(index)}-${word}`}
          style={[
            styles.word,
            { backgroundColor: palette.background, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.wordIndex, { color: palette.muted }]}>{index + 1}</Text>
          <Text style={[styles.wordText, { color: palette.text }]}>{word}</Text>
        </View>
      ))}
    </View>
  );
}

/** What an invite shares, as the inviter reads it: "your library" or "“Trip”". */
function target(album: string | null, albums: readonly Album[], where: string): string {
  if (album === null) return `your ${where}`;
  const found = albums.find((each) => each.id === album && each.library === undefined);
  return found ? `“${found.title}”` : 'an album';
}

/** Someone accepted an invite and is waiting: their name, the words, and Confirm or Cancel. */
function InviteRequest({ entry, albums }: { entry: InviteEntry; albums: readonly Album[] }) {
  const { space } = useAccount();
  const invites = useInvites();
  const notice = useNotice();
  const palette = usePalette();
  const [busy, setBusy] = useState(false);
  if (entry.progress.stage !== 'confirm') return null;
  const { name, phrase } = entry.progress;
  const id = entry.invite.id;
  const run = (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    action()
      .catch((error: unknown) => {
        notice(errorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <View
      style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.accent }]}
      accessibilityLiveRegion="polite"
    >
      <Text style={[styles.lead, { color: palette.text }]}>
        <Text style={styles.bold}>{name}</Text> wants to join{' '}
        {target(entry.invite.album, albums, spaceName(space))}. Check these 4 words with them:
      </Text>
      <Phrase words={phrase} />
      <Text style={[styles.note, { color: palette.muted }]}>
        If the words don’t match, cancel. Someone else may have your link or code.
      </Text>
      <Button
        label="They match, share"
        busyLabel="Sharing…"
        busy={busy}
        onPress={() => {
          run(() => invites.confirm(id));
        }}
      />
      <Button
        kind="link"
        label="Cancel"
        onPress={() => {
          run(async () => {
            await invites.cancel(id);
            notice('Invite cancelled');
          });
        }}
      />
    </View>
  );
}

/** An invite this space accepted, waiting for the other person to confirm the words. */
function JoinNotice({ entry }: { entry: JoinEntry }) {
  const palette = usePalette();
  if (entry.progress.stage !== 'check') return null;
  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Text style={[styles.lead, { color: palette.text }]}>
        Waiting for <Text style={styles.bold}>{entry.progress.name}</Text> to confirm. Check they
        see these same four words:
      </Text>
      <Phrase words={entry.progress.phrase} />
    </View>
  );
}

/**
 * Invites that need a look, over the top of the library's screens: someone waiting for you
 * to check the words, and invites you accepted that are waiting on the other person.
 */
export function InviteRequests({
  albums,
  showJoins,
}: {
  albums: readonly Album[];
  /** Off while the screen for entering a code shows them itself. */
  showJoins: boolean;
}) {
  const { invites, joins } = useInvites();
  const asking = invites.filter((entry) => entry.progress.stage === 'confirm');
  const waiting = showJoins ? joins.filter((entry) => entry.progress.stage === 'check') : [];
  if (asking.length === 0 && waiting.length === 0) return null;
  return (
    <View
      style={[styles.requests, { top: (StatusBar.currentHeight ?? 24) + 60 }]}
      pointerEvents="box-none"
    >
      {asking.map((entry) => (
        <InviteRequest key={entry.invite.id} entry={entry} albums={albums} />
      ))}
      {waiting.map((entry) => (
        <JoinNotice key={entry.join.id} entry={entry} />
      ))}
    </View>
  );
}

/** Invites still waiting for one album or the library, with Cancel. */
export function PendingInviteList({
  album,
  exclude,
}: {
  album: string | null;
  exclude: string | null;
}) {
  const invites = useInvites();
  const notice = useNotice();
  const palette = usePalette();
  const [busy, setBusy] = useState<string | null>(null);
  const shown = invites.invites.filter(
    (entry) => entry.invite.id !== exclude && entry.invite.album === album,
  );
  if (shown.length === 0) return null;
  const cancel = (id: string) => {
    if (busy) return;
    setBusy(id);
    invites
      .cancel(id)
      .then(
        () => {
          notice('Invite cancelled');
        },
        (error: unknown) => {
          notice(errorMessage(error));
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };
  return (
    <View style={styles.pending}>
      <Text style={[styles.pendingTitle, { color: palette.muted }]} accessibilityRole="header">
        Invites waiting
      </Text>
      {shown.map((entry) => (
        <View key={entry.invite.id} style={[styles.pendingRow, { borderColor: palette.border }]}>
          <View style={styles.pendingText}>
            <Text style={[styles.code, { color: palette.text }]} selectable>
              {entry.invite.code}
            </Text>
            <Text style={[styles.note, { color: palette.muted }]}>
              {inviteStatus(entry)} · {untilText(entry.invite.expiresAt)}
            </Text>
          </View>
          <PillButton
            label="Cancel"
            accessibilityLabel={`Cancel invite ${entry.invite.code}`}
            danger
            disabled={busy !== null}
            palette={palette}
            onPress={() => {
              cancel(entry.invite.id);
            }}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  requests: { position: 'absolute', left: 12, right: 12, gap: 10 },
  card: { borderWidth: 1.5, borderRadius: 18, padding: 16, gap: 12, elevation: 10 },
  lead: { fontSize: 15, lineHeight: 21 },
  bold: { fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 18 },
  phrase: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  word: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: '46%',
    flexGrow: 1,
  },
  wordIndex: { fontSize: 12, fontWeight: '700' },
  wordText: { fontSize: 17, fontWeight: '700' },
  pending: { gap: 8 },
  pendingTitle: { fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pendingText: { flex: 1, gap: 2 },
  code: { fontSize: 15, fontWeight: '700', letterSpacing: 1 },
});
