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
 * A small D1 stand-in on Node's built-in SQLite, with the real migrations applied, so API
 * tests run the same SQL as production. Only the parts of D1 the API uses are here.
 */
class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly trips: RoundTrips,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: SQLInputValue[]): Statement {
    return new Statement(this.db, this.trips, this.sql, params);
  }

  first<T>(): Promise<T | null> {
    this.trips.count += 1;
    const row = this.db.prepare(this.sql).get(...this.params);
    return Promise.resolve((row ?? null) as T | null);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- D1's own signature
  all<T>(): Promise<{ results: T[] }> {
    this.trips.count += 1;
    const rows = this.db.prepare(this.sql).all(...this.params);
    return Promise.resolve({ results: rows as T[] });
  }

  run(): Promise<{ meta: { changes: number } }> {
    this.trips.count += 1;
    const result = this.db.prepare(this.sql).run(...this.params);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }

  /**
   * What D1 gives for each statement in a batch: rows (for a query), the change count, and
   * the database's size after it.
   */
  runInBatch(): { results: unknown[]; meta: { changes: number; size_after: number } } {
    const statement = this.db.prepare(this.sql);
    if (statement.columns().length === 0) {
      const result = statement.run(...this.params);
      return { results: [], meta: { changes: Number(result.changes), size_after: this.size() } };
    }
    const results = statement.all(...this.params);
    const changes = Number(this.db.prepare('SELECT changes() AS n').get()?.n ?? 0);
    const meta = { changes: /^\s*select/i.test(this.sql) ? 0 : changes, size_after: this.size() };
    return { results, meta };
  }

  private size(): number {
    const pages = this.db.prepare('PRAGMA page_count').get()?.page_count;
    const pageSize = this.db.prepare('PRAGMA page_size').get()?.page_size;
    return Number(pages ?? 0) * Number(pageSize ?? 0);
  }
}

class TestD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  readonly trips: RoundTrips = { count: 0 };

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
    return new Statement(this.sqlite, this.trips, sql);
  }

  batch(
    statements: Statement[],
  ): Promise<{ results: unknown[]; meta: { changes: number; size_after: number } }[]> {
    this.trips.count += 1;
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.runInBatch());
      this.sqlite.exec('COMMIT');
      return Promise.resolve(results);
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createTestDb(): { db: D1Database; sqlite: DatabaseSync; trips: RoundTrips } {
  const d1 = new TestD1();
  return { db: d1 as unknown as D1Database, sqlite: d1.sqlite, trips: d1.trips };
}
