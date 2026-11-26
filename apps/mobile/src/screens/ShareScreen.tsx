import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Session } from '@arcafold/core/account';
import { errorMessage } from '@arcafold/core/errors';
import { inviteLinkFor } from '@arcafold/core/invite-input';
import { listMembers, removeMember, updateMemberAccess } from '@arcafold/core/sharing';
import type { Member } from '@arcafold/core/sharing';
import type { MemberAccess } from '@arcafold/types';

import { bottomInset } from '../../modules/system-bars';
import { API_ORIGIN } from '../config';
import { useAccount } from '../session/account';
import { useInvites } from '../sharing/invites';
import {
  ACCESS_LABELS,
  accessChangedText,
  inviteMessage,
  shareAccessLabels,
  shareIntro,
  spaceName,
} from '../sharing/sharing-text';
import type { ShareTarget } from '../sharing/sharing-text';
import { Banner, Button, Note } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { PillButton, Row, Section } from '../ui/rows';
import { usePalette } from '../ui/theme';
import type { Palette } from '../ui/theme';
import { PendingInviteList } from './InviteCards';

type SpaceKeys = Session['opened']['space'];

/** Picks what someone invited to the library, or to one album, will be able to do. */
function AccessPicker({
  value,
  album,
  disabled,
  palette,
  onChange,
}: {
  value: MemberAccess;
  album: ShareTarget['kind'] | null;
  disabled: boolean;
  palette: Palette;
  onChange: (access: MemberAccess) => void;
}) {
  const labels = album ? shareAccessLabels(album) : ACCESS_LABELS;
  return (
    <View style={styles.access} accessibilityRole="radiogroup">
      <Text style={[styles.label, { color: palette.text }]}>What can they do?</Text>
      {(['view', 'edit'] as const).map((access) => {
        const chosen = value === access;
        return (
          <Pressable
            key={access}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen, disabled }}
            disabled={disabled}
            onPress={() => {
              onChange(access);
            }}
            style={[
              styles.option,
              {
                borderColor: chosen ? palette.accent : palette.border,
                backgroundColor: palette.surface,
              },
            ]}
          >
            <View style={[styles.radio, { borderColor: chosen ? palette.accent : palette.muted }]}>
              {chosen ? <View style={[styles.dot, { backgroundColor: palette.accent }]} /> : null}
            </View>
            <View style={styles.optionText}>
              <Text style={[styles.optionTitle, { color: palette.text }]}>
                {labels[access].title}
              </Text>
              <Text style={[styles.small, { color: palette.muted }]}>{labels[access].detail}</Text>
            </View>
          </Pressable>
        );
      })}
      <Text style={[styles.small, { color: palette.muted }]}>
        {album
          ? 'You can change this later on this screen.'
          : 'You can change this later in Settings.'}
      </Text>
    </View>
  );
}

/**
 * The invite for the whole library, or only `album`: a link and a code to send. It stays
 * valid for a week whether or not this screen is open; when they accept, the request to
 * check the words shows over the library, on any of your devices.
 */
