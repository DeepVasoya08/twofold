import { useState } from 'react';

import { usePendingInvites } from '../app/invites';
import type { InviteEntry, JoinEntry } from '../app/invites';
import { useRouter } from '../app/router';
import { matchRoute, paths } from '../app/routes';
import { useToast } from '../app/toast';
import { foldersOf, useVault } from '../app/vault';
import { Icon } from './Icon';
import { errorMessage } from '@arcafold/core/errors';

import '../screens/share.css';

/** The four safety words both people compare. */
export function Phrase({ words }: { words: string[] }) {
  return (
    <ol className="phrase" aria-label="Safety phrase">
      {words.map((word, index) => (
        <li key={`${String(index)}-${word}`}>{word}</li>
      ))}
    </ol>
  );
}

/** The full link for an invite: it names the invite and carries no key. */
export function inviteLink(token: string): string {
  return `${window.location.origin}${paths.join(token)}`;
}

/** Copies `text`, saying so (or that it didn't work). */
export function useCopy(): (text: string, what: string) => void {
  const toast = useToast();
  return (text, what) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        toast.show(`${what} copied`);
      },
      () => {
        toast.show('Copy failed');
      },
    );
  };
}

/** What an invite shares, as the inviter reads it: "your library", or an album or folder. */
function useTarget(): (album: string | null) => string {
  const { space, state } = useVault();
  const where = space === 'private' ? 'private space' : 'library';
  return (album) => {
    if (album === null) return `your ${where}`;
    const found = state.albums.find((each) => each.id === album && each.library === undefined);
    if (found) return `“${found.title}”`;
    const folder = foldersOf(state).find((each) => each.id === album && each.library === undefined);
    if (folder) return `“${folder.name}”`;
    const file = (state.files ?? []).find(
      (each) => each.shareId === album && each.library === undefined,
    );
    return file?.file ? `“${file.file.name}”` : 'an album';
  };
}

/**
 * Someone accepted an invite and is waiting: their name, the four words to check with them,
 * and Confirm or Cancel. Shown on every screen of the space the invite was made from, so it
 * doesn't matter when (or on which device) the inviter comes back.
 */
