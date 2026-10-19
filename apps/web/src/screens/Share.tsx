import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';

import type { SpaceKeys } from '@twofold/crypto';

import { useAccount, useMe } from '../app/account';
import { FormError, errorMessage } from '../app/account-ops';
import { useRouter } from '../app/router';
import { parseShareAlbum, paths } from '../app/routes';
import {
  POLL_MS,
  abandonJoin,
  advanceInvite,
  advanceJoin,
  cancelInvite,
  confirmInvite,
  finishJoin,
  startInvite,
  startJoin,
} from '../app/sharing';
import type { Invite, Join } from '../app/sharing';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Avatar } from '../components/Brand';
import { TextField } from '../components/Field';
import { FormAlert } from '../components/FormAlert';
import { Icon } from '../components/Icon';
import { ApiError } from '../lib/api';

import './share.css';

/** Normalizes what someone types into the TWO-XXXX-XXXX invite format. */
export function normalizeInviteCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('TWO') ? raw.slice(3) : raw;
  return `TWO-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

/** Codes never use 0, 1, I or O, so they can't be misread. */
export function isInviteCode(code: string): boolean {
  return /^TWO-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(code);
}

type Mode = 'invite' | 'join';

/** True for errors that end an invite, as opposed to a dropped connection worth retrying. */
function isFinal(error: unknown): boolean {
  return error instanceof FormError || (error instanceof ApiError && error.status !== 0);
}

/**
 * Calls `step` every POLL_MS while `active`, one call at a time, until it returns true.
 * Errors go to `onError`; the polling stops if that returns true.
 */
function usePoll(
  active: boolean,
  step: () => Promise<boolean>,
  onError: (error: unknown) => boolean,
) {
  const latest = useRef({ step, onError });
  useEffect(() => {
    latest.current = { step, onError };
  });
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let running = false;
    const tick = () => {
      if (running || stopped) return;
      running = true;
      latest.current.step().then(
        (done) => {
          running = false;
          if (done) stopped = true;
        },
        (error: unknown) => {
          running = false;
          if (latest.current.onError(error)) stopped = true;
        },
      );
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);
}

function Phrase({ words }: { words: string[] }) {
  return (
    <ol className="phrase" aria-label="Safety phrase">
      {words.map((word, index) => (
        <li key={`${String(index)}-${word}`}>{word}</li>
      ))}
    </ol>
  );
}

type InviteState =
  | { status: 'starting' }
  | { status: 'waiting'; invite: Invite }
  | { status: 'confirm'; invite: Invite; name: string; phrase: string[]; joinerKey: string }
  | { status: 'done'; name: string }
  | { status: 'failed'; message: string };

/** One album being shared instead of the whole library. */
interface SharedAlbum {
  id: string;
  title: string;
  sharedWith: string[];
}

/**
 * Makes a code, waits for someone to use it, and shares once the safety phrases match: the
 * whole library, or only `album`.
 */
function InvitePanel({
  keys,
  where,
  album,
}: {
  keys: SpaceKeys | null;
  where: string;
  album: SharedAlbum | null;
}) {
  const toast = useToast();
  const me = useMe();
  const { shareAlbum, setSharedWith } = useVault();
  const [state, setState] = useState<InviteState>({ status: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const shared = useRef(false);

  useEffect(() => {
    if (!keys) return;
    let cancelled = false;
    let started: Invite | null = null;
    startInvite().then(
      (invite) => {
        started = invite;
        if (cancelled) void cancelInvite(invite);
        else setState({ status: 'waiting', invite });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'failed', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
      // Leaving the screen (or asking for a new code) ends the invite.
      if (started && !shared.current) void cancelInvite(started);
    };
  }, [keys, attempt]);

  usePoll(
    state.status === 'waiting',
    async () => {
      if (state.status !== 'waiting') return true;
      const progress = await advanceInvite(state.invite);
      if (progress.stage === 'waiting') return false;
      setState({ status: 'confirm', invite: state.invite, ...progress });
      return true;
    },
    (error) => {
      if (!isFinal(error)) return false;
      setState({ status: 'failed', message: errorMessage(error) });
      return true;
    },
  );

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        toast.show('Invite code copied');
      },
      () => {
        toast.show('Copy failed');
      },
    );
  };

  const newCode = () => {
    setState({ status: 'starting' });
    setAttempt((current) => current + 1);
  };

  const onShare = () => {
    if (state.status !== 'confirm' || !keys || busy) return;
    setBusy(true);
    const joiner = { name: state.name, joinerKey: state.joinerKey };
    const share = async () => {
      if (!album) return confirmInvite(state.invite, joiner, keys, me.name);
      // The album gets its own key now, and only that key goes to them.
      const albumKey = await shareAlbum(album.id);
      const member = await confirmInvite(state.invite, joiner, keys, me.name, undefined, {
        albumId: album.id,
        albumKey,
      });
      setSharedWith(album.id, [...album.sharedWith, member.name]);
      return member;
    };
    share()
      .then(
        () => {
          shared.current = true;
          setState({ status: 'done', name: state.name });
          toast.show(`Shared with ${state.name}`);
        },
        (error: unknown) => {
          setState({ status: 'failed', message: errorMessage(error) });
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  if (state.status === 'done') {
    return (
      <div className="share-done" role="status">
        <Icon name="check" size={20} />
        <p>
          {album
            ? `“${album.title}” is shared with ${state.name}. You can remove them any time from the album’s Share menu.`
            : `Your ${where} is shared with ${state.name}. You can stop sharing any time in Settings.`}
        </p>
      </div>
    );
  }

  if (state.status === 'failed') {
    return (
      <div className="share">
        <FormAlert message={state.message} />
        <button type="button" className="btn btn--secondary" onClick={newCode}>
          Get a new code
        </button>
      </div>
    );
  }

  if (state.status === 'confirm') {
    return (
      <div className="share">
        <p className="share__lead">
          <strong>{state.name}</strong> wants to join. Check they see these same four words:
        </p>
        <Phrase words={state.phrase} />
        <p className="share__note">
          <Icon name="shield" size={16} />
          If the words don&apos;t match, cancel. Someone else may have your code.
        </p>
        <div className="share__actions">
          <button type="button" className="btn btn--ghost" onClick={newCode} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onShare}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Sharing…' : 'They match, share'}
          </button>
        </div>
      </div>
    );
  }

  const code = state.status === 'waiting' ? state.invite.code : null;
  return (
    <div className="share">
      <div className="invite-card">
        <span className="invite-card__label">Invite code</span>
        <span className="invite-card__code" data-testid="invite-code">
          {code ?? 'TWO-····-····'}
        </span>
        <div className="invite-card__actions">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={!code}
            onClick={() => {
              if (code) copy(code);
            }}
          >
            <Icon name="copy" size={16} /> Copy code
          </button>
        </div>
        <span className="invite-card__expiry">
          Works once. Keep this screen open until they join.
        </span>
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
        <p className="waiting__text">Waiting for them to enter the code…</p>
      </div>

      <p className="share__note">
        <Icon name="shield" size={16} />
        When they do, you&apos;ll both see four words. Check they match before you share, so you
        know it&apos;s really them.
      </p>
    </div>
  );
}

type JoinState =
  | { status: 'form' }
  | { status: 'joining'; join: Join; phrase: string[] | null }
  | { status: 'failed'; message: string };

/** Enters someone's code, shows the safety phrase, and adds their library once they share. */
function JoinPanel({ keys, where }: { keys: SpaceKeys | null; where: string }) {
  const toast = useToast();
  const me = useMe();
  const { navigate } = useRouter();
  const { reloadVault } = useAccount();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<JoinState>({ status: 'form' });
  const pending = useRef<Join | null>(null);

  // Leaving before it finishes gives the invite up.
  useEffect(
    () => () => {
      if (pending.current) void abandonJoin(pending.current);
    },
    [],
  );

  usePoll(
    state.status === 'joining',
    async () => {
      if (state.status !== 'joining' || !keys) return true;
      const progress = await advanceJoin(state.join, me.name);
      if (progress.stage === 'waiting') {
        if (progress.phrase && !state.phrase) setState({ ...state, phrase: progress.phrase });
        return false;
      }
      await finishJoin(state.join, progress.grant, keys);
      pending.current = null;
      // Load the open space again, now with their photos.
      reloadVault();
      if (progress.grant.album) {
        toast.show(`${progress.grant.name} shared an album with you`);
        navigate(paths.albums);
      } else {
        toast.show(`You joined ${progress.grant.name}’s library`);
        navigate(paths.gallery);
      }
      return true;
    },
    (caught) => {
      if (!isFinal(caught)) return false;
      if (pending.current) void abandonJoin(pending.current);
      pending.current = null;
      setState({ status: 'failed', message: errorMessage(caught) });
      return true;
    },
  );

  const onJoin = (event: SubmitEvent) => {
    event.preventDefault();
    if (busy || !keys) return;
    const normalized = normalizeInviteCode(code);
    if (!isInviteCode(normalized)) {
      setError(
        'That code doesn’t look right. It’s 8 letters and numbers after TWO, without 0, 1, I or O.',
      );
      return;
    }
    setBusy(true);
    startJoin(normalized)
      .then(
        (join) => {
          pending.current = join;
          setState({ status: 'joining', join, phrase: null });
        },
        (caught: unknown) => {
          setError(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  if (state.status === 'joining') {
    return (
      <div className="share" role="status">
        {state.phrase ? (
          <>
            <p className="share__lead">Check they see these same four words:</p>
            <Phrase words={state.phrase} />
            <p className="waiting__text">Waiting for them to confirm…</p>
          </>
        ) : (
          <p className="waiting__text">Connecting…</p>
        )}
        <p className="share__note">
          <Icon name="shield" size={16} />
          What they share will appear in your {where}, and only there.
        </p>
      </div>
    );
  }

  return (
    <form
      role="tabpanel"
      id="panel-join"
      aria-labelledby="tab-join"
      className="form"
      onSubmit={onJoin}
      noValidate
    >
      <FormAlert message={state.status === 'failed' ? state.message : null} />
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
      <button
        type="submit"
        className="btn btn--primary btn--block btn--lg"
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? 'Joining…' : 'Join'}
      </button>
    </form>
  );
}

/**
 * Invite someone to the open space or to one of its albums, or join a library or album
 * someone shared with you.
 */
export function Share() {
  const { space, state: vault, status } = useVault();
  const { state } = useAccount();
  const { search } = useRouter();
  const [mode, setMode] = useState<Mode>('invite');
  const keys = state.status === 'unlocked' ? state.session.opened.space : null;

  const where = space === 'private' ? 'private space' : 'library';
  const albumId = parseShareAlbum(search);
  if (albumId !== null) {
    const found = vault.albums.find((each) => each.id === albumId && each.library === undefined);
    const album: SharedAlbum | null = found
      ? { id: found.id, title: found.title, sharedWith: found.sharedWith ?? [] }
      : null;
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
            <InvitePanel keys={keys} where={where} album={album} />
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
          <div role="tabpanel" id="panel-invite" aria-labelledby="tab-invite">
            <InvitePanel keys={keys} where={where} album={null} />
          </div>
        ) : (
          <JoinPanel keys={keys} where={where} />
        )}
      </div>
    </div>
  );
}
