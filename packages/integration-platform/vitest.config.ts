import { defineConfig } from 'vitest/config';

// DSL tests run under Node (not `bun test`) because code steps execute in
// isolated-vm, a native V8 addon that Bun cannot load. isolated-vm requires
// --no-node-snapshot on Node 20+.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/dsl/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { execArgv: ['--no-node-snapshot'] },
    },
  },
});
