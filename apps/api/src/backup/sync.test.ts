import { beforeAll, describe, expect, it } from 'vitest';

import {
  COPY_PREFIX,
  COPY_STORAGE_CLASS,
  GONE_PREFIX,
  KEEP_DELETED_DAYS,
  MAX_COPIES_PER_RUN,
  SETTLE_MS,
  syncBackup,
} from './sync';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const start = new Date('2026-11-01T00:00:00Z');
const at = (ms: number) => new Date(start.getTime() + ms);

beforeAll(() => {
  // Workers' FixedLengthStream; Node only has the plain TransformStream.
  if (!('FixedLengthStream' in globalThis)) {
    Object.assign(globalThis, {
      FixedLengthStream: class extends TransformStream {
        constructor(readonly expectedLength: number) {
          super();
        }
      },
    });
  }
});

interface Stored {
  data: Uint8Array;
  uploaded: Date;
  /** R2 puts objects in Standard unless told otherwise. */
  storageClass?: string;
}

/**
 * An in-memory bucket with the parts of R2Bucket the backup uses. `locked` mimics a bucket
 * lock: objects under that prefix can't be deleted or replaced for `lockDays`.
 */
class FakeBucket {
  readonly objects = new Map<string, Stored>();
  now = start;
  failGets = false;

  constructor(private readonly lock?: { prefix: string; days: number }) {}

  add(key: string, data: string, uploaded: Date): void {
    this.objects.set(key, { data: new TextEncoder().encode(data), uploaded });
  }

  text(key: string): string | undefined {
    const stored = this.objects.get(key);
    return stored && new TextDecoder().decode(stored.data);
  }

  private checkLock(key: string): void {
    const stored = this.objects.get(key);
    if (
      this.lock &&
      stored &&
      key.startsWith(this.lock.prefix) &&
      this.now.getTime() - stored.uploaded.getTime() < this.lock.days * DAY
    ) {
      throw new Error(`locked: ${key}`);
    }
  }

  list(options: { prefix?: string; cursor?: string; limit?: number }) {
    const keys = [...this.objects.keys()]
      .filter((key) => key.startsWith(options.prefix ?? ''))
      .sort();
    const from = options.cursor ? Number(options.cursor) : 0;
    // Small pages, so paging is exercised.
    const limit = Math.min(options.limit ?? 1000, 3);
    const page = keys.slice(from, from + limit);
    const truncated = from + limit < keys.length;
    return Promise.resolve({
      objects: page.flatMap((key) => {
        const stored = this.objects.get(key);
        return stored ? [{ key, size: stored.data.length, uploaded: stored.uploaded }] : [];
      }),
      truncated,
      ...(truncated ? { cursor: String(from + limit) } : {}),
    });
  }

  get(key: string) {
    if (this.failGets) return Promise.reject(new Error('get failed'));
    const stored = this.objects.get(key);
    if (!stored) return Promise.resolve(null);
    return Promise.resolve({
      size: stored.data.length,
      httpMetadata: {},
      body: new Response(stored.data.slice()).body,
    });
  }

  async put(key: string, value: ReadableStream | Uint8Array, options?: R2PutOptions) {
    this.checkLock(key);
    const data =
      value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
    const storageClass = options?.storageClass;
    this.objects.set(key, { data, uploaded: this.now, ...(storageClass ? { storageClass } : {}) });
    return { size: data.length };
  }

  delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.checkLock(key);
      this.objects.delete(key);
    }
    return Promise.resolve();
  }

  get asBucket(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}

function setup() {
  const source = new FakeBucket();
  const backup = new FakeBucket({ prefix: COPY_PREFIX, days: KEEP_DELETED_DAYS });
  const run = (now: Date) => {
    source.now = now;
    backup.now = now;
    return syncBackup(source.asBucket, backup.asBucket, now);
  };
  return { source, backup, run };
}

