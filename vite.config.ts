import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // The built app is served on the same address as the dev server, so saved chats (kept per address by the browser) are
  // the same in both. BOBGPT_PORT only exists so the launcher can be tested without disturbing a running dev server.
  preview: { port: Number(process.env.BOBGPT_PORT) || 5173, strictPort: true },
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
