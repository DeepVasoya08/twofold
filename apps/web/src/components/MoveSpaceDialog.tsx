import { useState } from 'react';
import type { SubmitEvent } from 'react';

import type { SpaceKeys } from '@arcafold/crypto';

import { useAccount } from '../app/account';
import type { Space } from '../app/vault';
import { Dialog } from './Dialog';
import { PasswordField } from './Field';

/** "Move to library" from the private space, "Move to private space" from the library. */
export function moveLabel(space: Space): string {
  return space === 'private' ? 'Move to library' : 'Move to private space';
}

/**
 * Asks for the other space's password before the first move out of this one. A space can't
 * reach the other on its own; once opened, the other space's keys stay in memory until
 * Arcafold locks, so later moves go straight through. From the main library, a wrong password
 * gets the same answer as no private space at all.
 */
export function MoveSpaceDialog({
  open,
  space,
  count,
  noun = 'photo',
  busy,
  onClose,
  onUnlocked,
}: {
  open: boolean;
  space: Space;
  /** How many photos are moving. */
  count: number;
  /** What is moving: photos, or files. */
  noun?: 'photo' | 'file';
  /** The move itself is running. */
  busy: boolean;
  onClose: () => void;
  onUnlocked: (keys: SpaceKeys) => void;
}) {
  const { openOtherSpace } = useAccount();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const isPrivate = space === 'private';
  const photos = count === 1 ? `The ${noun}` : `These ${String(count)} ${noun}s`;

  const close = () => {
    setPassword('');
    setError(null);
    onClose();
  };

  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (checking || busy) return;
    setChecking(true);
    void openOtherSpace(password)
      .then(
        (keys) => keys,
        () => null,
      )
      .then((keys) => {
        setChecking(false);
        if (!keys) {
          setError(
            isPrivate
              ? 'That isn’t your main password.'
              : "That password doesn't open a private space. You can set one up in Settings.",
          );
          return;
        }
        setPassword('');
        onUnlocked(keys);
      });
  };

  const working = checking || busy;
  return (
    <Dialog
      open={open}
      onClose={close}
      title={moveLabel(space)}
      description={
        isPrivate
          ? `Enter your main password. ${photos} will leave your private space and appear in your library. You won't be asked again until Arcafold locks.`
          : `Enter your private password. ${photos} will leave your library and only appear when you open Arcafold with that password. You won't be asked again until Arcafold locks.`
      }
    >
      <form className="form" onSubmit={onSubmit} noValidate>
        <PasswordField
          label={isPrivate ? 'Main password' : 'Private password'}
          neverSave
          value={password}
          onChange={(event) => {
            setPassword(event.currentTarget.value);
            setError(null);
          }}
          error={error}
        />
        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={working} aria-busy={working}>
            {working ? 'Moving…' : 'Move'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
