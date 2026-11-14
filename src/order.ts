// The order the sidebar shows chats in, for Alt+Up and Alt+Down: each folder's chats (folders in their own order,
// leaving out the ones in a collapsed folder, which you can't see), then the chats that aren't in a folder.
import type { Chat, Folder } from './storage';

export function chatsInSidebarOrder(chats: Chat[], folders: Folder[]): Chat[] {
  const folderIds = new Set(folders.map((f) => f.id));
  const inFolders = folders.filter((f) => !f.collapsed).flatMap((f) => chats.filter((c) => c.folderId === f.id));
  const unfiled = chats.filter((c) => !c.folderId || !folderIds.has(c.folderId));
  return [...inFolders, ...unfiled];
}
