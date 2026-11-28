/**
 * Stands in for the Workers runtime's `cloudflare:workers` module in tests, which run in
 * Node (vitest.config.ts points the import here): only the Durable Object base class.
 */
export class DurableObject<Env = unknown> {
  constructor(
    protected readonly ctx: DurableObjectState,
    protected readonly env: Env,
  ) {}
}
