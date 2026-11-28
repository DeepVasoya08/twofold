import { AccountCounters, STORED_KEY, windowKey } from '../counters';
import type { CountWindow, WindowName } from '../counters';

/**
 * A stand-in for the COUNTERS Durable Object namespace: one AccountCounters per name, its
 * storage kept in memory. Calls go through the way they do to a real Durable Object: each
 * returns a promise, and arguments and results are copies.
 */
export interface TestCounters {
  /** Stands in for env.COUNTERS. */
  namespace: DurableObjectNamespace<AccountCounters>;
  /** The bytes the account's counters hold. */
  stored(accountId: string): number;
  /** Sets the bytes the account's counters hold. */
  setStored(accountId: string, bytes: number): void;
  /** The account's window `name`, if it has one. */
  window(accountId: string, name: WindowName): CountWindow | undefined;
  /** Sets the account's window `name`. */
  setWindow(accountId: string, name: WindowName, window: CountWindow): void;
  /** Everything the account's counters keep, by key: nothing for an account with none. */
  kept(accountId: string): Map<string, unknown>;
}

export function createTestCounters(): TestCounters {
  const storages = new Map<string, MemoryStorage>();
  const objects = new Map<string, AccountCounters>();
  const storageOf = (name: string): MemoryStorage => {
    const storage = storages.get(name) ?? new MemoryStorage();
    storages.set(name, storage);
    return storage;
  };
  const objectOf = (name: string): AccountCounters => {
    const object =
      objects.get(name) ??
      new AccountCounters({ storage: storageOf(name) } as unknown as DurableObjectState, {});
    objects.set(name, object);
    return object;
  };
  const namespace = {
    idFromName: (name: string) => ({ name, toString: () => `counters of ${name}` }),
    get: (id: { name: string }) => stubOf(objectOf(id.name)),
  };
  return {
    namespace: namespace as unknown as DurableObjectNamespace<AccountCounters>,
    stored: (accountId) => (storageOf(accountId).data.get(STORED_KEY) as number | undefined) ?? 0,
    setStored: (accountId, bytes) => storageOf(accountId).data.set(STORED_KEY, bytes),
    window: (accountId, name) =>
      storageOf(accountId).data.get(windowKey(name)) as CountWindow | undefined,
    setWindow: (accountId, name, window) =>
      storageOf(accountId).data.set(windowKey(name), { ...window }),
    kept: (accountId) => new Map(storageOf(accountId).data),
  };
}

/** A Durable Object's storage in memory: the synchronous key-value calls, and deleteAll. */
class MemoryStorage {
  readonly data = new Map<string, unknown>();

  readonly kv = {
    get: (key: string): unknown => structuredClone(this.data.get(key)),
    put: (key: string, value: unknown): void => {
      this.data.set(key, structuredClone(value));
    },
    delete: (key: string): boolean => this.data.delete(key),
  };

  deleteAll(): Promise<void> {
    this.data.clear();
    return Promise.resolve();
  }
}

/** Calls the object's methods the way a stub does: as promises, with copies both ways. */
function stubOf(object: AccountCounters): DurableObjectStub<AccountCounters> {
  return new Proxy(
    {},
    {
      get: (_, name) => {
        // Like a real stub, it isn't a promise itself.
        if (typeof name !== 'string' || name === 'then') return undefined;
        const method: unknown = Reflect.get(object, name);
        if (typeof method !== 'function') return undefined;
        const call = method as (...args: unknown[]) => unknown;
        return async (...args: unknown[]) =>
          structuredClone(await call.apply(object, structuredClone(args)));
      },
    },
  ) as DurableObjectStub<AccountCounters>;
}
