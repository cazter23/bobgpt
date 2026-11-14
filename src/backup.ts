// Save all chats and folders to a file, and read such a file back.
import type { ChatMessage } from './api';
import type { Chat, Folder } from './storage';

const FORMAT = 'bobgpt-backup';

export function downloadBackup(chats: Chat[], folders: Folder[]) {
  const data = { format: FORMAT, version: 1, exportedAt: new Date().toISOString(), chats, folders };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `bobgpt-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const isString = (v: unknown): v is string => typeof v === 'string';

function cleanMessage(m: any): ChatMessage | null {
  if (!m || (m.role !== 'user' && m.role !== 'assistant') || !isString(m.content)) return null;
  const out: ChatMessage = { role: m.role, content: m.content };
  if (m.trimmed === true) out.trimmed = true;
  if (isString(m.thinking) && m.thinking) out.thinking = m.thinking;
  if (typeof m.thoughtSeconds === 'number') out.thoughtSeconds = m.thoughtSeconds;
  if (typeof m.tokensPerSecond === 'number') out.tokensPerSecond = m.tokensPerSecond;
  return out;
}

/** Reads a backup file. Throws an Error with a plain-English message if it isn't one. */
export async function readBackup(file: File): Promise<{ chats: Chat[]; folders: Folder[] }> {
  let data: any;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a BobGPT backup (it couldn't be read).");
  }
  if (!data || data.format !== FORMAT || !Array.isArray(data.chats)) {
    throw new Error("That file isn't a BobGPT backup.");
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
      messages: c.messages.map(cleanMessage).filter((m: ChatMessage | null): m is ChatMessage => !!m),
      updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
      folderId: isString(c.folderId) && folderIds.has(c.folderId) ? c.folderId : null,
    }))
    .filter((c: Chat) => c.messages.length > 0);

  return { chats, folders };
}