function InvitePanel({ album, palette }: { album: ShareTarget | null; palette: Palette }) {
  const { space, onSystemScreen } = useAccount();
  const invites = useInvites();
  const notice = useNotice();
  const { session } = useSessionName();
  const albumId = album?.id ?? null;
  const [current, setCurrent] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [picked, setPicked] = useState<MemberAccess | null>(null);
  const starting = useRef(false);
  const where = spaceName(space);

  const { ready, open, watch } = invites;
  useEffect(() => watch(), [watch]);
  // Shows an invite for this library or album that nobody has accepted yet, or makes one.
  useEffect(() => {
    if (!ready || current !== null || failed !== null || starting.current) return;
    starting.current = true;
    open(albumId).then(
      (invite) => {
        setCurrent(invite.id);
      },
      (error: unknown) => {
        setFailed(errorMessage(error));
      },
    );
  }, [ready, current, failed, open, albumId]);

  const again = () => {
    starting.current = false;
    setFailed(null);
    setCurrent(null);
  };

  const entry = invites.invites.find((each) => each.invite.id === current);
  const finished = invites.finished.find((each) => each.inviteId === current);
  const ended = current !== null && invites.ended.invites.includes(current);

  if (finished) {
    return (
      <View style={styles.panel}>
        <View style={[styles.done, { borderColor: palette.success }]} accessibilityRole="alert">
          <Text style={[styles.body, { color: palette.text }]}>
            {album
              ? `“${album.title}” is shared with ${finished.name}. You can remove them here any time.`
              : `Your ${where} is shared with ${finished.name}. You can change what they can do, or stop sharing, in Settings.`}
          </Text>
        </View>
        <Button kind="secondary" label="Invite someone else" onPress={again} />
      </View>
    );
  }

  if (failed !== null || ended) {
    return (
      <View style={styles.panel}>
        <Banner>{failed ?? 'That invite ended. Nothing was shared.'}</Banner>
        <Button kind="secondary" label="Get a new invite" onPress={again} />
      </View>
    );
  }

  const invite = entry?.invite ?? null;
  const stage = entry?.progress.stage ?? 'waiting';
  const link = invite ? inviteLinkFor(API_ORIGIN, invite.link) : null;

  const send = () => {
    if (!invite || !link) return;
    void onSystemScreen(() =>
      Share.share({ message: inviteMessage(session, link, invite.code) }),
    ).catch(() => undefined);
  };
  const cancel = () => {
    if (!invite || cancelling) return;
    setCancelling(true);
    invites
      .cancel(invite.id)
      .then(
        () => {
          notice('Invite cancelled');
        },
        (error: unknown) => {
          setFailed(errorMessage(error));
        },
      )
      .finally(() => {
        setCancelling(false);
      });
  };
  const changeAccess = (access: MemberAccess) => {
    if (!invite || picked !== null) return;
    setPicked(access);
    invites
      .setAccess(invite.id, access)
      .catch((error: unknown) => {
        setFailed(errorMessage(error));
      })
      .finally(() => {
        setPicked(null);
      });
  };

  return (
    <View style={styles.panel}>
      <AccessPicker
        value={picked ?? invite?.access ?? 'view'}
        album={album?.kind ?? null}
        disabled={!invite || picked !== null}
        palette={palette}
        onChange={changeAccess}
      />
      <View
        style={[styles.invite, { backgroundColor: palette.surface, borderColor: palette.border }]}
      >
        <Text style={[styles.small, { color: palette.muted }]}>Their invite code</Text>
        {invite ? (
          <Text style={[styles.code, { color: palette.text }]} selectable>
            {invite.code}
          </Text>
        ) : (
          <ActivityIndicator color={palette.accent} />
        )}
        <Text style={[styles.small, { color: palette.muted }]}>
          Send it with the invite link. They can accept any time in the next 7 days, at arcafold.com
          or in the app. It works once.
        </Text>
        <Button label="Send invite" busy={!invite} busyLabel="Making an invite…" onPress={send} />
        <Button
          kind="link"
          label={cancelling ? 'Cancelling…' : 'Cancel this invite'}
          onPress={cancel}
        />
      </View>
      <Note>
        {stage === 'waiting'
          ? 'You can leave this screen. The invite stays open.'
          : stage === 'accepted'
            ? 'They accepted. Waiting for them to come back to Arcafold…'
            : 'They’re waiting for you to check the four words.'}
      </Note>
      <Note>
        When they accept, you’ll both see four words. Check they match before you share, so you know
        it’s really them.
      </Note>
      <PendingInviteList album={albumId} exclude={current} />
    </View>
  );
}

/** Your own name, which goes with an invite. */
function useSessionName(): { session: string } {
  const { state } = useAccount();
  return { session: state.status === 'unlocked' ? state.session.account.name : '' };
}

type People = { state: 'loading' } | { state: 'ready'; members: Member[] } | { state: 'failed' };

/**
 * Who an album is shared with: change what someone can do, remove someone, or stop sharing it
 * with everyone.
 */
