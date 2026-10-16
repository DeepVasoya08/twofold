import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { Link } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Avatar, AvatarPair } from '../components/Brand';
import { TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { contact, me, mockInviteCode } from '../mock/data';

import './share.css';

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

/** Invite someone to the open space, or join a library someone shared with you. */
export function Share() {
  const toast = useToast();
  const { space } = useVault();
  const [mode, setMode] = useState<Mode>('invite');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const where = space === 'private' ? 'private space' : 'library';

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
    setJoined(true);
  };

  return (
    <div className="page page--narrow">
      <PageHeader
        title={`Share your ${where}`}
        subtitle={`Invite someone you trust. They'll see this ${where} and nothing else.`}
        back={{ to: paths.settings, label: 'Settings' }}
      />

      {joined ? (
        <div className="share-card joined">
          <AvatarPair a={me} b={contact} size="lg" />
          <p className="joined__title">You joined {contact.name}&apos;s library</p>
          <p className="joined__text">
            Their shared photos are encrypted for you too, and appear in your library.
          </p>
          <Link to={paths.gallery} className="btn btn--primary">
            See photos
          </Link>
        </div>
      ) : (
        <div className="share-card">
          <div className="segmented" role="tablist" aria-label="Sharing">
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
            <div role="tabpanel" id="panel-invite" aria-labelledby="tab-invite" className="share">
              <div className="invite-card">
                <span className="invite-card__label">Invite code</span>
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
                      copy(
                        `${window.location.origin}/join/${mockInviteCode}`,
                        'Invite link copied',
                      );
                    }}
                  >
                    <Icon name="link" size={16} /> Copy link
                  </button>
                </div>
                <span className="invite-card__expiry">Works once. Expires in 24 hours.</span>
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
                <p className="waiting__text">Waiting for them to accept…</p>
              </div>

              <p className="share__note">
                <Icon name="shield" size={16} />
                When they accept, you&apos;ll both see a short safety phrase. Check it matches so
                you know it&apos;s really them.
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
                Join
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
