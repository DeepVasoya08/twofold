import { useEffect, useRef, useState } from 'react';

import type { MemberAccess } from '@twofold/types';

import { useMe } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { usePendingInvites } from '../app/invites';
import { Link, useRouter } from '../app/router';
import { parseShareAlbum, paths } from '../app/routes';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Avatar } from '../components/Brand';
import { FormAlert } from '../components/FormAlert';
import { Icon } from '../components/Icon';
import { PendingInviteList, inviteLink, useCopy } from '../components/Invites';

import './share.css';

/** One album being shared instead of the whole library. */
interface SharedAlbum {
  id: string;
  title: string;
}

/** Keeps a sharing screen checking often for the other side's steps while it's open. */
function useWatchInvites() {
  const { watch } = usePendingInvites();
  useEffect(() => watch(), [watch]);
}

/** What someone can do in a library shared with them, in a few words. */
export const ACCESS_LABELS: Record<MemberAccess, { title: string; detail: string }> = {
  view: { title: 'View only', detail: 'They can see and download photos. Nothing else.' },
  edit: {
    title: 'Add and edit',
    detail: 'They can also add photos, favorite, organize albums and delete photos.',
  },
};

/** Picks what someone invited to the whole library will be able to do. */
function AccessPicker({
  value,
  disabled,
  onChange,
}: {
  value: MemberAccess;
  disabled: boolean;
  onChange: (access: MemberAccess) => void;
}) {
  return (
    <fieldset className="access-picker" disabled={disabled}>
      <legend className="access-picker__legend">What can they do?</legend>
      {(['view', 'edit'] as const).map((access) => (
        <label key={access} className="access-picker__option">
          <input
            type="radio"
            name="invite-access"
            value={access}
            checked={value === access}
            onChange={() => {
              onChange(access);
            }}
          />
          <span className="access-picker__text">
            <span className="access-picker__title">{ACCESS_LABELS[access].title}</span>
            <span className="access-picker__detail">{ACCESS_LABELS[access].detail}</span>
          </span>
        </label>
      ))}
      <span className="access-picker__note">You can change this later in Settings.</span>
    </fieldset>
  );
}

/**
 * The invite for the whole library, or only `album`: a link and a code to send. It stays
 * valid for a week whether or not this screen is open; when they accept, the request to check
 * the words shows up at the top of every screen, on any of your devices.
 */
