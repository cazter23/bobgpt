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

const CHATS_KEY = 'homegpt-chats';
const FOLDERS_KEY = 'homegpt-folders';
const SIDEBAR_KEY = 'homegpt-sidebar';

function isChat(value: unknown): value is Chat {
  const c = value as Chat;
  return !!c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages);
}

export function loadChats(): Chat[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHATS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isChat) : [];
  } catch {
    return [];
  }
}

/** Returns false if the browser refused (storage full or blocked). */
export function saveChats(chats: Chat[]): boolean {
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
