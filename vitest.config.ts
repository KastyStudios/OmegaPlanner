import { defineConfig } from 'vitest/config';

// Fixed timezone with DST so recurrence tests are deterministic.
process.env.TZ = 'Europe/Amsterdam';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'mcp/test/**/*.test.ts'],
  },
});
