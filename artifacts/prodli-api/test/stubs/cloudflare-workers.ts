// Minimal stand-in for the `cloudflare:workers` module so UserStore can run in Node tests.
export class DurableObject<E = unknown> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: E,
  ) {}
}
