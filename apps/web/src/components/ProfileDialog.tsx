import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import { useAccount, useMe } from '../app/account';
import { errorMessage } from '../app/account-ops';
import { useProfile } from '../app/profile';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PHOTO_TYPES } from '../lib/photo-types';
import { Avatar } from './Brand';
import { Dialog } from './Dialog';
import { TextField } from './Field';
import { FormAlert } from './FormAlert';

/** Matches the server's limit on names. */
export const MAX_NAME_LENGTH = 60;

/** The photo as it will be saved: unchanged, a newly chosen file, or none. */
type PhotoChoice = { kind: 'keep' } | { kind: 'new'; file: File; url: string } | { kind: 'remove' };

/** Edits the account's name and the open space's profile photo. */
export function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Edit profile">
      {/* Mounted per opening, so each one starts from what's saved. */}
      {open && <ProfileForm onClose={onClose} />}
    </Dialog>
  );
}

function ProfileForm({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const account = useAccount();
  const profile = useProfile();
  const toast = useToast();
  const { space } = useVault();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(me.name);
  const [choice, setChoice] = useState<PhotoChoice>({ kind: 'keep' });
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The preview of a chosen file lives only while it's chosen.
  useEffect(() => {
    if (choice.kind !== 'new') return;
    return () => {
      URL.revokeObjectURL(choice.url);
    };
  }, [choice]);

  const preview =
    choice.kind === 'new' ? choice.url : choice.kind === 'remove' ? null : profile.photo;

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Enter your name.');
      return;
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setNameError(`Use at most ${String(MAX_NAME_LENGTH)} characters.`);
      return;
    }
    setBusy(true);
    const save = async () => {
      if (trimmed !== me.name) await account.changeName(trimmed);
      if (choice.kind === 'new') await profile.setPhoto(choice.file);
      if (choice.kind === 'remove') await profile.setPhoto(null);
    };
    void save()
      .then(
        () => {
          onClose();
          toast.show('Profile saved');
        },
        (failure: unknown) => {
          setError(errorMessage(failure));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="profile-editor">
        <Avatar person={{ ...me, name: name.trim() || me.name }} size="lg" src={preview} />
        <div className="profile-editor__actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => inputRef.current?.click()}
          >
            {preview ? 'Change photo' : 'Add photo'}
          </button>
          {preview && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setChoice({ kind: 'remove' });
              }}
            >
              Remove photo
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept={PHOTO_TYPES.join(',')}
          tabIndex={-1}
          aria-label="Choose a profile photo"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) setChoice({ kind: 'new', file, url: URL.createObjectURL(file) });
          }}
        />
      </div>
      <p className="profile-editor__note">
        {space === 'private'
          ? 'Your photo is encrypted on this device. Only this private space shows it.'
          : 'Your photo is encrypted on this device, like your other photos.'}
      </p>
      <TextField
        label="Name"
        autoComplete="name"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(event) => {
          setName(event.currentTarget.value);
          setNameError(null);
        }}
        error={nameError}
      />
      <FormAlert message={error} />
      <div className="dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
