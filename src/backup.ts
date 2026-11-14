// Save all chats and folders (with their images) to a file, and read such a file back.
import { getImages, imageIdsIn } from './images';
import { cleanChat, type Chat, type Folder } from './storage';

const FORMAT = 'bobgpt-backup';
const VERSION = 2; // the newest format this version of the app writes and can read

/** Version 2 added `images`: id -> data URL, for the images the chats use. Version 1 files still restore. */
export async function downloadBackup(chats: Chat[], folders: Folder[]) {
  const images = Object.fromEntries(await getImages([...imageIdsIn(chats)]));
  const data = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), chats, folders, images };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bobgpt-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const isString = (v: unknown): v is string => typeof v === 'string';

/** Reads a backup file. Throws an Error with a plain-English message if it isn't one. */
export async function readBackup(file: File): Promise<{ chats: Chat[]; folders: Folder[]; images: Record<string, string> }> {
  let data: any;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a BobGPT backup (it couldn't be read).");
  }
  if (!data || data.format !== FORMAT || !Array.isArray(data.chats)) {
    throw new Error("That file isn't a BobGPT backup.");
  }
  // A newer format might mean things this version doesn't understand, so it isn't half-restored.
  if (typeof data.version === 'number' && data.version > VERSION) {
    throw new Error("That backup was made by a newer version of BobGPT, so this version can't restore it.");
  }

  const images: Record<string, string> = {};
  if (data.images && typeof data.images === 'object') {
    for (const [id, url] of Object.entries(data.images)) {
      if (isString(url) && url.startsWith('data:image/')) images[id] = url;
    }
  }

  const folders: Folder[] = firstOfEachId(
    (Array.isArray(data.folders) ? data.folders : [])
      .filter((f: any) => f && isString(f.id) && isString(f.name))
      .map((f: any) => ({ id: f.id, name: f.name, collapsed: !!f.collapsed })),
  );
  const folderIds = new Set(folders.map((f) => f.id));

  // The same checks as for the chats saved in this browser (storage.ts).
  const chats = firstOfEachId(
    (data.chats as unknown[])
      .map((c) => cleanChat(c, { hasImage: (id) => Object.hasOwn(images, id), hasFolder: (id) => folderIds.has(id) }))
      .filter((c): c is Chat => !!c),
  );

  return { chats, folders, images };
}

/** Leaves out any item whose id came earlier in the list (a backup file shouldn't repeat one, but might if edited by hand). */
function firstOfEachId<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
}
