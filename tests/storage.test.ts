import { beforeEach, describe, expect, it, vi } from 'vitest';

// storage.ts remembers (in the module) whether the saved chats could be read, so each test gets a fresh copy.
async function fresh() {
  vi.resetModules();
  return import('../src/storage');
}

const goodChat = { id: 'c1', title: 'Hi', updatedAt: 5, messages: [{ id: 'm1', role: 'user', content: 'hello' }] };

describe('cleanMessage', () => {
  it('accepts a normal message', async () => {
    const { cleanMessage } = await fresh();
    expect(cleanMessage({ id: 'x', role: 'assistant', content: 'hi', tokensPerSecond: 12.5 })).toEqual({
      id: 'x',
      role: 'assistant',
      content: 'hi',
      tokensPerSecond: 12.5,
    });
  });

  it('rejects anything that is not a message', async () => {
    const { cleanMessage } = await fresh();
    for (const bad of [null, 'text', 5, {}, { role: 'system', content: 'x' }, { role: 'user', content: 5 }]) {
      expect(cleanMessage(bad)).toBeNull();
    }
  });

  it('gives a message without an id a new one', async () => {
    const { cleanMessage } = await fresh();
    expect(cleanMessage({ role: 'user', content: 'x' })!.id).toBeTruthy();
  });

  it('only keeps images on your own messages, and only known ones', async () => {
    const { cleanMessage } = await fresh();
    expect(cleanMessage({ role: 'user', content: '', images: ['a', 'b', 7] }, (id) => id === 'a')!.images).toEqual(['a']);
    expect(cleanMessage({ role: 'assistant', content: 'x', images: ['a'] })!.images).toBeUndefined();
  });

  it('leaves out unknown fields and empty thinking', async () => {
    const { cleanMessage } = await fresh();
    const m = cleanMessage({ role: 'assistant', content: 'x', thinking: '', surprise: true })!;
    expect(m).not.toHaveProperty('surprise');
    expect(m).not.toHaveProperty('thinking');
  });
});

describe('cleanChat', () => {
  it('drops chats with nothing valid in them', async () => {
    const { cleanChat } = await fresh();
    expect(cleanChat({ ...goodChat, messages: [] })).toBeNull();
    expect(cleanChat({ ...goodChat, messages: [{ role: 'bogus' }] })).toBeNull();
    expect(cleanChat({ id: 1, title: 'x', messages: [] })).toBeNull();
    expect(cleanChat(null)).toBeNull();
  });

  it('keeps the valid messages of a chat that has some bad ones', async () => {
    const { cleanChat } = await fresh();
    const c = cleanChat({ ...goodChat, messages: [goodChat.messages[0], 'junk'] })!;
    expect(c.messages).toHaveLength(1);
  });

  it('gives repeated message ids new ones', async () => {
    const { cleanChat } = await fresh();
    const m = { id: 'same', role: 'user', content: 'x' };
    const c = cleanChat({ ...goodChat, messages: [m, { ...m, role: 'assistant' }] })!;
    expect(new Set(c.messages.map((x) => x.id)).size).toBe(2);
  });

  it('puts a chat whose folder is gone back in the main list', async () => {
    const { cleanChat } = await fresh();
    expect(cleanChat({ ...goodChat, folderId: 'f1' }, { hasFolder: () => false })!.folderId).toBeNull();
    expect(cleanChat({ ...goodChat, folderId: 'f1' }, { hasFolder: () => true })!.folderId).toBe('f1');
  });

  it('copes with a missing or silly date', async () => {
    const { cleanChat } = await fresh();
    expect(typeof cleanChat({ ...goodChat, updatedAt: 'soon' })!.updatedAt).toBe('number');
    expect(Number.isFinite(cleanChat({ ...goodChat, updatedAt: Infinity })!.updatedAt)).toBe(true);
  });
});

