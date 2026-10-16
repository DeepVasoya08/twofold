/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

/**
 * A small D1 stand-in on Node's built-in SQLite, with the real migrations applied, so API
 * tests run the same SQL as production. Only the parts of D1 the API uses are here.
 */
class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: SQLInputValue[]): Statement {
    return new Statement(this.db, this.sql, params);
  }

  first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return Promise.resolve((row ?? null) as T | null);
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- D1's own signature
  all<T>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return Promise.resolve({ results: rows as T[] });
  }

  run(): Promise<{ meta: { changes: number } }> {
    const result = this.db.prepare(this.sql).run(...this.params);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }
}

class TestD1 {
  readonly sqlite = new DatabaseSync(':memory:');

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
    return new Statement(this.sqlite, sql);
  }

  async batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]> {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createTestDb(): { db: D1Database; sqlite: DatabaseSync } {
  const d1 = new TestD1();
  return { db: d1 as unknown as D1Database, sqlite: d1.sqlite };
}