describe('photo backup', () => {
  it('copies settled files under r2/, byte for byte', async () => {
    const { source, backup, run } = setup();
    for (let i = 0; i < 7; i++)
      source.add(`photos/p${String(i)}/full`, `cipher ${String(i)}`, start);
    const result = await run(at(SETTLE_MS));
    expect(result).toMatchObject({ copied: 7, pending: 0, failed: 0 });
    for (let i = 0; i < 7; i++) {
      expect(backup.text(`${COPY_PREFIX}photos/p${String(i)}/full`)).toBe(`cipher ${String(i)}`);
    }
  });

  it('waits for new files to settle, since a pending upload may be retried', async () => {
    const { source, backup, run } = setup();
    source.add('photos/p/full', 'first try', start);
    expect((await run(at(SETTLE_MS - 1))).copied).toBe(0);
    expect(backup.objects.size).toBe(0);
    expect((await run(at(SETTLE_MS))).copied).toBe(1);
  });

  it('copies each file once', async () => {
    const { source, run } = setup();
    source.add('photos/p/full', 'x', start);
    await run(at(SETTLE_MS));
    expect(await run(at(2 * SETTLE_MS))).toMatchObject({ copied: 0, failed: 0 });
  });

  it('spreads a big first backup over several runs', async () => {
    const { source, run } = setup();
    for (let i = 0; i < MAX_COPIES_PER_RUN + 2; i++) source.add(`f${String(i)}`, 'x', start);
    expect(await run(at(SETTLE_MS))).toMatchObject({ copied: MAX_COPIES_PER_RUN, pending: 2 });
    expect(await run(at(2 * SETTLE_MS))).toMatchObject({ copied: 2, pending: 0 });
  });

  it('keeps a deleted file 30 days after it was first missed, then removes it', async () => {
    const { source, backup, run } = setup();
    source.add('other', 'o', start); // So the bucket never lists empty.
    source.add('photos/p/full', 'x', start);
    await run(at(SETTLE_MS));
    source.objects.delete('photos/p/full');

    const missed = at(40 * DAY);
    expect((await run(missed)).marked).toBe(1);
    expect(backup.objects.get(`${GONE_PREFIX}photos/p/full`)?.uploaded).toEqual(missed);

    expect((await run(at(40 * DAY + (KEEP_DELETED_DAYS * DAY - HOUR)))).removed).toBe(0);
    expect(backup.text(`${COPY_PREFIX}photos/p/full`)).toBe('x');

    expect((await run(at(40 * DAY + KEEP_DELETED_DAYS * DAY))).removed).toBe(1);
    expect([...backup.objects.keys()]).toEqual([`${COPY_PREFIX}other`]);
  });

  it('never marks the same file twice, so its 30 days keep their start', async () => {
    const { source, backup, run } = setup();
    source.add('other', 'o', start); // So the bucket never lists empty.
    source.add('a', 'x', start);
    await run(at(SETTLE_MS));
    source.objects.delete('a');
    await run(at(2 * DAY));
    expect((await run(at(3 * DAY))).marked).toBe(0);
    expect(backup.objects.get(`${GONE_PREFIX}a`)?.uploaded).toEqual(at(2 * DAY));
  });

  it('drops the mark when a file is back', async () => {
    const { source, backup, run } = setup();
    source.add('other', 'o', start); // So the bucket never lists empty.
    source.add('a', 'x', start);
    await run(at(SETTLE_MS));
    const stored = source.objects.get('a');
    if (!stored) throw new Error('not stored');
    source.objects.delete('a');
    await run(at(DAY));
    source.objects.set('a', stored);
    expect((await run(at(2 * DAY))).unmarked).toBe(1);
    expect(backup.objects.has(`${GONE_PREFIX}a`)).toBe(false);
    expect(backup.text(`${COPY_PREFIX}a`)).toBe('x');
  });

  it('marks nothing when the photo bucket lists empty but copies exist', async () => {
    const { source, backup, run } = setup();
    source.add('a', 'x', start);
    await run(at(SETTLE_MS));
    source.objects.clear();
    expect(await run(at(DAY))).toMatchObject({ guarded: true, marked: 0 });
    expect([...backup.objects.keys()]).toEqual([`${COPY_PREFIX}a`]);
  });

  it('reports failed copies and tries them again next run', async () => {
    const { source, run } = setup();
    source.add('a', 'x', start);
    source.failGets = true;
    expect(await run(at(SETTLE_MS))).toMatchObject({ copied: 0, failed: 1 });
    source.failGets = false;
    expect(await run(at(2 * SETTLE_MS))).toMatchObject({ copied: 1, failed: 0 });
  });

  it('cannot remove a copy while the bucket lock holds it', async () => {
    const { source, backup, run } = setup();
    source.add('a', 'x', start);
    await run(at(SETTLE_MS));
    source.objects.delete('a');
    // A mark made early (here by hand) still can't get a locked copy deleted.
    await backup.put(`${GONE_PREFIX}a`, new Uint8Array(0));
    backup.objects.set(`${GONE_PREFIX}a`, { data: new Uint8Array(0), uploaded: at(-60 * DAY) });
    expect(await run(at(2 * DAY))).toMatchObject({ removed: 0, failed: 1 });
    expect(backup.text(`${COPY_PREFIX}a`)).toBe('x');
  });

  it('puts copies in Infrequent Access and marks in Standard', async () => {
    const { source, backup, run } = setup();
    source.add('a', 'x', start);
    // A file that stays, so the empty-bucket guard doesn't stop the mark.
    source.add('b', 'y', start);
    await run(at(SETTLE_MS));
    expect(COPY_STORAGE_CLASS).toBe('InfrequentAccess');
    expect(backup.objects.get(`${COPY_PREFIX}a`)?.storageClass).toBe('InfrequentAccess');
    source.objects.delete('a');
    await run(at(2 * SETTLE_MS));
    expect(backup.objects.has(`${GONE_PREFIX}a`)).toBe(true);
    expect(backup.objects.get(`${GONE_PREFIX}a`)?.storageClass).toBeUndefined();
  });

  it('only reads the photo bucket', async () => {
    const { source, run } = setup();
    source.add('a', 'x', start);
    source.add('b', 'y', start);
    const before = new Map(source.objects);
    await run(at(SETTLE_MS));
    source.objects.delete('b');
    await run(at(60 * DAY));
    expect([...source.objects.keys()]).toEqual(['a']);
    expect(source.objects.get('a')).toBe(before.get('a'));
  });
});