describe('loadChats and saveChats', () => {
  beforeEach(() => localStorage.clear());

  it('starts with no chats', async () => {
    const { loadChats, savedChatsUnreadable } = await fresh();
    expect(loadChats()).toEqual([]);
    expect(savedChatsUnreadable()).toBeNull();
  });

  it('saves and loads chats', async () => {
    const { loadChats, saveChats } = await fresh();
    expect(saveChats([goodChat as never])).toBe(true);
    expect(loadChats()[0]).toMatchObject({ id: 'c1', title: 'Hi' });
  });

  it('still loads chats saved before messages had ids', async () => {
    localStorage.setItem('homegpt-chats', JSON.stringify([{ ...goodChat, messages: [{ role: 'user', content: 'old' }] }]));
    const { loadChats } = await fresh();
    expect(loadChats()[0].messages[0]).toMatchObject({ content: 'old' });
  });

  it('skips broken chats but keeps the good ones', async () => {
    localStorage.setItem('homegpt-chats', JSON.stringify([goodChat, { nonsense: true }, null]));
    const { loadChats } = await fresh();
    expect(loadChats()).toHaveLength(1);
  });

  it('keeps a copy of corrupt data and says so, instead of silently replacing it', async () => {
    localStorage.setItem('homegpt-chats', '{ this is not json');
    const { loadChats, saveChats, savedChatsUnreadable } = await fresh();
    expect(loadChats()).toEqual([]);
    const problem = savedChatsUnreadable()!;
    expect(problem.copiedTo).toMatch(/^homegpt-chats-unreadable-/);
    expect(localStorage.getItem(problem.copiedTo!)).toBe('{ this is not json');
    expect(saveChats([])).toBe(true); // the copy is safe, so saving may go on
  });

  it('refuses to save over unreadable chats it could not copy', async () => {
    localStorage.setItem('homegpt-chats', '{ broken');
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.includes('unreadable')) throw new DOMException('full', 'QuotaExceededError');
      return realSet.call(this, key, value);
    });
    const { loadChats, saveChats, savedChatsUnreadable } = await fresh();
    loadChats();
    expect(savedChatsUnreadable()).toEqual({ copiedTo: null, blocked: false });
    expect(saveChats([goodChat as never])).toBe(false);
    expect(localStorage.getItem('homegpt-chats')).toBe('{ broken');
  });

  it('treats saved data that is not a list as unreadable', async () => {
    localStorage.setItem('homegpt-chats', '{"a":1}');
    const { loadChats, savedChatsUnreadable } = await fresh();
    expect(loadChats()).toEqual([]);
    expect(savedChatsUnreadable()).not.toBeNull();
  });

  it('reports a full or blocked storage when saving', async () => {
    const { saveChats } = await fresh();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(saveChats([])).toBe(false);
  });

  it('still uses the original storage names, so old data is found', async () => {
    const { CHATS_KEY, FOLDERS_KEY } = await fresh();
    expect([CHATS_KEY, FOLDERS_KEY]).toEqual(['homegpt-chats', 'homegpt-folders']);
  });
});

describe('folders and sidebar size', () => {
  it('ignores broken folders and defaults "collapsed" to false', async () => {
    localStorage.setItem('homegpt-folders', JSON.stringify([{ id: 'a', name: 'Work' }, { id: 5 }, null, { name: 'x' }]));
    const { loadFolders } = await fresh();
    expect(loadFolders()).toEqual([{ id: 'a', name: 'Work', collapsed: false }]);
  });

  it('survives corrupt folder data', async () => {
    localStorage.setItem('homegpt-folders', 'nope');
    const { loadFolders } = await fresh();
    expect(loadFolders()).toEqual([]);
  });

  it('remembers the sidebar size, defaulting to medium', async () => {
    const { loadSidebarSize, saveSidebarSize } = await fresh();
    expect(loadSidebarSize()).toBe('medium');
    saveSidebarSize('hidden');
    expect(loadSidebarSize()).toBe('hidden');
    localStorage.setItem('homegpt-sidebar', 'enormous');
    expect(loadSidebarSize()).toBe('medium');
  });
});

describe('titleFrom', () => {
  it('uses the start of the message on one line', async () => {
    const { titleFrom } = await fresh();
    expect(titleFrom('  hello\n\n  there  ')).toBe('hello there');
  });

  it('shortens long text with an ellipsis', async () => {
    const { titleFrom } = await fresh();
    const t = titleFrom('word '.repeat(30));
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(41);
  });

  it('names an empty (image-only) message "New chat"', async () => {
    const { titleFrom } = await fresh();
    expect(titleFrom('   ')).toBe('New chat');
  });
});
