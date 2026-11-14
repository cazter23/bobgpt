import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The page's Content-Security-Policy (in index.html) is the built app's. The dev server needs two things more: its
 * live reload talks over a WebSocket on its own port, and React's live reload adds a small script to the page itself.
 * This adds those to the policy, only while `npm run dev` is serving the page.
 */
function devContentSecurityPolicy(): Plugin {
  return {
    name: 'bobgpt-dev-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      const meta = /(http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/;
      if (!meta.test(html)) throw new Error('index.html has no Content-Security-Policy to adjust for the dev server.');
      return html.replace(meta, (_, before: string, policy: string, after: string) => {
        const loosened = policy
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace(/connect-src ([^;]*)/, 'connect-src $1 ws://localhost:* ws://127.0.0.1:*');
        return before + loosened + after;
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devContentSecurityPolicy()],
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
