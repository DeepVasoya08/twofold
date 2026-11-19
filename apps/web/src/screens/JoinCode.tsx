import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';

import { usePendingInvites } from '../app/invites';
import { paths } from '../app/routes';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { TextField } from '../components/Field';
import { FormAlert } from '../components/FormAlert';
import { Icon } from '../components/Icon';
import { JoinProgressView } from '../components/Invites';
import { errorMessage } from '@arcafold/core/errors';
import {
  NOT_AN_INVITE,
  isInviteCode,
  normalizeInviteCode,
  parseInviteInput,
} from '@arcafold/core/invite-input';

import './share.css';

export { isInviteCode, normalizeInviteCode, parseInviteInput };

/**
 * Where an invite code someone sent is typed in (or their invite link pasted). Accepting sends
 * this side's key and can be left at once; who invited you shows up once they're back, and
 * you both check four words before anything is shared.
 */
export function JoinCode() {
  const { space } = useVault();
  const pending = usePendingInvites();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const where = space === 'private' ? 'private space' : 'library';
  const { watch } = pending;
  useEffect(() => watch(), [watch]);

  const entry = pending.joins.find((each) => each.join.ref === joined);
  const ended = joined !== null && pending.ended.joins.includes(joined);

  const onJoin = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy) return;
    const ref = parseInviteInput(input);
    if (ref === null) {
      setError(NOT_AN_INVITE);
      return;
    }
    if (pending.invites.some((each) => each.invite.code === ref || each.invite.link === ref)) {
      setError('That’s your own invite. Send it to the person you want to share with.');
      return;
    }
    setBusy(true);
    pending
      .accept(ref)
      .then(
        () => {
          setJoined(ref);
        },
        (caught: unknown) => {
          setError(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div className="page page--narrow">
      <PageHeader
        title="Enter an invite code"
        subtitle="Type the code someone sent you, or paste their invite link."
        back={{ to: paths.settings, label: 'Settings' }}
      />
      <div className="share-card">
        {entry ? (
          <JoinProgressView entry={entry} where={where} />
        ) : (
          <form className="form" onSubmit={onJoin} noValidate>
            <FormAlert message={ended ? 'That invite ended, so nothing was shared.' : null} />
            <TextField
              label="Invite code"
              className="field--code"
              placeholder="TWO-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              value={input}
              onChange={(event) => {
                setInput(event.currentTarget.value);
                setError(null);
              }}
              error={error}
            />
            <p className="share__note">
              <Icon name="shield" size={16} />
              What they share will appear in your {where}, and only there. You&apos;ll both check
              four words before anything is shared.
            </p>
            <button
              type="submit"
              className="btn btn--primary btn--block btn--lg"
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? 'Joining…' : 'Join'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
