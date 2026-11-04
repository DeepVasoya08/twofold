import { useState } from 'react';
import type { SubmitEvent } from 'react';

import { useGroups, usePeople } from '../app/people';
import { Link, useRouter } from '../app/router';
import { paths } from '../app/routes';
import { useSelection } from '../app/selection';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { FaceThumb } from '../components/FaceThumb';
import { TextField } from '../components/Field';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import type { MenuItem } from '../components/Menu';
import { PhotoGrid } from '../components/PhotoGrid';
import { SelectButton } from '../components/SelectButton';
import { PhotoViewPicker } from '../components/ViewPicker';
import { SelectionBar } from '../components/SelectionBar';
import { pluralize } from '../lib/format';
import { PERSON_LABELS } from '@arcafold/core/people/grouping';
import type { Group, PersonLabel } from '@arcafold/core/people/grouping';
import { aboutPerson, groupName, labelNames } from './People';
import { errorMessage } from '@arcafold/core/errors';
import type { Photo } from '@arcafold/core/library/model';

import './people.css';

type Open = 'name' | 'merge' | 'labels' | null;

export function Person({ groupId }: { groupId: string }) {
  const people = usePeople();
  const { groups, hidden } = useGroups();
  const { state } = useVault();
  const { navigate } = useRouter();
  const toast = useToast();
  const selection = useSelection();
  const [open, setOpen] = useState<Open>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [labels, setLabels] = useState<PersonLabel[]>([]);

  const group = [...groups, ...hidden].find((each) => each.id === groupId);
  const back = { to: paths.people, label: 'People' };

  if (!group) {
    return (
      <div className="page">
        <PageHeader title="Not found" back={back} />
        <EmptyState
          icon="person"
          title="This person isn’t here"
          action={
            <Link to={paths.people} className="btn btn--secondary">
              See everyone
            </Link>
          }
        >
          Their photos may have been deleted or moved to someone else.
        </EmptyState>
      </div>
    );
  }

  const byId = new Map(state.photos.map((photo) => [photo.id, photo]));
  const photos = group.photoIds.flatMap((id) => {
    const photo = byId.get(id);
    return photo ? [photo] : [];
  });
  const cover = group.faces[0];

  /** Runs a change, then shows the person it made or changed (a new group gets an id). */
  const change = (run: () => Promise<string>, done: string) => {
    if (busy) return;
    setBusy(true);
    run()
      .then(
        (personId) => {
          toast.show(done);
          setOpen(null);
          if (personId !== group.id) navigate(paths.person(personId), { replace: true });
        },
        (caught: unknown) => {
          toast.show(errorMessage(caught));
        },
      )
      .finally(() => {
        setBusy(false);
      });
  };

  const onName = (event: SubmitEvent) => {
    event.preventDefault();
    const chosen = name.trim();
    if (!chosen) {
      setError('Type a name.');
      return;
    }
    change(() => people.name(group, chosen), `Named ${chosen}`);
  };

  const merge = (into: Group) => {
    change(() => people.merge(group, into), `Merged with ${groupName(into)}`);
  };

  const hiddenNow = group.person?.hidden === true;
  const isMe = group.person?.me === true;
  const items: MenuItem[] = [
    {
      label: isMe ? 'This isn’t me' : 'This is me',
      icon: 'person',
      onSelect: () => {
        change(
          () => people.setMe(group, !isMe),
          isMe ? 'No longer marked as you' : 'Marked as you',
        );
      },
    },
    {
      label: 'Labels',
      icon: 'users',
      onSelect: () => {
        setLabels(group.person?.labels ?? []);
        setOpen('labels');
      },
    },
    {
      label: 'Merge with someone',
      icon: 'users',
      onSelect: () => {
        setOpen('merge');
      },
    },
    {
      label: hiddenNow ? 'Show in People' : 'Hide from People',
      icon: hiddenNow ? 'eye' : 'eye-off',
      onSelect: () => {
        change(
          () => people.setHidden(group, !hiddenNow),
          hiddenNow ? 'Shown in People again' : 'Hidden from People',
        );
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title={
          group.person?.name === undefined || group.person.name === ''
            ? 'Someone'
            : group.person.name
        }
        subtitle={aboutPerson(group, pluralize(photos.length, 'photo'))}
        back={back}
        actions={
          <>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setName(group.person?.name ?? '');
                setError(null);
                setOpen('name');
              }}
            >
              <Icon name="pencil" size={16} />
              {group.person?.name ? 'Rename' : 'Add a name'}
            </button>
            {photos.length > 0 && <PhotoViewPicker />}
            {photos.length > 0 && <SelectButton selection={selection} />}
            <Menu label="Person actions" items={items} />
          </>
        }
      />
      <div className="person-hero">
        <FaceThumb face={cover} photo={cover && byId.get(cover.photoId)} size="lg" />
      </div>
      <SelectionBar
        selection={selection}
        allIds={photos.map((photo) => photo.id)}
        extra={{
          label: 'Not this person',
          icon: 'x',
          run: (ids) => people.removePhotos(group, ids),
          done: (removed) => `${removed} taken out`,
        }}
      />
      <PhotoGrid
        photos={photos}
        context={{ kind: 'person', groupId: group.id }}
        selection={selection}
      />

      <Dialog
        open={open === 'name'}
        onClose={() => {
          setOpen(null);
        }}
        title={group.person?.name ? 'Rename' : 'Add a name'}
        description="Names stay encrypted in your library, like everything else."
      >
        <form className="form" onSubmit={onName} noValidate>
          <TextField
            label="Name"
            autoFocus
            value={name}
            maxLength={60}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setError(null);
            }}
            error={error}
          />
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setOpen(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              Save
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={open === 'labels'}
        onClose={() => {
          setOpen(null);
        }}
        title="Labels"
        description="Labels let you search for groups, like “my friends at the beach”."
      >
        <form
          className="form"
          onSubmit={(event) => {
            event.preventDefault();
            change(() => people.setLabels(group, labels), 'Labels saved');
          }}
        >
          <fieldset className="label-choices">
            <legend className="visually-hidden">Labels</legend>
            {PERSON_LABELS.map((label) => (
              <label key={label} className="checkbox">
                <input
                  type="checkbox"
                  checked={labels.includes(label)}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    setLabels((current) =>
                      on ? [...current, label] : current.filter((each) => each !== label),
                    );
                  }}
                />
                <span>{labelNames[label]}</span>
              </label>
            ))}
          </fieldset>
          <div className="dialog__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setOpen(null);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              Save
            </button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={open === 'merge'}
        onClose={() => {
          setOpen(null);
        }}
        title="Merge with someone"
        description="Pick who these photos are of. Their photos and these become one person."
        size="md"
      >
        <MergeChoices
          groups={[...groups, ...hidden].filter((each) => each.id !== group.id)}
          photos={byId}
          busy={busy}
          onPick={merge}
        />
      </Dialog>
    </div>
  );
}

function MergeChoices({
  groups,
  photos,
  busy,
  onPick,
}: {
  groups: readonly Group[];
  photos: ReadonlyMap<string, Photo>;
  busy: boolean;
  onPick: (group: Group) => void;
}) {
  if (groups.length === 0) return <p className="people__empty">There’s nobody else yet.</p>;
  return (
    <ul className="merge-list">
      {groups.map((each) => (
        <li key={each.id}>
          <button
            type="button"
            className="merge-list__choice"
            disabled={busy}
            onClick={() => {
              onPick(each);
            }}
          >
            <FaceThumb
              face={each.faces[0]}
              photo={each.faces[0] && photos.get(each.faces[0].photoId)}
              size="sm"
            />
            <span className="merge-list__name">{groupName(each)}</span>
            <span className="merge-list__meta">{pluralize(each.photoIds.length, 'photo')}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
