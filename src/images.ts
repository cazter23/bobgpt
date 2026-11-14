// Images attached to your messages. Each is shrunk when attached and then known by an id:
// kept in memory while the app is open and, for saved chats, in this browser's IndexedDB,
// because localStorage is too small for them. Incognito images are never written anywhere.
import { useEffect, useState } from 'react';

const MAX_SIDE = 1000; // pixels on the long side
const TARGET_BYTES = 200 * 1024;

/** How many bytes a base64 data URL holds. */
function dataUrlBytes(url: string): number {
  return Math.round(((url.length - url.indexOf(',') - 1) * 3) / 4);
}

/**
 * Shrinks an image to at most 1000 px on its long side (smaller ones keep their size) and saves it as a
 * JPEG of about 200 KB or less. Returns a data URL. Throws if the browser can't read the file.
 */
export async function shrinkImage(file: Blob): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Couldn't read that image.");
  // JPEG has no transparency, so see-through parts of a PNG become white rather than black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  // Lower the quality step by step until it's small enough.
  let url = '';
  for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    url = canvas.toDataURL('image/jpeg', quality);
    if (dataUrlBytes(url) <= TARGET_BYTES) break;
  }
  return url;
}

// --- In memory: every image used since the app was opened (the only place incognito images live) ---

const memory = new Map<string, string>(); // id -> data URL

/** Keeps a (shrunk) image in memory and returns its new id. Nothing is written to storage. */
export function addImage(url: string): string {
  const id = crypto.randomUUID();
  memory.set(id, url);
  return id;
}

/** Lets go of images held in memory (stored copies, if any, stay). */
export function forgetImages(ids: Iterable<string>) {
  for (const id of ids) memory.delete(id);
}

// --- In IndexedDB: the images of saved chats ---

const DB_NAME = 'homegpt-images';
const STORE = 'images';
let db: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.catch(() => (db = null)); // try again next time
  return db;
}

/** Runs one transaction on the image store and resolves with the request's result once it has finished. */
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const database = await openDb();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const stored = new Set<string>(); // ids known to be in IndexedDB already
const justStored = new Set<string>(); // written, but perhaps not yet part of a saved chat; never pruned

/** Writes images held in memory to IndexedDB (ones already there are skipped). Never use this for incognito chats. */
export async function storeImages(ids: string[]) {
  const entries = ids.filter((id) => !stored.has(id) && memory.has(id)).map((id) => [id, memory.get(id)!] as const);
  if (entries.length === 0) return;
  for (const [id] of entries) justStored.add(id);
  await transaction('readwrite', (store) => {
    for (const [id, url] of entries) store.put(url, id);
  });
  for (const [id] of entries) stored.add(id);
}

/** Adds images (id -> data URL, e.g. from a backup) to memory and IndexedDB. */
export async function storeImageData(images: Record<string, string>) {
  for (const [id, url] of Object.entries(images)) memory.set(id, url);
  await storeImages(Object.keys(images));
}

/** An image's data URL, from memory or IndexedDB. Undefined if it's gone. */
export async function getImage(id: string): Promise<string | undefined> {
  const known = memory.get(id);
  if (known) return known;
  const url = await transaction<string>('readonly', (store) => store.get(id));
  if (typeof url !== 'string') return undefined;
  memory.set(id, url);
  stored.add(id);
  return url;
}

/** Several images at once; missing ones are left out. */
export async function getImages(ids: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const id of new Set(ids)) {
    const url = await getImage(id);
    if (url) found.set(id, url);
  }
  return found;
}

/** For showing an image: its data URL, or undefined while it loads (or if it's gone). */
export function useImage(id: string): string | undefined {
  const [loaded, setLoaded] = useState<{ id: string; url: string } | null>(null);
  const known = memory.get(id);
  useEffect(() => {
    if (memory.has(id)) return;
    let live = true;
    getImage(id)
      .then((url) => live && url && setLoaded({ id, url }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return known ?? (loaded?.id === id ? loaded.url : undefined);
}

/** Every image id that saved chats refer to. */
export function imageIdsIn(chats: { messages: { images?: string[] }[] }[]): Set<string> {
  return new Set(chats.flatMap((c) => c.messages.flatMap((m) => m.images ?? [])));
}

/**
 * Deletes stored images that no saved chat uses any more (its chat or message was deleted,
 * or the chat was cut short by an edit or regenerate).
 * `inUse` is asked only after the stored images have been listed, so an image that another tab stored and
 * saved a chat with in the meantime is counted as used.
 */
export async function pruneImages(inUse: () => Set<string>) {
  const keys = ((await transaction('readonly', (store) => store.getAllKeys())) ?? []) as string[];
  const keep = inUse();
  for (const id of keys) if (keep.has(id)) justStored.delete(id);
  const unused = keys.filter((id) => !keep.has(id) && !justStored.has(id));
  if (unused.length === 0) return;
  await transaction('readwrite', (store) => {
    for (const id of unused) store.delete(id);
  });
  for (const id of unused) {
    stored.delete(id);
    memory.delete(id);
  }
}
