import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';

import type { Session } from '@arcafold/core/account';
import { errorMessage } from '@arcafold/core/errors';
import {
  leaveLibrary,
  listMembers,
  listStillJoined,
  removeMember,
  updateMemberAccess,
} from '@arcafold/core/sharing';
import type { JoinedLibrary, Member } from '@arcafold/core/sharing';
import type { MemberAccess } from '@arcafold/types';

import { useAccount } from '../session/account';
import { useInvites } from '../sharing/invites';
import { ACCESS_LABELS, sharedWithLine, spaceName } from '../sharing/sharing-text';
import { Banner, Button } from '../ui/kit';
import { useNotice } from '../ui/notice';
import { PillButton, Row, rowStyles } from '../ui/rows';
import type { Palette } from '../ui/theme';

type SpaceKeys = Session['opened']['space'];

interface Lists {
  members: Member[];
  joined: (JoinedLibrary & { access: MemberAccess })[];
}

/** A change waiting for a yes: stop sharing with someone, or leave a library. */
type Change = { kind: 'stop'; member: Member } | { kind: 'leave'; library: JoinedLibrary };

/** What you can do in a library someone shared with you. */
const JOINED_ACCESS: Record<MemberAccess, string> = {
  view: 'You can view and download its photos.',
  edit: 'You can view, add and change its photos.',
};

/** Who the whole open space is shared with, and the libraries it joined. Null until loaded. */
function useSharingLists(keys: SpaceKeys) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const { finished } = useInvites();
  useEffect(() => {
    let cancelled = false;
    // Libraries whose owner stopped sharing them drop out (and are forgotten) here.
    Promise.all([listMembers(keys), listStillJoined(keys)]).then(
      ([members, joined]) => {
        if (cancelled) return;
        setFailed(false);
        setLists({
          members: members.filter((member) => member.album === null),
          // Albums shared one at a time are managed from the album, not here.
          joined: joined.filter((library) => library.album === undefined),
        });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [keys, version, finished.length]);
  const reload = useCallback(() => {
    setVersion((current) => current + 1);
  }, []);
  // The other side may have stopped sharing or left meanwhile.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') reload();
    });
    return () => {
      subscription.remove();
    };
  }, [reload]);
  return { lists, failed, reload };
}

/**
 * Settings > Sharing: share the open space, enter a code someone sent, who it's shared with
 * (what each may do, or stop sharing), and the libraries it joined (leave one).
 */
export function SharingSettings({
  keys,
  palette,
  onShare,
  onJoin,
  onLeft,
}: {
  keys: SpaceKeys;
  palette: Palette;
  onShare: () => void;
  onJoin: () => void;
  /** A library was left, so the open one should load again without it. */
  onLeft: () => void;
}) {
  const { space } = useAccount();
  const notice = useNotice();
  const { lists, failed, reload } = useSharingLists(keys);
  const [busy, setBusy] = useState<string | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [error, setError] = useState<string | null>(null);
  const where = spaceName(space);

  const setAccess = (member: Member, access: MemberAccess) => {
    if (busy || member.access === access) return;
    setBusy(member.id);
    setError(null);
    updateMemberAccess(keys, member.id, access)
      .then(
        () => {
          notice(`${member.name}: ${ACCESS_LABELS[access].title}`);
          reload();
        },
        (caught: unknown) => {
          setError(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  const confirmChange = () => {
    if (!change || busy) return;
    setBusy('change');
    setError(null);
    const run =
      change.kind === 'stop'
        ? removeMember(keys, change.member.id)
        : leaveLibrary(keys, change.library);
    run
      .then(
        () => {
          notice(
            change.kind === 'stop'
              ? `Stopped sharing with ${change.member.name}`
              : `You left ${change.library.name}’s library`,
          );
          if (change.kind === 'leave') onLeft();
          setChange(null);
          reload();
        },
        (caught: unknown) => {
          setChange(null);
          setError(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <>
      <Row
        title={`Share your ${where}`}
        detail={lists ? sharedWithLine(lists.members) : 'Invite someone you trust.'}
        palette={palette}
        action={<PillButton label="Invite" palette={palette} onPress={onShare} />}
      />
      <Row
        title="Enter an invite code"
        detail="Someone sent you a code or link."
        palette={palette}
        action={<PillButton label="Enter" palette={palette} onPress={onJoin} />}
      />
      {!lists ? (
        failed ? (
          <Row
            title="Sharing couldn’t be loaded"
            detail="Check your connection."
            palette={palette}
          />
        ) : (
          <View style={rowStyles.row}>
            <ActivityIndicator color={palette.accent} />
          </View>
        )
      ) : null}
      {lists?.members.map((member) => (
        <View key={member.id} style={rowStyles.rowPad}>
          <Row
            title={member.name}
            detail={ACCESS_LABELS[member.access].detail}
            palette={palette}
            action={
              <PillButton
                label="Stop"
                accessibilityLabel={`Stop sharing with ${member.name}`}
                danger
                disabled={busy !== null}
                palette={palette}
                onPress={() => {
                  setChange({ kind: 'stop', member });
                }}
              />
            }
          />
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
            {(['view', 'edit'] as const).map((access) => (
              <PillButton
                key={access}
                label={`${member.access === access ? '✓ ' : ''}${ACCESS_LABELS[access].title}`}
                accessibilityLabel={`${member.name}: ${ACCESS_LABELS[access].title}`}
                disabled={busy !== null}
                palette={palette}
                onPress={() => {
                  setAccess(member, access);
                }}
              />
            ))}
          </View>
        </View>
      ))}
      {lists?.joined.map((library) => (
        <Row
          key={library.id}
          title={`${library.name}’s library`}
          detail={JOINED_ACCESS[library.access]}
          palette={palette}
          action={
            <PillButton
              label="Leave"
              accessibilityLabel={`Leave ${library.name}’s library`}
              danger
              disabled={busy !== null}
              palette={palette}
              onPress={() => {
                setChange({ kind: 'leave', library });
              }}
            />
          }
        />
      ))}
      {error ? (
        <View style={rowStyles.rowPad}>
          <Banner>{error}</Banner>
        </View>
      ) : null}
      {change ? (
        // Asked inline: a sheet can't sit over Settings from inside its scrolling list.
        <View style={rowStyles.rowPad} accessibilityLiveRegion="polite">
          <Row
            title={
              change.kind === 'stop'
                ? `Stop sharing with ${change.member.name}?`
                : `Leave ${change.library.name}’s library?`
            }
            detail={
              change.kind === 'stop'
                ? `${change.member.name} won’t see your ${where} anymore, from any device.`
                : 'Its photos leave this phone and your other devices. You’d need a new invite to join again.'
            }
            palette={palette}
          />
          <Button
            label={change.kind === 'stop' ? 'Stop sharing' : 'Leave'}
            busy={busy === 'change'}
            onPress={confirmChange}
          />
          <Button
            kind="link"
            label="Cancel"
            onPress={() => {
              if (busy !== 'change') setChange(null);
            }}
          />
        </View>
      ) : null}
    </>
  );
}
