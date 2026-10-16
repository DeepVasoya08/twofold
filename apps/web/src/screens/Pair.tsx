import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { AuthLayout } from '../components/AuthLayout';
import { Avatar, CoupleAvatars } from '../components/Brand';
import { TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { me, mockInviteCode, partner } from '../mock/data';

import './pair.css';

/** Normalizes what someone types into the TWO-XXXX-XXXX invite format. */
export function normalizeInviteCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('TWO') ? raw.slice(3) : raw;
  return `TWO-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

export function isInviteCode(code: string): boolean {
  return /^TWO-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
}

type Mode = 'invite' | 'join';

export function Pair() {
  const { navigate } = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('invite');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [paired, setPaired] = useState(false);

  const copy = (text: string, message: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        toast.show(message);
      },
      () => {
        toast.show('Copy failed');
      },
    );
  };

  const onJoin = (event: SubmitEvent) => {
    event.preventDefault();
    if (!isInviteCode(normalizeInviteCode(code))) {
      setError('That code doesn’t look right. It’s 8 letters and numbers after TWO.');
      return;
    }
    setPaired(true);
  };

  if (paired) {
    return (
      <AuthLayout title="You're connected" step={{ current: 3, total: 3 }}>
        <div className="paired">
          <CoupleAvatars a={me} b={partner} size="lg" />
          <p className="paired__text">
            You and {partner.name} now share one vault. Everything either of you adds is encrypted
            for both of you, and no one else.
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block btn--lg"
            onClick={() => {
              navigate(paths.gallery);
            }}
          >
            Open our vault
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Invite your partner"
      subtitle="Twofold is for two. Share your invite, or enter the code your partner sent you."
      step={{ current: 3, total: 3 }}
      footer={
        <Link to={paths.gallery} className="text-link">
          Skip for now
        </Link>
      }
    >
      <div className="segmented" role="tablist" aria-label="Pairing">
        <button
          type="button"
          role="tab"
          id="tab-invite"
          aria-selected={mode === 'invite'}
          aria-controls="panel-invite"
          className="segmented__option"
          onClick={() => {
            setMode('invite');
          }}
        >
          Send an invite
        </button>
        <button
          type="button"
          role="tab"
          id="tab-join"
          aria-selected={mode === 'join'}
          aria-controls="panel-join"
          className="segmented__option"
          onClick={() => {
            setMode('join');
          }}
        >
          I have a code
        </button>
      </div>

      {mode === 'invite' ? (
        <div role="tabpanel" id="panel-invite" aria-labelledby="tab-invite" className="pair">
          <div className="invite-card">
            <span className="invite-card__label">Your invite code</span>
            <span className="invite-card__code">{mockInviteCode}</span>
            <div className="invite-card__actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  copy(mockInviteCode, 'Invite code copied');
                }}
              >
                <Icon name="copy" size={16} /> Copy code
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  copy(`${window.location.origin}/join/${mockInviteCode}`, 'Invite link copied');
                }}
              >
                <Icon name="link" size={16} /> Copy link
              </button>
            </div>
            <span className="invite-card__expiry">Expires in 24 hours</span>
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
            <p className="waiting__text">Waiting for your partner to join…</p>
          </div>

          <p className="pair__note">
            <Icon name="shield" size={16} />
            When they join, you&apos;ll both confirm a short safety phrase so you know it&apos;s
            really them.
          </p>
        </div>
      ) : (
        <form
          role="tabpanel"
          id="panel-join"
          aria-labelledby="tab-join"
          className="form"
          onSubmit={onJoin}
          noValidate
        >
          <TextField
            label="Invite code"
            className="field--code"
            placeholder="TWO-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(event) => {
              setCode(event.currentTarget.value.toUpperCase());
              setError(null);
            }}
            error={error}
          />
          <button type="submit" className="btn btn--primary btn--block btn--lg">
            Join vault
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
