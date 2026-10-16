/**
 * A small in-memory R2 stand-in with the parts of R2Bucket the API uses: put (streams too),
 * get, head and delete.
 */
class TestObject {
  constructor(
    readonly key: string,
    readonly data: Uint8Array,
  ) {}

  get size(): number {
    return this.data.length;
  }

  get body(): ReadableStream {
    return new Blob([this.data]).stream();
  }
}

export class TestR2 {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, value: ReadableStream | ArrayBuffer | Uint8Array): Promise<TestObject> {
    const data =
      value instanceof ReadableStream
        ? new Uint8Array(await new Response(value).arrayBuffer())
        : new Uint8Array(value);
    this.objects.set(key, data);
    return new TestObject(key, data);
  }

  get(key: string): Promise<TestObject | null> {
    const data = this.objects.get(key);
    return Promise.resolve(data ? new TestObject(key, data) : null);
  }

  head(key: string): Promise<TestObject | null> {
    return this.get(key);
  }

  delete(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
    return Promise.resolve();
  }
}

export function createTestR2(): { bucket: R2Bucket; r2: TestR2 } {
  const r2 = new TestR2();
  return { bucket: r2 as unknown as R2Bucket, r2 };
}
