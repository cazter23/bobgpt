// Save all chats and folders (with their images) to a file, and read such a file back.
import type { ChatMessage } from './api';
import { getImages, imageIdsIn } from './images';
import type { Chat, Folder } from './storage';

const FORMAT = 'bobgpt-backup';

/** Version 2 added `images`: id -> data URL, for the images the chats use. Version 1 files still restore. */
export async function downloadBackup(chats: Chat[], folders: Folder[]) {
  const images = Object.fromEntries(await getImages([...imageIdsIn(chats)]));
  const data = { format: FORMAT, version: 2, exportedAt: new Date().toISOString(), chats, folders, images };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bobgpt-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const isString = (v: unknown): v is string => typeof v === 'string';

function cleanMessage(m: any, images: Record<string, string>): ChatMessage | null {
  if (!m || (m.role !== 'user' && m.role !== 'assistant') || !isString(m.content)) return null;
  const out: ChatMessage = { role: m.role, content: m.content };
  const ids = Array.isArray(m.images) ? m.images.filter((id: unknown) => isString(id) && Object.hasOwn(images, id)) : [];
  if (m.role === 'user' && ids.length) out.images = ids;
  if (m.trimmed === true) out.trimmed = true;
  if (isString(m.thinking) && m.thinking) out.thinking = m.thinking;
  if (typeof m.thoughtSeconds === 'number') out.thoughtSeconds = m.thoughtSeconds;
  if (typeof m.tokensPerSecond === 'number') out.tokensPerSecond = m.tokensPerSecond;
  return out;
}

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

  const images: Record<string, string> = {};
  if (data.images && typeof data.images === 'object') {
    for (const [id, url] of Object.entries(data.images)) {
      if (isString(url) && url.startsWith('data:image/')) images[id] = url;
    }
  }

  const folders: Folder[] = (Array.isArray(data.folders) ? data.folders : [])
    .filter((f: any) => f && isString(f.id) && isString(f.name))
    .map((f: any) => ({ id: f.id, name: f.name, collapsed: !!f.collapsed }));
  const folderIds = new Set(folders.map((f) => f.id));

  const chats: Chat[] = data.chats
    .filter((c: any) => c && isString(c.id) && isString(c.title) && Array.isArray(c.messages))
    .map((c: any) => ({
      id: c.id,
      title: c.title,
      messages: c.messages.map((m: any) => cleanMessage(m, images)).filter((m: ChatMessage | null): m is ChatMessage => !!m),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
      folderId: isString(c.folderId) && folderIds.has(c.folderId) ? c.folderId : null,
    }))
    .filter((c: Chat) => c.messages.length > 0);

  return { chats, folders, images };
}