function InvitePanel({ where, album }: { where: string; album: SharedAlbum | null }) {
  const me = useMe();
  const copy = useCopy();
  const pending = usePendingInvites();
  const albumId = album?.id ?? null;
  const [current, setCurrent] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  // The access just picked, shown at once while it's being kept in the invite's record.
  const [picked, setPicked] = useState<MemberAccess | null>(null);
  const starting = useRef(false);
  useWatchInvites();

  // Shows an invite for this library or album that nobody has accepted yet, or makes one.
  const { ready, invites, open } = pending;
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

  const entry = invites.find((each) => each.invite.id === current);
  const finished = pending.finished.find((each) => each.inviteId === current);
  const ended = current !== null && pending.ended.invites.includes(current);

  if (finished) {
    return (
      <div className="share">
        <div className="share-done" role="status">
          <Icon name="check" size={20} />
          <p>
            {album
              ? `“${album.title}” is shared with ${finished.name}. You can remove them any time from the album’s Share menu.`
              : `Your ${where} is shared with ${finished.name}. You can change what they can do, or stop sharing, any time in Settings.`}
          </p>
        </div>
        <button type="button" className="btn btn--secondary" onClick={again}>
          Invite someone else
        </button>
        <PendingInviteList album={album ? album.id : undefined} />
      </div>
    );
  }

  if (failed !== null || ended) {
    return (
      <div className="share">
        <FormAlert message={failed ?? 'That invite ended. Nothing was shared.'} />
        <button type="button" className="btn btn--secondary" onClick={again}>
          Get a new link
        </button>
        <PendingInviteList album={album ? album.id : undefined} />
      </div>
    );
  }

  const invite = entry?.invite ?? null;
  const stage = entry?.progress.stage ?? 'waiting';
  const link = invite ? inviteLink(invite.link) : null;
  const canShare = typeof navigator.share === 'function';
  const onCancel = () => {
    if (!invite || cancelling) return;
    setCancelling(true);
    pending
      .cancel(invite.id)
      .catch((error: unknown) => {
        setFailed(errorMessage(error));
      })
      .finally(() => {
        setCancelling(false);
      });
  };
  const onAccess = (access: MemberAccess) => {
    if (!invite || picked !== null) return;
    setPicked(access);
    pending
      .setAccess(invite.id, access)
      .catch((error: unknown) => {
        setFailed(errorMessage(error));
      })
      .finally(() => {
        setPicked(null);
      });
  };
  const onShareLink = () => {
    if (!link) return;
    navigator
      .share({ title: 'Twofold invite', text: `${me.name} invited you to Twofold`, url: link })
      .catch(() => undefined);
  };

  return (
    <div className="share">
      {album === null && (
        <AccessPicker
          value={picked ?? invite?.access ?? 'view'}
          disabled={!invite || picked !== null}
          onChange={onAccess}
        />
      )}
      <div className="invite-card">
        <span className="invite-card__label">Invite link</span>
        <span className="invite-card__link" data-testid="invite-link">
          {link ?? 'Making a link…'}
        </span>
        <div className="invite-card__actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!link}
            onClick={() => {
              if (link) copy(link, 'Invite link');
            }}
          >
            <Icon name="link" size={16} /> Copy link
          </button>
          {canShare && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              disabled={!link}
              onClick={onShareLink}
            >
              <Icon name="share" size={16} /> Share link
            </button>
          )}
        </div>
        <span className="invite-card__label">Or they can type this code</span>
        <span className="invite-card__code" data-testid="invite-code">
          {invite?.code ?? 'TWO-····-····'}
        </span>
        <div className="invite-card__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={!invite}
            onClick={() => {
              if (invite) copy(invite.code, 'Invite code');
            }}
          >
            <Icon name="copy" size={16} /> Copy code
          </button>
        </div>
        <span className="invite-card__expiry">
          Send this link. They can accept any time in the next 7 days. It works once.
        </span>
        <button
          type="button"
          className="btn btn--danger-ghost btn--sm"
          disabled={!invite || cancelling}
          onClick={onCancel}
        >
          Cancel this invite
        </button>
      </div>

      <div className="waiting">
        <span className="waiting__avatars">
          <Avatar person={me} />
          <span className="waiting__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="waiting__empty" aria-hidden="true">
            <Icon name="plus" size={18} />
          </span>
        </span>
        <p className="waiting__text">
          {stage === 'waiting'
            ? 'You can leave this screen. The invite stays open.'
            : stage === 'accepted'
              ? 'They accepted. Waiting for them to come back to Twofold…'
              : 'They’re waiting for you to check the words above.'}
        </p>
      </div>

      <p className="share__note">
        <Icon name="shield" size={16} />
        When they accept, you&apos;ll both see four words. Check they match before you share, so you
        know it&apos;s really them.
      </p>

      <PendingInviteList album={album ? album.id : undefined} exclude={current} />
    </div>
  );
}

/**
 * Invite someone to the open space or to one of its albums, or join a library or album
 * someone shared with you.
 */
export function Share() {
  const { space, state: vault, status } = useVault();
  const { search } = useRouter();

  const where = space === 'private' ? 'private space' : 'library';
  const albumId = parseShareAlbum(search);
  if (albumId !== null) {
    const found = vault.albums.find((each) => each.id === albumId && each.library === undefined);
    const album: SharedAlbum | null = found ? { id: found.id, title: found.title } : null;
    return (
      <div className="page page--narrow">
        <PageHeader
          title={
            album
              ? `Share “${album.title}”`
              : status === 'loading'
                ? 'Share album'
                : 'Album not found'
          }
          subtitle={
            album
              ? 'Invite someone you trust. They can view and download this album’s photos, including ones you add later, and nothing else.'
              : status === 'loading'
                ? 'Decrypting your albums…'
                : 'It may have been deleted, or it isn’t yours to share.'
          }
          back={{ to: paths.album(albumId), label: 'Album' }}
        />
        {album && (
          <div className="share-card">
            <InvitePanel where={where} album={album} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page page--narrow">
      <PageHeader
        title={`Share your ${where}`}
        subtitle={`Invite someone you trust. They'll see this ${where} and nothing else.`}
        back={{ to: paths.settings, label: 'Settings' }}
      />

      <div className="share-card">
        <InvitePanel where={where} album={null} />
      </div>
      <p className="share__aside">
        <Icon name="shield" size={16} />
        {space === 'private'
          ? 'Only this private space is shared. Your main library isn’t.'
          : 'Only this library is shared. Photos in your private space never are; share those from inside it.'}
      </p>
      <p className="share__aside">
        Did someone send you a code? <Link to={paths.joinCode}>Enter it here</Link>
      </p>
    </div>
  );
}
