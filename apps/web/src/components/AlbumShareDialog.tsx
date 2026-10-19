import { useEffect, useState } from 'react';

import { useAccount } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { Link } from '../app/router';
import { paths } from '../app/routes';
import { listMembers, removeMember } from '../app/sharing';
import type { Member } from '../app/sharing';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import type { Album } from '../mock/data';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

import './album-share-dialog.css';

type People = { state: 'loading' } | { state: 'ready'; members: Member[] } | { state: 'failed' };

/**
 * Who one of your albums is shared with: invite someone, remove someone, or stop sharing it
 * with everyone. People get only this album, to view and download.
 */
export function AlbumShareDialog({
  open,
  album,
  onClose,
}: {
  open: boolean;
  album: Album;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={`Share “${album.title}”`}>
      <AlbumPeople album={album} />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so it loads who has access each time it opens. */
function AlbumPeople({ album }: { album: Album }) {
  const { state } = useAccount();
  const { space, setSharedWith, stopSharingAlbum } = useVault();
  const toast = useToast();
  const keys = state.status === 'unlocked' ? state.session.opened.space : null;
  const [people, setPeople] = useState<People>({ state: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!keys) return;
    let cancelled = false;
    listMembers(keys).then(
      (members) => {
        if (cancelled) return;
        setPeople({
          state: 'ready',
          members: members.filter((member) => member.album === album.id),
        });
      },
      () => {
        if (!cancelled) setPeople({ state: 'failed' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [keys, album.id]);

  const remaining = (gone: (member: Member) => boolean) =>
    people.state === 'ready' ? people.members.filter((member) => !gone(member)) : [];

  const onRemove = (member: Member) => {
    if (!keys || busy) return;
    setBusy(true);
    removeMember(keys, member.id)
      .then(
        () => {
          const members = remaining((each) => each.id === member.id);
          setPeople({ state: 'ready', members });
          setSharedWith(
            album.id,
            members.map((each) => each.name),
          );
          toast.show(`${member.name} can’t see “${album.title}” anymore`);
        },
        (error: unknown) => {
          toast.show(errorMessage(error));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  const onStop = () => {
    if (busy) return;
    setBusy(true);
    stopSharingAlbum(album.id)
      .then(
        () => {
          setPeople({ state: 'ready', members: [] });
          toast.show(`“${album.title}” isn’t shared anymore`);
        },
        (error: unknown) => {
          toast.show(errorMessage(error));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  const where = space === 'private' ? 'private space' : 'library';
  const members = people.state === 'ready' ? people.members : [];
  return (
    <div className="album-share">
      <p className="album-share__note">
        Invite someone to this album. They can view and download its photos, including ones you add
        later, and nothing else in your {where}.
      </p>

      <section aria-label="People with access">
        <h3 className="album-share__title">People with access</h3>
        {people.state === 'loading' && <p className="album-share__note">Loading…</p>}
        {people.state === 'failed' && (
          <p className="album-share__note" role="alert">
            Couldn’t load who has access. Try again in a moment.
          </p>
        )}
        {people.state === 'ready' && members.length === 0 && (
          <p className="album-share__note">Only you.</p>
        )}
        {members.length > 0 && (
          <ul className="album-share__people">
            {members.map((member) => (
              <li key={member.id} className="album-share__person">
                <Icon name="users" size={18} />
                <span className="album-share__name">{member.name}</span>
                <button
                  type="button"
                  className="btn btn--danger-ghost btn--sm"
                  disabled={busy}
                  aria-label={`Remove ${member.name}`}
                  onClick={() => {
                    onRemove(member);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link to={paths.shareAlbum(album.id)} className="btn btn--primary btn--block">
        <Icon name="plus" size={18} />
        Invite someone
      </Link>
      {members.length > 0 && (
        <button
          type="button"
          className="btn btn--danger-ghost btn--block"
          disabled={busy}
          aria-busy={busy}
          onClick={onStop}
        >
          Stop sharing with everyone
        </button>
      )}
    </div>
  );
}
