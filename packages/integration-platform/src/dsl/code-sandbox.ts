import type IsolatedVM from 'isolated-vm';
import type { CheckContext } from '../types';
import {
  buildSandboxSource,
  createHostDispatcher,
  ctxDataSnapshot,
} from './code-sandbox-bridge';

/**
 * Runs DSL `code` steps inside an isolated-vm V8 isolate (S2).
 *
 * The isolate has only the JavaScript built-ins: no `process`, `require`,
 * `fetch`, timers or Node globals. Code sees a structured-clone copy of
 * `scope` and a minimal `ctx` bridge (see code-sandbox-bridge.ts). Mutated
 * scope keys are copied back to the host scope afterwards.
 *
 * Node 20+ must run with `--no-node-snapshot` for isolated-vm (see the API
 * Dockerfiles). Bun cannot load isolated-vm, so code steps fail closed there.
 */

export const CODE_STEP_MEMORY_LIMIT_MB = 128;
/** CPU time the isolate may burn. */
export const CODE_STEP_CPU_TIMEOUT_MS = 30_000;
/** Wall-clock ceiling, including time spent awaiting ctx.fetch & co. */
export const CODE_STEP_WALL_TIMEOUT_MS = 120_000;

const CPU_POLL_INTERVAL_MS = 50;
const ISOLATED_VM_MODULE = 'isolated-vm';
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface RunCodeInSandboxOptions {
  code: string;
  scope: Record<string, unknown>;
  ctx: CheckContext;
  memoryLimitMb?: number;
  cpuTimeoutMs?: number;
  wallTimeoutMs?: number;
}

function loadIsolatedVm(): typeof IsolatedVM {
  if (typeof process !== 'undefined' && process.versions?.bun) {
    throw new Error(
      'DSL code steps require Node.js (isolated-vm); they cannot run under Bun',
    );
  }
  // Indirect require with a non-literal id so web/trigger bundlers never try
  // to bundle the native addon. Code steps only ever run in the API (Node).
  const nodeRequire: (id: string) => unknown = require;
  return nodeRequire(ISOLATED_VM_MODULE) as typeof IsolatedVM;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copy the sandbox's scope back onto the host scope (adds, updates, deletes). */
export function writeBackScope({
  target,
  result,
}: {
  target: Record<string, unknown>;
  result: unknown;
}): void {
  if (!isPlainRecord(result)) {
    throw new Error('Code step must leave `scope` as an object');
  }
  for (const key of Object.keys(target)) {
    if (!(key in result)) delete target[key];
  }
  for (const [key, value] of Object.entries(result)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    target[key] = value;
  }
}

function watchLimits({
  isolate,
  cpuTimeoutMs,
  wallTimeoutMs,
}: {
  isolate: IsolatedVM.Isolate;
  cpuTimeoutMs: number;
  wallTimeoutMs: number;
}): { promise: Promise<never>; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | undefined;
  const startedAt = Date.now();
  const cpuLimitNs = BigInt(cpuTimeoutMs) * 1_000_000n;
  const promise = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      if (isolate.isDisposed) return;
      const cpuExceeded = isolate.cpuTime > cpuLimitNs;
      const wallExceeded = Date.now() - startedAt > wallTimeoutMs;
      if (!cpuExceeded && !wallExceeded) return;
      isolate.dispose();
      reject(
        new Error(
          cpuExceeded
            ? `Code step exceeded CPU time limit of ${cpuTimeoutMs}ms`
            : `Code step exceeded time limit of ${wallTimeoutMs}ms`,
        ),
      );
    }, CPU_POLL_INTERVAL_MS);
  });
  // Handled by the Promise.race below; avoid an unhandled rejection if the
  // limit fires before the race is attached.
  promise.catch(() => undefined);
  return { promise, stop: () => clearInterval(timer) };
}

export async function runCodeInSandbox({
  code,
  scope,
  ctx,
  memoryLimitMb = CODE_STEP_MEMORY_LIMIT_MB,
  cpuTimeoutMs = CODE_STEP_CPU_TIMEOUT_MS,
  wallTimeoutMs = CODE_STEP_WALL_TIMEOUT_MS,
}: RunCodeInSandboxOptions): Promise<void> {
  const ivm = loadIsolatedVm();
  const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMb });
  const limits = watchLimits({ isolate, cpuTimeoutMs, wallTimeoutMs });

  try {
    const context = await isolate.createContext();
    const jail = context.global;
    const dispatcher = createHostDispatcher(ctx);

    await jail.set('__callSync', new ivm.Reference(dispatcher.callSync));
    await jail.set('__callAsync', new ivm.Reference(dispatcher.callAsync));
    await jail.set('__code', code);
    await jail.set('__scope', new ivm.ExternalCopy(scope).copyInto());
    await jail.set('__ctxData', new ivm.ExternalCopy(ctxDataSnapshot(ctx)).copyInto());

    const run = context.eval(buildSandboxSource(), {
      timeout: cpuTimeoutMs,
      promise: true,
      copy: true,
    });
    // If a limit wins the race, the disposed isolate rejects `run` later.
    run.catch(() => undefined);
    const result: unknown = await Promise.race([run, limits.promise]);
    writeBackScope({ target: scope, result });
  } catch (error) {
    if (isolate.isDisposed && !(error instanceof Error && /limit/.test(error.message))) {
      throw new Error(
        `Code step was terminated (memory limit ${memoryLimitMb}MB or time limit reached): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    throw error;
  } finally {
    limits.stop();
    if (!isolate.isDisposed) isolate.dispose();
  }
}
