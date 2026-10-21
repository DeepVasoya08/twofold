import { useState } from 'react';

import { useGroups, usePeople, usePeopleProgress } from '../app/people';
import type { PeopleStatus } from '../app/people';
import { Link } from '../app/router';
import { paths } from '../app/routes';
import { useToast } from '../app/toast';
import { useVault } from '../app/vault';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { FaceThumb } from '../components/FaceThumb';
import { pluralize } from '../lib/format';
import { MODEL_DOWNLOAD_MB } from '../lib/people/models';
import type { Group } from '../lib/people/grouping';

import './people.css';

/** What finding faces is doing, in a few words for under the page title. */
export function progressLine(status: PeopleStatus, done: number, total: number): string {
  const counted = `${done.toLocaleString('en-US')} of ${pluralize(total, 'photo')} looked at`;
  switch (status) {
    case 'off':
      return 'Off on this device';
    case 'loading':
      return 'Loading…';
    case 'scanning':
      return `Finding faces on this device · ${counted}`;
    case 'waiting':
      return `Paused while photos upload or Twofold is in the background · ${counted}`;
    case 'failed':
      return counted;
    case 'ready':
      return done < total ? counted : 'Faces found on this device';
  }
}

/** A person's name, or what to call a group nobody has named. */
export function groupName(group: Group): string {
  const name = group.person?.name ?? '';
  return name === '' ? 'Add a name' : name;
}

/** Turning face grouping on, with what it does and what it downloads. */
export function TurnOnPeople({ onTurnOn }: { onTurnOn: () => void }) {
  return (
    <EmptyState
      icon="person"
      title="Group photos by the people in them"
      action={
        <button type="button" className="btn btn--primary" onClick={onTurnOn}>
          Turn on face grouping
        </button>
      }
    >
      Twofold can find faces and group photos of the same person. It all happens on this device:
      your photos and the faces in them never leave it unencrypted. The first time, this device
      downloads the face models (about {MODEL_DOWNLOAD_MB} MB).
    </EmptyState>
  );
}

export function People() {
  const people = usePeople();
  const { groups, hidden } = useGroups();
  const progress = usePeopleProgress();
  const { state } = useVault();
  const toast = useToast();
  const [showHidden, setShowHidden] = useState(false);

  if (!people.enabled) {
    return (
      <div className="page">
        <PageHeader title="People" />
        <TurnOnPeople
          onTurnOn={() => {
            people.setEnabled(true);
            toast.show('Face grouping is on for this device');
          }}
        />
      </div>
    );
  }

  const photoById = new Map(state.photos.map((photo) => [photo.id, photo]));
  const shown = showHidden ? hidden : groups;
  const looking = people.status === 'scanning' || people.status === 'waiting';

  return (
    <div className="page">
      <PageHeader
        title="People"
        subtitle={progressLine(people.status, progress.done, progress.total)}
      />
      {people.error && (
        <p className="people__error" role="alert">
          {people.error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="people__empty">
          {showHidden
            ? 'Nobody is hidden.'
            : looking || people.status === 'loading'
              ? 'People show up here as their faces are found.'
              : 'No people yet. Groups show up once someone is in at least 3 photos.'}
        </p>
      ) : (
        <ul className="people-grid">
          {shown.map((group) => (
            <li key={group.id}>
              <Link to={paths.person(group.id)} className="person-card">
                <FaceThumb
                  face={group.faces[0]}
                  photo={group.faces[0] && photoById.get(group.faces[0].photoId)}
                />
                <span className={`person-card__name${group.person?.name ? '' : ' is-unnamed'}`}>
                  {groupName(group)}
                </span>
                <span className="person-card__meta">
                  {pluralize(group.photoIds.length, 'photo')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {(hidden.length > 0 || showHidden) && (
        <button
          type="button"
          className="btn btn--ghost people__toggle"
          onClick={() => {
            setShowHidden(!showHidden);
          }}
        >
          {showHidden ? 'Back to people' : `Hidden people (${String(hidden.length)})`}
        </button>
      )}
    </div>
  );
}
