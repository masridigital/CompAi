import type { CheckContext } from '../types';

/**
 * The ctx bridge for sandboxed DSL `code` steps.
 *
 * Only these ctx members are reachable from inside the isolate. Every call
 * crosses the isolate boundary as JSON strings, so no host object, function
 * or prototype ever leaks into untrusted code.
 */

/** Fire-and-forget members: logging and result recording. */
export const SYNC_BRIDGE_METHODS = [
  'log',
  'warn',
  'error',
  'pass',
  'fail',
  'addPassingResult',
  'addFinding',
] as const;

/** Members that return a promise: authenticated HTTP helpers and state. */
export const ASYNC_BRIDGE_METHODS = [
  'fetch',
  'post',
  'put',
  'patch',
  'delete',
  'graphql',
  'fetchAllPages',
  'fetchWithCursor',
  'fetchWithLinkHeader',
  'getState',
  'setState',
] as const;

type BridgeMethod =
  | (typeof SYNC_BRIDGE_METHODS)[number]
  | (typeof ASYNC_BRIDGE_METHODS)[number];

const ALLOWED = new Set<string>([
  ...SYNC_BRIDGE_METHODS,
  ...ASYNC_BRIDGE_METHODS,
]);

function isBridgeMethod(value: string): value is BridgeMethod {
  return ALLOWED.has(value);
}

function parseArgs(argsJson: string): unknown[] {
  const parsed: unknown = JSON.parse(argsJson);
  if (!Array.isArray(parsed)) {
    throw new Error('Sandbox bridge arguments must be an array');
  }
  return parsed;
}

function invoke({
  ctx,
  method,
  args,
}: {
  ctx: CheckContext;
  method: BridgeMethod;
  args: unknown[];
}): unknown {
  const fn = ctx[method] as (...fnArgs: unknown[]) => unknown;
  return fn.apply(ctx, args);
}

function toJson(value: unknown): string | undefined {
  return value === undefined ? undefined : JSON.stringify(value);
}

/**
 * Host-side dispatcher. Runs in the Node isolate; receives (method, argsJson)
 * from the sandbox and returns a JSON string (or undefined).
 */
export function createHostDispatcher(ctx: CheckContext) {
  return {
    callSync(method: string, argsJson: string): string | undefined {
      if (!isBridgeMethod(method) || !SYNC_BRIDGE_METHODS.some((m) => m === method)) {
        throw new Error(`ctx.${method} is not available in code steps`);
      }
      return toJson(invoke({ ctx, method, args: parseArgs(argsJson) }));
    },
    async callAsync(method: string, argsJson: string): Promise<string | undefined> {
      if (!isBridgeMethod(method) || !ASYNC_BRIDGE_METHODS.some((m) => m === method)) {
        throw new Error(`ctx.${method} is not available in code steps`);
      }
      const result = await invoke({ ctx, method, args: parseArgs(argsJson) });
      return toJson(result);
    },
  };
}

/** Read-only ctx data copied into the sandbox. */
export function ctxDataSnapshot(ctx: CheckContext): Record<string, unknown> {
  return {
    accessToken: ctx.accessToken,
    credentials: ctx.credentials,
    variables: ctx.variables,
    connectionId: ctx.connectionId,
    organizationId: ctx.organizationId,
    checkId: ctx.checkId,
    metadata: ctx.metadata,
  };
}

/**
 * Bootstrap evaluated inside the isolate. It captures the host references,
 * removes them from the global object, and builds a frozen `ctx` plus a
 * `console` shim that routes to ctx.log/warn/error. It then compiles the
 * user code with the isolate's own AsyncFunction constructor and returns the
 * (possibly mutated) scope so the host can copy it back.
 */
export function buildSandboxSource(): string {
  const syncList = JSON.stringify(SYNC_BRIDGE_METHODS);
  const asyncList = JSON.stringify(ASYNC_BRIDGE_METHODS);
  return `
(async () => {
  const callSync = globalThis.__callSync;
  const callAsync = globalThis.__callAsync;
  const code = globalThis.__code;
  const scope = globalThis.__scope;
  const data = globalThis.__ctxData;
  for (const key of ['__callSync', '__callAsync', '__code', '__scope', '__ctxData']) {
    delete globalThis[key];
  }
  const decode = (value) => (value === undefined ? undefined : JSON.parse(value));
  const ctx = { ...data };
  for (const name of ${syncList}) {
    ctx[name] = (...args) =>
      decode(callSync.applySync(undefined, [name, JSON.stringify(args)], { arguments: { copy: true }, result: { copy: true } }));
  }
  for (const name of ${asyncList}) {
    ctx[name] = async (...args) =>
      decode(await callAsync.apply(undefined, [name, JSON.stringify(args)], { arguments: { copy: true }, result: { copy: true, promise: true } }));
  }
  Object.freeze(ctx);
  const format = (args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  globalThis.console = Object.freeze({
    log: (...a) => ctx.log(format(a)),
    info: (...a) => ctx.log(format(a)),
    debug: (...a) => ctx.log(format(a)),
    warn: (...a) => ctx.warn(format(a)),
    error: (...a) => ctx.error(format(a)),
  });
  const AsyncFunction = (async function () {}).constructor;
  const fn = new AsyncFunction('ctx', 'scope', code);
  await fn(ctx, scope);
  return scope;
})()`;
}
