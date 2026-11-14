import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bot, chat, user } from './helpers';

const URL_A = 'data:image/jpeg;base64,AAAA';
const URL_B = 'data:image/jpeg;base64,BBBB';

// images.ts keeps some state in the module (what's in memory, what's stored), so each test gets a fresh copy.
// The pretend IndexedDB outlives the module, like a real browser's does across a page reload.
let images: typeof import('../src/images');
beforeEach(async () => {
  vi.resetModules();
  images = await import('../src/images');
});

describe('images in memory', () => {
  it('gives each image its own id and returns it', async () => {
    const a = images.addImage(URL_A);
    const b = images.addImage(URL_B);
    expect(a).not.toBe(b);
    expect(await images.getImage(a)).toBe(URL_A);
  });

  it('forgets an image that is let go, and says undefined for one that never existed', async () => {
    const a = images.addImage(URL_A);
    images.forgetImages([a]);
    expect(await images.getImage(a)).toBeUndefined();
    expect(await images.getImage('never-existed')).toBeUndefined();
  });

  it('never writes an image to storage until asked (incognito images stay in memory)', async () => {
    const id = images.addImage(URL_A);
    expect(await dbHas(id)).toBe(false);
  });
});

async function dbHas(id: string): Promise<boolean> {
  vi.resetModules();
  const other = await import('../src/images'); // a "reloaded page": nothing in memory, only what was stored
  return (await other.getImage(id)) !== undefined;
}

describe('images in IndexedDB', () => {
  it('survives a page reload once stored', async () => {
    const id = images.addImage(URL_A);
    await images.storeImages([id]);
    expect(await dbHas(id)).toBe(true);
  });

  it('stores restored backup images under their own ids', async () => {
    await images.storeImageData({ restored: URL_B });
    expect(await dbHas('restored')).toBe(true);
  });

  it('ignores ids that are not in memory', async () => {
    await expect(images.storeImages(['nope'])).resolves.toBeUndefined();
  });

  it('reads several at once and leaves out the missing ones', async () => {
    const id = images.addImage(URL_A);
    const found = await images.getImages([id, id, 'missing']);
    expect([...found.keys()]).toEqual([id]);
  });
});

describe('pruneImages', () => {
  it('deletes stored images that no chat uses and keeps the ones in use', async () => {
    await images.storeImageData({ used: URL_A, unused: URL_B });
    // Stored long enough ago that they are not "just stored": simulate a fresh page load.
    vi.resetModules();
    const reloaded = await import('../src/images');
    await reloaded.pruneImages(() => new Set(['used']));
    vi.resetModules();
    const again = await import('../src/images');
    expect(await again.getImage('used')).toBe(URL_A);
    expect(await again.getImage('unused')).toBeUndefined();
  });

  it('leaves alone an image stored a moment ago that no saved chat uses yet', async () => {
    const id = images.addImage(URL_A);
    await images.storeImages([id]);
    await images.pruneImages(() => new Set());
    expect(await dbHas(id)).toBe(true);
  });
});

describe('imageIdsIn', () => {
  it('lists every image id the chats use, once', () => {
    const ids = images.imageIdsIn([
      chat('a', [user('x', { images: ['1', '2'] }), bot('y')]),
      chat('b', [user('z', { images: ['2', '3'] })]),
    ]);
    expect([...ids].sort()).toEqual(['1', '2', '3']);
  });
});
