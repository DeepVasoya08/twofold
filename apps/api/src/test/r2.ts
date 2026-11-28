/**
 * A small in-memory R2 stand-in with the parts of R2Bucket the API uses: put (streams too,
 * and only if nothing is stored yet when asked with If-None-Match: *), get, head and delete.
 *
 * Like a real Worker, it allows only CONNECTION_LIMIT objects whose bodies haven't been read
 * yet: getting one more closes the oldest, so its body fails when read.
 */
export const CONNECTION_LIMIT = 6;

class TestObject {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly stream: ReadableStream<Uint8Array>;

  constructor(
    readonly key: string,
    readonly data: Uint8Array,
    private readonly done: (object: TestObject) => void = () => undefined,
  ) {
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      pull: (controller) => {
        controller.enqueue(this.data.slice());
        controller.close();
        this.done(this);
      },
      cancel: () => {
        this.done(this);
      },
    });
  }

  get size(): number {
    return this.data.length;
  }

  get body(): ReadableStream<Uint8Array> {
    return this.stream;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return new Response(this.stream).arrayBuffer();
  }

  /** What the runtime does to an unread body when it needs the connection back. */
  close(): void {
    this.controller?.error(new Error('Response closed due to connection limit'));
    this.done(this);
  }
}

export class TestR2 {
  readonly objects = new Map<string, Uint8Array>();
  /** Objects got but not read yet, oldest first. */
  readonly unread: TestObject[] = [];

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | Uint8Array,
    options?: { onlyIf?: Headers },
  ): Promise<TestObject | null> {
    const onlyIf = options?.onlyIf ? [...options.onlyIf.entries()] : [];
    if (onlyIf.some(([name, given]) => name !== 'if-none-match' || given !== '*')) {
      throw new Error('Only If-None-Match: * is supported here');
    }
    const data =
      value instanceof ReadableStream
        ? new Uint8Array(await new Response(value).arrayBuffer())
        : new Uint8Array(value);
    // Like R2, the condition is checked when the write lands, not when it starts.
    if (onlyIf.length > 0 && this.objects.has(key)) return null;
    this.objects.set(key, data);
    return new TestObject(key, data);
  }

  get(key: string): Promise<TestObject | null> {
    const data = this.objects.get(key);
    if (!data) return Promise.resolve(null);
    if (this.unread.length >= CONNECTION_LIMIT) this.unread[0]?.close();
    const object = new TestObject(key, data, (read) => {
      const index = this.unread.indexOf(read);
      if (index >= 0) this.unread.splice(index, 1);
    });
    this.unread.push(object);
    return Promise.resolve(object);
  }

  head(key: string): Promise<TestObject | null> {
    const data = this.objects.get(key);
    return Promise.resolve(data ? new TestObject(key, data) : null);
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
