import { useEffect, useState } from 'react';

import { useAccount } from '../app/account';
import { Link } from '../app/router';
import { paths } from '../app/routes';
import { listMembers, removeMember, updateMemberAccess } from '@arcafold/core/sharing';
import type { Member } from '@arcafold/core/sharing';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { PendingInviteList } from './Invites';
import { errorMessage } from '@arcafold/core/errors';
import type { Album, Folder } from '@arcafold/core/library/model';
import type { MemberAccess } from '@arcafold/types';

import './album-share-dialog.css';

type People = { state: 'loading' } | { state: 'ready'; members: Member[] } | { state: 'failed' };

/** An album, a folder or a file of yours that is being shared, by what the dialog needs. */
interface Shared {
  id: string;
  title: string;
  kind: 'album' | 'folder' | 'file';
}

/**
 * Who one of your albums (or folders) is shared with: invite someone, change what they can do
 * there, remove someone, or stop sharing it with everyone. People get only that album or
 * folder.
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
      <AlbumPeople album={{ id: album.id, title: album.title, kind: 'album' }} />
    </Dialog>
  );
}

/** The same dialog for a folder in Files: people get the folder and every folder inside it. */
export function FolderShareDialog({
  open,
  folder,
  onClose,
}: {
  open: boolean;
  folder: Folder;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={`Share “${folder.name}”`}>
      <AlbumPeople album={{ id: folder.id, title: folder.name, kind: 'folder' }} />
    </Dialog>
  );
}

/** The same dialog for one file shared on its own (`shareId`: what it is shared under). */
export function FileShareDialog({
  open,
  shareId,
  name,
  onClose,
}: {
  open: boolean;
  shareId: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={`Share “${name}”`}>
      <AlbumPeople album={{ id: shareId, title: name, kind: 'file' }} />
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so it loads who has access each time it opens. */
function AlbumPeople({ album }: { album: Shared }) {
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

  const onAccess = (member: Member, access: MemberAccess) => {
    if (!keys || busy || access === member.access) return;
    setBusy(true);
    updateMemberAccess(keys, member.id, access)
      .then(
        () => {
          const members = people.state === 'ready' ? people.members : [];
          setPeople({
            state: 'ready',
            members: members.map((each) => (each.id === member.id ? { ...each, access } : each)),
          });
          toast.show(
            access === 'edit'
              ? `${member.name} can ${album.kind === 'file' ? 'edit' : 'add to'} “${album.title}” now`
              : `${member.name} can only view “${album.title}” now`,
          );
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
        {album.kind === 'file'
          ? `Invite someone to this file. They get just this file, and nothing else in your ${where}. With Can edit, they can also rename it and upload a new version.`
          : album.kind === 'folder'
            ? `Invite someone to this folder. They get its files and the folders inside it, including what you add later, and nothing else in your ${where}. With Add and edit, they can also add, rename, move and delete what’s inside it.`
            : `Invite someone to this album. They get its photos, including ones you add later, and nothing else in your ${where}. With Add and edit, they can also add photos and take any photo out of it.`}
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
                <select
                  className="select"
                  aria-label={`What ${member.name} can do`}
                  value={member.access}
                  disabled={busy}
                  onChange={(event) => {
                    onAccess(member, event.currentTarget.value === 'edit' ? 'edit' : 'view');
                  }}
                >
                  <option value="view">View only</option>
                  <option value="edit">
                    {album.kind === 'file' ? 'Can edit' : 'Add and edit'}
                  </option>
                </select>
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

      <PendingInviteList album={album.id} />

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