function AlbumPeople({
  album,
  keys,
  palette,
  onSharedWith,
  onStopSharing,
}: {
  album: ShareTarget;
  keys: SpaceKeys;
  palette: Palette;
  onSharedWith: (names: string[]) => void;
  onStopSharing: () => Promise<void>;
}) {
  const notice = useNotice();
  const [people, setPeople] = useState<People>({ state: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { finished } = useInvites();
  const joinedHere = finished.filter((each) => each.album === album.id).length;

  useEffect(() => {
    let cancelled = false;
    listMembers(keys).then(
      (members) => {
        if (!cancelled) {
          setPeople({ state: 'ready', members: members.filter((m) => m.album === album.id) });
        }
      },
      () => {
        if (!cancelled) setPeople({ state: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
    // Loaded again when someone joins from this screen.
  }, [keys, album.id, joinedHere]);

  const run = (change: () => Promise<Member[]>, done: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    change().then(
      (members) => {
        setBusy(false);
        setPeople({ state: 'ready', members });
        notice(done);
      },
      (caught: unknown) => {
        setBusy(false);
        setError(errorMessage(caught));
      },
    );
  };
  const members = people.state === 'ready' ? people.members : [];

  return (
    <Section title="People with access" palette={palette}>
      {people.state === 'loading' ? (
        <View style={styles.rowPad}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : people.state === 'failed' ? (
        <Row
          title="Couldn’t load who has access"
          detail="Try again in a moment."
          palette={palette}
        />
      ) : members.length === 0 ? (
        <Row title="Only you" palette={palette} />
      ) : (
        members.map((member) => (
          <View key={member.id}>
            <Row
              title={member.name}
              detail={shareAccessLabels(album.kind)[member.access].detail}
              palette={palette}
              action={
                <PillButton
                  label="Remove"
                  accessibilityLabel={`Remove ${member.name}`}
                  danger
                  disabled={busy}
                  palette={palette}
                  onPress={() => {
                    run(async () => {
                      await removeMember(keys, member.id);
                      const left = members.filter((each) => each.id !== member.id);
                      onSharedWith(left.map((each) => each.name));
                      return left;
                    }, `${member.name} can’t see “${album.title}” anymore`);
                  }}
                />
              }
            />
            <View style={styles.accessRow}>
              {(['view', 'edit'] as const).map((access) => (
                <PillButton
                  key={access}
                  label={`${member.access === access ? '✓ ' : ''}${shareAccessLabels(album.kind)[access].title}`}
                  accessibilityLabel={`${member.name}: ${shareAccessLabels(album.kind)[access].title}`}
                  disabled={busy}
                  palette={palette}
                  onPress={() => {
                    if (member.access === access) return;
                    run(
                      async () => {
                        await updateMemberAccess(keys, member.id, access);
                        return members.map((each) =>
                          each.id === member.id ? { ...each, access } : each,
                        );
                      },
                      accessChangedText(member.name, album, access),
                    );
                  }}
                />
              ))}
            </View>
          </View>
        ))
      )}
      {error ? (
        <View style={styles.rowPad}>
          <Banner>{error}</Banner>
        </View>
      ) : null}
      {members.length > 0 ? (
        <View style={styles.rowPad}>
          <Button
            kind="link"
            label="Stop sharing with everyone"
            onPress={() => {
              run(async () => {
                await onStopSharing();
                return [];
              }, `“${album.title}” isn’t shared anymore`);
            }}
          />
        </View>
      ) : null}
    </Section>
  );
}

/**
 * Invite someone to the open space, or to one of its albums. People given an album get it,
 * including photos added later, and nothing else.
 */
export function ShareScreen({
  album,
  keys,
  onSharedWith,
  onStopSharing,
  onClose,
}: {
  /** The album, folder or file to share, or null for the whole library. */
  album: ShareTarget | null;
  keys: SpaceKeys;
  onSharedWith: (albumId: string, names: string[]) => void;
  onStopSharing: (albumId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { space } = useAccount();
  const palette = usePalette();
  const where = spaceName(space);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => {
      back.remove();
    };
  }, [onClose]);

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
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
        <Text
          style={[styles.title, { color: palette.text }]}
          accessibilityRole="header"
          numberOfLines={1}
        >
          {album ? `Share “${album.title}”` : `Share your ${where}`}
        </Text>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 32 + bottomInset() }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.body, { color: palette.muted }]}>
          {album
            ? shareIntro(album.kind)
            : `Invite someone you trust. They’ll see this ${where} and nothing else.`}
        </Text>
        {album ? (
          <AlbumPeople
            album={album}
            keys={keys}
            palette={palette}
            onSharedWith={(names) => {
              onSharedWith(album.id, names);
            }}
            onStopSharing={() => onStopSharing(album.id)}
          />
        ) : null}
        <InvitePanel album={album} palette={palette} />
        {album === null ? (
          <Note>
            {space === 'private'
              ? 'Only this private space is shared. Your main library isn’t.'
              : 'Only this library is shared. Photos in your private space never are; share those from inside it.'}
          </Note>
        ) : null}
      </ScrollView>
    </View>
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
  accessRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  closeText: { fontSize: 22 },
  title: { flex: 1, fontSize: 20, fontWeight: '700' },
  content: { padding: 16, gap: 18 },
  body: { fontSize: 15, lineHeight: 21 },
  panel: { gap: 14 },
  label: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 13, lineHeight: 18 },
  access: { gap: 8 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 15, fontWeight: '600' },
  invite: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 10 },
  code: { fontSize: 26, fontWeight: '800', letterSpacing: 2, textAlign: 'center' },
  done: { borderWidth: 1.5, borderRadius: 14, padding: 14 },
  rowPad: { paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
});
