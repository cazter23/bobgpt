import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  resolve: {
    alias: {
      // The LM Studio SDK expects Node's `process`; give the browser a small stand-in.
      process: fileURLToPath(new URL('./src/process-shim.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom', // a pretend browser, so localStorage, IndexedDB and React can be used
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
