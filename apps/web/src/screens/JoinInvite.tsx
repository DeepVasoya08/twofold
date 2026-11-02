import { useEffect, useState } from 'react';

import { errorMessage } from '../app/account-ops';
import { usePendingInvites } from '../app/invites';
import { paths } from '../app/routes';
import { checkJoin } from '../app/sharing';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { FormAlert } from '../components/FormAlert';
import { Icon } from '../components/Icon';
import { JoinProgressView } from '../components/Invites';

import './share.css';

type Check = { state: 'checking' } | { state: 'open' } | { state: 'failed'; message: string };

/**
 * Someone's invite link, opened once signed in and unlocked. The link only names the invite:
 * who sent it is known only once they reveal their key, after this side accepts. Accepting
 * sends this side's key and can be left at once; the rest happens on later visits.
 */
export function JoinInvite({ token }: { token: string }) {
  const { space } = useVault();
  const pending = usePendingInvites();
  const [check, setCheck] = useState<Check>({ state: 'checking' });
  const [busy, setBusy] = useState(false);
  const where = space === 'private' ? 'private space' : 'library';
  const { watch } = pending;
  useEffect(() => watch(), [watch]);

  const entry = pending.joins.find((each) => each.join.ref === token);
  const mine = pending.invites.some((each) => each.invite.link === token);
  const ended = pending.ended.joins.includes(token);
  const accepted = entry !== undefined;

  useEffect(() => {
    if (!pending.ready || accepted || mine) return;
    let cancelled = false;
    checkJoin(token).then(
      () => {
        if (!cancelled) setCheck({ state: 'open' });
      },
      (error: unknown) => {
        if (!cancelled) setCheck({ state: 'failed', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token, pending.ready, accepted, mine]);

  const onAccept = () => {
    if (busy) return;
    setBusy(true);
    pending
      .accept(token)
      .catch((error: unknown) => {
        setCheck({ state: 'failed', message: errorMessage(error) });
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const body = () => {
    if (entry) return <JoinProgressView entry={entry} where={where} />;
    if (mine) {
      return (
        <p className="share__lead">
          This is your own invite link. Send it to the person you want to share with.
        </p>
      );
    }
    if (ended) return <FormAlert message="That invite ended, so nothing was shared." />;
    if (check.state === 'failed') return <FormAlert message={check.message} />;
    return (
      <div className="share">
        <p className="share__lead">
          Someone invited you to see photos they share on Arcafold. You&apos;ll see who once you
          accept, and you&apos;ll both check four words before anything is shared.
        </p>
        <p className="share__note">
          <Icon name="shield" size={16} />
          What they share will appear in your {where}, and only there. Only accept invites you
          expected.
        </p>
        <button
          type="button"
          className="btn btn--primary btn--block btn--lg"
          disabled={busy || check.state !== 'open'}
          aria-busy={busy || check.state === 'checking'}
          onClick={onAccept}
        >
          {busy ? 'Accepting…' : check.state === 'checking' ? 'Checking the invite…' : 'Accept'}
        </button>
      </div>
    );
  };

  return (
    <div className="page page--narrow">
      <PageHeader
        title="You’re invited"
        subtitle="Invites are end-to-end encrypted, like your photos."
        back={{ to: paths.gallery, label: 'Photos' }}
      />
      <div className="share-card">{body()}</div>
    </div>
  );
}
