import { describe, expect, it } from 'vitest';
import type { CheckContext } from '../../types';
import { runCodeInSandbox, writeBackScope } from '../code-sandbox';

interface TestCtx {
  ctx: CheckContext;
  logs: string[];
  passes: unknown[];
  fetched: string[];
}

function createCtx(): TestCtx {
  const logs: string[] = [];
  const passes: unknown[] = [];
  const fetched: string[] = [];
  const unused = async () => {
    throw new Error('not used');
  };
  const ctx: CheckContext = {
    accessToken: 'secret-token',
    credentials: { apiKey: 'k' },
    variables: {},
    connectionId: 'conn-1',
    organizationId: 'org-1',
    metadata: {},
    log: (msg) => logs.push(msg),
    warn: (msg) => logs.push(`WARN: ${msg}`),
    error: (msg) => logs.push(`ERROR: ${msg}`),
    pass: (result) => passes.push(result),
    fail: () => undefined,
    addPassingResult: () => undefined,
    addFinding: () => undefined,
    fetch: async <T>(path: string): Promise<T> => {
      fetched.push(path);
      return { path, items: [1, 2, 3] } as T;
    },
    post: unused,
    put: unused,
    patch: unused,
    delete: unused,
    graphql: unused,
    fetchAllPages: unused,
    fetchWithCursor: unused,
    fetchWithLinkHeader: unused,
    getState: async () => null,
    setState: async () => undefined,
  };
  return { ctx, logs, passes, fetched };
}

async function run(code: string, scope: Record<string, unknown> = {}) {
  const t = createCtx();
  await runCodeInSandbox({ code, scope, ctx: t.ctx });
  return { ...t, scope };
}

describe('runCodeInSandbox — isolation', () => {
  it('cannot read process.env', async () => {
    const { scope } = await run(`scope.processType = typeof process;`);
    expect(scope.processType).toBe('undefined');
    await expect(run(`scope.x = process.env.DATABASE_URL;`)).rejects.toThrow(
      /process is not defined/,
    );
  });

  it('cannot require modules', async () => {
    await expect(run(`require('fs');`)).rejects.toThrow(/require is not defined/);
    const { scope } = await run(
      `scope.types = [typeof require, typeof module, typeof globalThis.process];`,
    );
    expect(scope.types).toEqual(['undefined', 'undefined', 'undefined']);
  });

  it('has no global fetch, timers or host bridge globals', async () => {
    const { scope } = await run(`
      scope.globals = [typeof fetch, typeof setTimeout, typeof __callSync, typeof __callAsync];
    `);
    expect(scope.globals).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  });

  it('cannot escape through the Function constructor', async () => {
    const { scope } = await run(
      `scope.p = typeof (new Function('return this')()).process;`,
    );
    expect(scope.p).toBe('undefined');
  });

  it('rejects ctx members outside the bridge allowlist', async () => {
    await expect(run(`ctx.constructor.constructor('return process')();`)).rejects.toThrow();
  });
});

describe('runCodeInSandbox — limits', () => {
  it('times out a synchronous infinite loop', async () => {
    const t = createCtx();
    await expect(
      runCodeInSandbox({
        code: 'while (true) {}',
        scope: {},
        ctx: t.ctx,
        cpuTimeoutMs: 200,
      }),
    ).rejects.toThrow(/timed out|time limit/i);
  });

  it('times out an infinite loop after an await', async () => {
    const t = createCtx();
    await expect(
      runCodeInSandbox({
        code: `await ctx.fetch('/x'); while (true) {}`,
        scope: {},
        ctx: t.ctx,
        cpuTimeoutMs: 200,
        wallTimeoutMs: 5_000,
      }),
    ).rejects.toThrow(/time limit/i);
  });

  it('enforces the memory limit', async () => {
    const t = createCtx();
    await expect(
      runCodeInSandbox({
        code: `const a = []; while (true) { a.push(new Array(1e6).fill(1)); }`,
        scope: {},
        ctx: t.ctx,
        memoryLimitMb: 16,
        cpuTimeoutMs: 20_000,
      }),
    ).rejects.toThrow(/memory|disposed|terminated/i);
  }, 30_000);
});

describe('runCodeInSandbox — scope and ctx bridge', () => {
  it('copies added, updated and deleted scope keys back', async () => {
    const { scope } = await run(
      `scope.added = scope.count + 1; scope.count = 10; delete scope.gone;`,
      { count: 1, gone: true },
    );
    expect(scope).toEqual({ count: 10, added: 2 });
  });

  it('works on a copy: host objects are not shared by reference', async () => {
    const original = { nested: { value: 1 } };
    const scope: Record<string, unknown> = { original };
    await run(`scope.original.nested.value = 2;`, scope);
    expect(original.nested.value).toBe(1);
    expect(scope.original).toEqual({ nested: { value: 2 } });
  });

  it('bridges async ctx.fetch and sync ctx.pass/log', async () => {
    const { scope, passes, logs, fetched } = await run(`
      const [a, b] = await Promise.all([ctx.fetch('/a'), ctx.fetch('/b')]);
      scope.total = a.items.length + b.items.length;
      ctx.pass({ title: 'ok', resourceType: 't', resourceId: '1' });
      console.log('hello', { n: 1 });
      scope.org = ctx.organizationId;
    `);
    expect(scope.total).toBe(6);
    expect(scope.org).toBe('org-1');
    expect(fetched).toEqual(['/a', '/b']);
    expect(passes).toEqual([{ title: 'ok', resourceType: 't', resourceId: '1' }]);
    expect(logs).toContain('hello {"n":1}');
  });

  it('propagates host errors from ctx.fetch into the sandbox', async () => {
    const t = createCtx();
    t.ctx.fetch = async () => {
      throw new Error('HTTP 404');
    };
    await expect(
      runCodeInSandbox({ code: `await ctx.fetch('/missing');`, scope: {}, ctx: t.ctx }),
    ).rejects.toThrow('HTTP 404');
  });

  it('ignores prototype-polluting keys on write-back', () => {
    const target: Record<string, unknown> = {};
    const result = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}');
    writeBackScope({ target, result });
    expect(target.ok).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
  });
});
