// The service worker (public/sw.js), run against a stand-in browser: a fake cache and a fake network.
// A real browser can't be driven from here, so this checks the logic: what it saves, what it serves when offline,
// and, above all, what it leaves alone (LM Studio, anything that isn't a plain GET of the app's own files).
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'http://app.test';
const code = readFileSync('public/sw.js', 'utf8');

type FakeEvent = {
  request: { method: string; url: string; mode: string };
  respondWith(p: Promise<Response> | Response): void;
  waitUntil(p: Promise<unknown>): void;
  response?: Promise<Response> | Response;
  waits: Promise<unknown>[];
};

function loadWorker() {
  const listeners: Record<string, (e: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const urlOf = (key: string | { url: string }) => new URL(typeof key === 'string' ? key : key.url, ORIGIN).href;

  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        put: async (key: string | { url: string }, res: Response) => void store.set(urlOf(key), res),
        keys: async () => [...store.keys()].map((url) => ({ url })),
        delete: async (key: string | { url: string }) => store.delete(urlOf(key)),
      };
    },
    match: async (key: string | { url: string }) => {
      for (const store of stores.values()) {
        const hit = store.get(urlOf(key));
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };

  const network = { online: true, requests: [] as string[], status: 200 };
  const fetchFn = async (req: string | { url: string }) => {
    network.requests.push(urlOf(req));
    if (!network.online) throw new TypeError('Failed to fetch');
    return new Response(`body of ${urlOf(req)}`, { status: network.status });
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: (e: any) => void) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  new Function('self', 'caches', 'fetch', code)(self, caches, fetchFn);

  async function fetchEvent(url: string, { method = 'GET', mode = 'no-cors' } = {}) {
    const event: FakeEvent = {
      request: { method, url, mode },
      waits: [],
      respondWith(p) {
        event.response = p;
      },
      waitUntil(p) {
        event.waits.push(p);
      },
    };
    listeners.fetch(event);
    await Promise.all(event.waits);
    return { handled: event.response !== undefined, response: event.response ? await event.response : undefined };
  }

  return { listeners, stores, network, caches, fetchEvent };
}

let sw: ReturnType<typeof loadWorker>;
beforeEach(() => {
  sw = loadWorker();
});

describe('what the service worker leaves alone', () => {
  it('never touches requests to LM Studio (a different address)', async () => {
    const { handled } = await sw.fetchEvent('http://localhost:1234/v1/chat/completions');
    expect(handled).toBe(false);
    expect((await sw.fetchEvent('http://localhost:1234/api/v0/models')).handled).toBe(false);
    expect(sw.stores.size).toBe(0);
  });

  it('never touches anything but plain GETs', async () => {
    expect((await sw.fetchEvent(`${ORIGIN}/assets/x.js`, { method: 'POST' })).handled).toBe(false);
    expect((await sw.fetchEvent(`${ORIGIN}/`, { method: 'PUT', mode: 'navigate' })).handled).toBe(false);
  });

  it('does not keep files that are not the page or its /assets/', async () => {
    expect((await sw.fetchEvent(`${ORIGIN}/something-else.json`)).handled).toBe(false);
    expect(sw.stores.size).toBe(0);
  });

  it('never stores anything from a request to another address, even by accident', async () => {
    await sw.fetchEvent('https://example.com/assets/tracker.js');
    expect(sw.stores.size).toBe(0);
  });
});

describe('the page', () => {
  it('asks the server first, and saves a copy for later', async () => {
    const { response } = await sw.fetchEvent(`${ORIGIN}/`, { mode: 'navigate' });
    expect(await response!.text()).toBe(`body of ${ORIGIN}/`);
    expect(sw.network.requests).toEqual([`${ORIGIN}/`]);
    expect(await sw.caches.match('/index.html')).toBeDefined();
  });

  it('opens from the saved copy when the server is off', async () => {
    await sw.fetchEvent(`${ORIGIN}/`, { mode: 'navigate' });
    sw.network.online = false;
    const { response } = await sw.fetchEvent(`${ORIGIN}/`, { mode: 'navigate' });
    expect(await response!.text()).toBe(`body of ${ORIGIN}/`);
  });

  it('always prefers the server when it is there, so a rebuilt app arrives at once', async () => {
    await sw.fetchEvent(`${ORIGIN}/`, { mode: 'navigate' });
    sw.network.requests.length = 0;
    await sw.fetchEvent(`${ORIGIN}/`, { mode: 'navigate' });
    expect(sw.network.requests).toEqual([`${ORIGIN}/`]);
  });

  it('does not save a server error page as the app', async () => {
    sw.network.status = 500;
    await sw.fetchEvent(`${ORIGIN}/`, { mode: 'navigate' });
    expect(await sw.caches.match('/index.html')).toBeUndefined();
  });

  it('has nothing to show when offline and never opened before', async () => {
    sw.network.online = false;
    const { response } = await sw.fetchEvent(`${ORIGIN}/`, { mode: 'navigate' });
    expect(response).toBeUndefined();
  });
});

describe('the app files in /assets/', () => {
  it('are fetched once, then served from the saved copy', async () => {
    const url = `${ORIGIN}/assets/index-abc123.js`;
    await sw.fetchEvent(url);
    expect(sw.network.requests).toEqual([url]);
    const again = await sw.fetchEvent(url);
    expect(await again.response!.text()).toBe(`body of ${url}`);
    expect(sw.network.requests).toEqual([url]); // no second trip to the server
  });

  it('are still served when the server is off', async () => {
    const url = `${ORIGIN}/assets/font-xyz.woff2`;
    await sw.fetchEvent(url);
    sw.network.online = false;
    expect(await (await sw.fetchEvent(url)).response!.text()).toBe(`body of ${url}`);
  });

  it('are not saved when the server returns an error', async () => {
    sw.network.status = 404;
    await sw.fetchEvent(`${ORIGIN}/assets/missing.js`);
    expect(await sw.caches.match('/assets/missing.js')).toBeUndefined();
  });

  it('are kept to a limited number, dropping the oldest first', async () => {
    for (let i = 0; i < 170; i++) await sw.fetchEvent(`${ORIGIN}/assets/file-${i}.js`);
    const [store] = [...sw.stores.values()];
    expect(store.size).toBe(150);
    expect(await sw.caches.match('/assets/file-0.js')).toBeUndefined();
    expect(await sw.caches.match('/assets/file-169.js')).toBeDefined();
  });
});

describe('updating', () => {
  it('removes saved copies left by an older version of the worker when it takes over', async () => {
    await (await sw.caches.open('bobgpt-v0')).put('/assets/old.js', new Response('old'));
    await (await sw.caches.open('something-else')).put('/x', new Response('x'));
    const waits: Promise<unknown>[] = [];
    sw.listeners.activate({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    expect([...sw.stores.keys()]).not.toContain('bobgpt-v0');
  });
});
