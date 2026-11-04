import { describe, expect, it } from 'vitest';

import { newSpace, openOwnerRecord, spaceToken } from '@arcafold/crypto';

import { FakeServer } from '../testing/fake-server';
import { face, photoId, unitVector } from '../testing/faces';
import type { FaceResults } from './segment';
import { memoryPeopleStore, parsePerson, remotePeopleStore } from './store';
import type { Person } from './grouping';

const results = (from: number, count: number): FaceResults =>
  new Map(Array.from({ length: count }, (_, n) => [photoId(from + n), [face(unitVector(n))]]));

const ada = (id: string): Person => ({
  id,
  name: 'Ada Lovelace',
  faces: [`${photoId(1)}#0`],
  rejected: [],
  hidden: false,
  me: false,
  labels: [],
});

describe('remotePeopleStore', () => {
  it('saves results sealed, and loads them back on another device', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const store = remotePeopleStore(space, server.api);
    const ids = await store.saveResults(results(0, 3));
    expect(ids).toHaveLength(1);
    // The server holds only ciphertext: no photo id appears in what it keeps.
    const stored = [...server.faceSegments.values()];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.data).not.toContain(photoId(0));

    const loaded = await remotePeopleStore(space, server.api).load();
    expect([...loaded.results.keys()]).toEqual([photoId(0), photoId(1), photoId(2)]);
    expect(loaded.segments).toEqual(ids);
  });

  it('keeps everything in the space it belongs to', async () => {
    const server = new FakeServer();
    const store = remotePeopleStore(await newSpace(), server.api);
    await store.saveResults(results(0, 2));
    await store.savePerson(ada(await store.newId()));
    const other = await remotePeopleStore(await newSpace(), server.api).load();
    expect(other.results.size).toBe(0);
    expect(other.people).toEqual([]);
  });

  it('leaves out segments that do not open, so they are merged away', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const store = remotePeopleStore(space, server.api);
    await store.saveResults(results(0, 2));
    const token = spaceToken(space);
    server.faceSegments.set(`${token}/bad`, { token, id: 'bad', data: 'AAAA' });
    const loaded = await store.load();
    expect(loaded.results.size).toBe(2);
    expect(loaded.segments).toContain('bad');
  });

  it('replaces segments with merged ones, saving the new ones first', async () => {
    const server = new FakeServer();
    const store = remotePeopleStore(await newSpace(), server.api);
    const first = await store.saveResults(results(0, 2));
    const second = await store.saveResults(results(2, 2));
    const fresh = await store.replaceSegments(results(0, 3), [...first, ...second]);
    const loaded = await store.load();
    expect(loaded.segments).toEqual(fresh);
    expect(loaded.results.size).toBe(3);
  });

  it('saves "This is me" and labels sealed with the person', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    await remotePeopleStore(space, server.api).savePerson({
      ...ada('p1'),
      me: true,
      labels: ['friends'],
    });
    const [loaded] = (await remotePeopleStore(space, server.api).load()).people;
    expect(loaded).toMatchObject({ id: 'p1', me: true, labels: ['friends'] });
  });

  it('seals people for the owner only, and deletes and forgets them', async () => {
    const server = new FakeServer();
    const space = await newSpace();
    const store = remotePeopleStore(space, server.api);
    const person = ada(await store.newId());
    await store.savePerson(person);
    const stored = [...server.people.values()][0];
    expect(stored?.meta).not.toContain('Ada Lovelace');
    const opened = await openOwnerRecord(space, 'person', person.id, stored?.meta ?? '');
    expect(new TextDecoder().decode(opened)).toContain('Ada Lovelace');
    expect((await store.load()).people).toEqual([person]);

    await store.deletePerson(person.id);
    expect((await store.load()).people).toEqual([]);

    await store.savePerson(person);
    await store.saveResults(results(0, 1));
    await store.forget();
    const empty = await store.load();
    expect(empty.people).toEqual([]);
    expect(empty.results.size).toBe(0);
  });
});

describe('parsePerson', () => {
  it('reads a saved person and refuses anything else', () => {
    const valid = { v: 1, name: 'Ada', faces: ['a#0'], rejected: [], hidden: true };
    expect(parsePerson('p', valid)).toEqual({
      id: 'p',
      name: 'Ada',
      faces: ['a#0'],
      rejected: [],
      hidden: true,
      me: false,
      labels: [],
    });
    expect(parsePerson('p', { ...valid, v: 2 })).toBeNull();
    expect(parsePerson('p', { ...valid, faces: [1] })).toBeNull();
    expect(parsePerson('p', { ...valid, hidden: 'yes' })).toBeNull();
    expect(parsePerson('p', { ...valid, me: 'yes' })).toBeNull();
    expect(parsePerson('p', { ...valid, labels: 'friends' })).toBeNull();
    expect(parsePerson('p', null)).toBeNull();
  });

  it('reads "This is me" and labels, dropping labels it does not know', () => {
    const saved = { v: 1, name: 'Ada', faces: [], rejected: [], hidden: false };
    expect(
      parsePerson('p', { ...saved, me: true, labels: ['family', 'pets', 'family', 'work'] }),
    ).toMatchObject({ me: true, labels: ['family', 'work'] });
  });
});

describe('memoryPeopleStore', () => {
  it('keeps what it is given', async () => {
    const store = memoryPeopleStore();
    await store.saveResults(results(0, 2));
    await store.savePerson(ada('p1'));
    const loaded = await store.load();
    expect(loaded.results.size).toBe(2);
    expect(loaded.people).toHaveLength(1);
  });
});