function InviteRequest({ entry }: { entry: InviteEntry }) {
  const pending = usePendingInvites();
  const toast = useToast();
  const target = useTarget();
  const [busy, setBusy] = useState(false);
  if (entry.progress.stage !== 'confirm') return null;
  const { name, phrase } = entry.progress;
  const id = entry.invite.id;

  const run = (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    action()
      .catch((error: unknown) => {
        toast.show(errorMessage(error));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="invite-request" aria-label={`Invite request from ${name}`}>
      <p className="share__lead">
        <strong>{name}</strong> wants to join {target(entry.invite.album)}. Check these 4 words with
        them:
      </p>
      <Phrase words={phrase} />
      <p className="share__note">
        <Icon name="shield" size={16} />
        If the words don&apos;t match, cancel. Someone else may have your link or code.
      </p>
      <div className="share__actions">
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy}
          onClick={() => {
            run(async () => {
              await pending.cancel(id);
              toast.show('Invite cancelled');
            });
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            run(() => pending.confirm(id));
          }}
        >
          {busy ? 'Sharing…' : 'They match, share'}
        </button>
      </div>
    </section>
  );
}

/** Someone's invite this space accepted, waiting for them to confirm the words. */
function JoinNotice({ entry }: { entry: JoinEntry }) {
  if (entry.progress.stage !== 'check') return null;
  const { name, phrase } = entry.progress;
  return (
    <section className="invite-request" aria-label={`Invite from ${name}`}>
      <p className="share__lead">
        Waiting for <strong>{name}</strong> to confirm. Check they see these same four words:
      </p>
      <Phrase words={phrase} />
    </section>
  );
}

/**
 * Invites that need a look, at the top of every screen: someone waiting for your
 * confirmation, and invites you accepted that are waiting for theirs. On the sharing
 * screens, those screens show your accepted invites themselves.
 */
export function InviteRequests() {
  const { invites, joins } = usePendingInvites();
  const { pathname } = useRouter();
  const route = matchRoute(pathname).name;
  const showJoins = route !== 'share' && route !== 'join' && route !== 'join-code';
  const asking = invites.filter((entry) => entry.progress.stage === 'confirm');
  const waiting = showJoins ? joins.filter((entry) => entry.progress.stage === 'check') : [];
  if (asking.length === 0 && waiting.length === 0) return null;
  return (
    <div className="invite-requests">
      {asking.map((entry) => (
        <InviteRequest key={entry.invite.id} entry={entry} />
      ))}
      {waiting.map((entry) => (
        <JoinNotice key={entry.join.id} entry={entry} />
      ))}
    </div>
  );
}

function statusOf(entry: InviteEntry): string {
  switch (entry.progress.stage) {
    case 'waiting':
      return 'Not accepted yet';
    case 'accepted':
      return 'Accepted, waiting for them';
    case 'confirm':
      return `${entry.progress.name} is waiting for you to check the words`;
    case 'gone':
      return 'Ended';
  }
}

/** Expires on: the date only, in the reader's own format. */
function expiry(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Invites still waiting, with Copy link and Cancel: all of the space's (`album` undefined),
 * or one album's. `exclude` leaves out the one already shown on the screen.
 */
export function PendingInviteList({
  album,
  exclude,
}: {
  album?: string | null | undefined;
  exclude?: string | null | undefined;
}) {
  const pending = usePendingInvites();
  const toast = useToast();
  const copy = useCopy();
  const target = useTarget();
  const [busy, setBusy] = useState<string | null>(null);
  const shown = pending.invites.filter(
    (entry) => entry.invite.id !== exclude && (album === undefined || entry.invite.album === album),
  );
  if (shown.length === 0) return null;

  const onCancel = (id: string) => {
    if (busy) return;
    setBusy(id);
    pending
      .cancel(id)
      .then(
        () => {
          toast.show('Invite cancelled');
        },
        (error: unknown) => {
          toast.show(errorMessage(error));
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <section className="pending-invites" aria-label="Invites waiting">
      <h3 className="pending-invites__title">Invites waiting</h3>
      <ul className="pending-invites__list">
        {shown.map((entry) => {
          const { invite } = entry;
          return (
            <li key={invite.id} className="pending-invites__item">
              <span className="pending-invites__text">
                <span className="pending-invites__code">{invite.code}</span>
                <span className="pending-invites__status">
                  {album === undefined ? `${target(invite.album)} · ` : ''}
                  {statusOf(entry)} · until {expiry(invite.expiresAt)}
                </span>
              </span>
              <span className="pending-invites__actions">
                {entry.progress.stage === 'waiting' && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    aria-label={`Copy link for invite ${invite.code}`}
                    onClick={() => {
                      copy(inviteLink(invite.link), 'Invite link');
                    }}
                  >
                    <Icon name="link" size={16} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--danger-ghost btn--sm"
                  disabled={busy !== null}
                  aria-label={`Cancel invite ${invite.code}`}
                  onClick={() => {
                    onCancel(invite.id);
                  }}
                >
                  Cancel
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Where an invite this space accepted is up to: waiting for the inviter to come back, or for
 * them to confirm the words. Either way, this page can be closed: the next visit picks up.
 */
export function JoinProgressView({ entry, where }: { entry: JoinEntry; where: string }) {
  const { progress } = entry;
  const { leave } = usePendingInvites();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const onLeave = () => {
    if (busy) return;
    setBusy(true);
    leave(entry.join.id)
      .then(
        () => {
          toast.show('You didn’t join');
        },
        (error: unknown) => {
          toast.show(errorMessage(error));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <div className="share" role="status">
      {progress.stage === 'check' ? (
        <>
          <p className="share__lead">
            <strong>{progress.name}</strong> invited you. Check they see these same four words:
          </p>
          <Phrase words={progress.phrase} />
          <p className="waiting__text">Waiting for {progress.name} to confirm…</p>
        </>
      ) : (
        <p className="waiting__text">Accepted. Waiting for the person who invited you…</p>
      )}
      <p className="share__note">
        <Icon name="shield" size={16} />
        You can leave this page. What they share will appear in your {where} the next time you open
        it, and only there.
      </p>
      <div className="share__actions">
        <button type="button" className="btn btn--ghost" disabled={busy} onClick={onLeave}>
          Don’t join
        </button>
      </div>
    </div>
  );
}
