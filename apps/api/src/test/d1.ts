/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

/** How many times the API has gone to the database: each query, or each batch, is one. */
export interface RoundTrips {
  count: number;
}

/**
 * How quickly the stand-in answers. At once by default. With `slow`, each query or batch
 * answers on a later timer tick, as D1 does over the network, so requests sent together
 * interleave the way they do in production (for tests of races).
 */
export interface Pace {
  slow: boolean;
}

/** Runs a query now, or on a later timer tick when the pace is slow. */
function answer<T>(pace: Pace, query: () => T): Promise<T> {
  if (!pace.slow) return Promise.resolve(query());
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(query());
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, 0);
  });
}

/**
 * A small D1 stand-in on Node's built-in SQLite, with the real migrations applied, so API
 * tests run the same SQL as production. Only the parts of D1 the API uses are here.
 */
class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly trips: RoundTrips,
    private readonly pace: Pace,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: SQLInputValue[]): Statement {
    return new Statement(this.db, this.trips, this.pace, this.sql, params);
  }

  first<T>(): Promise<T | null> {
    this.trips.count += 1;
    return answer(
      this.pace,
      () => (this.db.prepare(this.sql).get(...this.params) ?? null) as T | null,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- D1's own signature
  all<T>(): Promise<{ results: T[] }> {
    this.trips.count += 1;
    return answer(this.pace, () => ({
      results: this.db.prepare(this.sql).all(...this.params) as T[],
    }));
  }

  run(): Promise<{ meta: { changes: number } }> {
    this.trips.count += 1;
    return answer(this.pace, () => ({
      meta: { changes: Number(this.db.prepare(this.sql).run(...this.params).changes) },
    }));
  }

  /** What D1 gives for each statement in a batch: rows (for a query) and the change count. */
  runInBatch(): { results: unknown[]; meta: { changes: number } } {
    const statement = this.db.prepare(this.sql);
    if (statement.columns().length === 0) {
      const result = statement.run(...this.params);
      return { results: [], meta: { changes: Number(result.changes) } };
    }
    const results = statement.all(...this.params);
    const changes = Number(this.db.prepare('SELECT changes() AS n').get()?.n ?? 0);
    return { results, meta: { changes: /^\s*select/i.test(this.sql) ? 0 : changes } };
  }
}

class TestD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  readonly trips: RoundTrips = { count: 0 };
  readonly pace: Pace = { slow: false };

  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    const dir = join(import.meta.dirname, '../../migrations');
    for (const file of readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      this.sqlite.exec(readFileSync(join(dir, file), 'utf8'));
    }
  }

  prepare(sql: string): Statement {
    return new Statement(this.sqlite, this.trips, this.pace, sql);
  }

  batch(statements: Statement[]): Promise<{ results: unknown[]; meta: { changes: number } }[]> {
    this.trips.count += 1;
    return answer(this.pace, () => {
      this.sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.runInBatch());
        this.sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        this.sqlite.exec('ROLLBACK');
        throw error;
      }
    });
  }
}

export function createTestDb(): {
  db: D1Database;
  sqlite: DatabaseSync;
  trips: RoundTrips;
  pace: Pace;
} {
  const d1 = new TestD1();
  return { db: d1 as unknown as D1Database, sqlite: d1.sqlite, trips: d1.trips, pace: d1.pace };
}
