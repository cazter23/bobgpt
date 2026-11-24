// Saved chats and sidebar size, kept in this browser's localStorage.
import type { ChatMessage } from './api';

export type Chat = {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
  folderId?: string | null; // which folder it sits in; none = the main list
};

export type Folder = {
  id: string;
  name: string;
  collapsed: boolean;
};

export type SidebarSize = 'large' | 'medium' | 'hidden';

// The "homegpt-" names are from before the app was called BobGPT. Changing them would lose saved data.
export const CHATS_KEY = 'homegpt-chats';
export const FOLDERS_KEY = 'homegpt-folders';
const SIDEBAR_KEY = 'homegpt-sidebar';

/** The name of a chat started from a folder's menu, until you rename it or send a first message. */
export const UNNAMED_CHAT = 'Unnamed chat';

const isString = (v: unknown): v is string => typeof v === 'string';

/**
 * A saved (or restored) message with anything unexpected left out, or null if it isn't a message.
 * `hasImage` says which image ids to keep.
 */
export function cleanMessage(value: unknown, hasImage: (id: string) => boolean = () => true): ChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const m = value as Record<string, unknown>;
  if ((m.role !== 'user' && m.role !== 'assistant') || !isString(m.content)) return null;
  // Chats saved before messages had ids get one here (and keep it from the next save on).
  const out: ChatMessage = { id: isString(m.id) && m.id ? m.id : crypto.randomUUID(), role: m.role, content: m.content };
  const ids = Array.isArray(m.images) ? m.images.filter((id): id is string => isString(id) && hasImage(id)) : [];
  if (m.role === 'user' && ids.length) out.images = ids;
  if (m.trimmed === true) out.trimmed = true;
  if (isString(m.thinking) && m.thinking) out.thinking = m.thinking;
  if (typeof m.thoughtSeconds === 'number') out.thoughtSeconds = m.thoughtSeconds;
  if (typeof m.tokensPerSecond === 'number') out.tokensPerSecond = m.tokensPerSecond;
  return out;
}

/**
 * A saved (or restored) chat with only its valid messages, or null if it isn't a chat or has no messages left.
 * `hasFolder` says which folder ids to keep (a chat whose folder is gone goes to the main list).
 */
export function cleanChat(
  value: unknown,
  check: { hasImage?: (id: string) => boolean; hasFolder?: (id: string) => boolean } = {},
): Chat | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (!isString(c.id) || !isString(c.title) || !Array.isArray(c.messages)) return null;
  const messages = c.messages.map((m) => cleanMessage(m, check.hasImage)).filter((m): m is ChatMessage => !!m);
  // A chat with nothing in it is kept only if it was empty when saved and has been given a name of its own.
  if (messages.length === 0 && (c.messages.length > 0 || c.title === UNNAMED_CHAT)) return null;
  // Each message in a chat needs its own id (a hand-edited file might repeat one).
  const seen = new Set<string>();
  for (const m of messages) {
    if (seen.has(m.id)) m.id = crypto.randomUUID();
    seen.add(m.id);
  }
  return {
    id: c.id,
    title: c.title,
    messages,
    updatedAt: typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt) ? c.updatedAt : Date.now(),
    folderId: isString(c.folderId) && (check.hasFolder?.(c.folderId) ?? true) ? c.folderId : null,
  };
}

/** Where saved chats that couldn't be read were set aside (if they could be). */
let unreadable: { copiedTo: string | null; blocked: boolean } | null = null;

/**
 * True if the saved chats couldn't be read when the app started. They're kept as they were (under
 * `copiedTo`, or, if even that wasn't possible, by not saving chats at all), and their images aren't tidied up.
 */
export function savedChatsUnreadable(): { copiedTo: string | null; blocked: boolean } | null {
  return unreadable;
}

export function loadChats(): Chat[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(CHATS_KEY);
  } catch {
    unreadable ??= { copiedTo: null, blocked: true }; // nothing can be saved anyway
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('not a list');
  } catch {
    // Keep a copy before anything is saved over it, so it can still be rescued by hand.
    if (!unreadable) {
      const key = `${CHATS_KEY}-unreadable-${new Date().toISOString().slice(0, 19)}`;
      try {
        localStorage.setItem(key, raw);
        unreadable = { copiedTo: key, blocked: false };
      } catch {
        unreadable = { copiedTo: null, blocked: false };
      }
    }
    return [];
  }
  return parsed.map((c) => cleanChat(c)).filter((c): c is Chat => !!c);
}

/** Returns false if the browser refused (storage full or blocked), or if saving would overwrite unreadable chats. */
export function saveChats(chats: Chat[]): boolean {
  if (unreadable && !unreadable.copiedTo) return false;
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    return true;
  } catch {
    return false;
  }
}

export function loadFolders(): Folder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '[]');
    const valid = (f: Folder) => !!f && typeof f.id === 'string' && typeof f.name === 'string';
    return Array.isArray(parsed) ? parsed.filter(valid).map((f) => ({ ...f, collapsed: !!f.collapsed })) : [];
  } catch {
    return [];
  }
}

export function saveFolders(folders: Folder[]): boolean {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    return true;
  } catch {
    return false;
  }
}

export function loadSidebarSize(): SidebarSize {
  try {
    const value = localStorage.getItem(SIDEBAR_KEY);
    return value === 'large' || value === 'hidden' ? value : 'medium';
  } catch {
    return 'medium';
  }
}

export function saveSidebarSize(size: SidebarSize) {
  try {
    localStorage.setItem(SIDEBAR_KEY, size);
  } catch {
    // Not remembering the size is harmless.
  }
}

/** A chat's name: the start of its first message. */
export function titleFrom(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return 'New chat';
  return oneLine.length > 40 ? `${oneLine.slice(0, 40).trimEnd()}…` : oneLine;
}
