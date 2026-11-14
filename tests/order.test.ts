import { describe, expect, it } from 'vitest';
import { chatsInSidebarOrder } from '../src/order';
import { chat, user } from './helpers';

const c = (id: string, folderId: string | null = null) => chat(id, [user('x')], { id, folderId });
const folder = (id: string, collapsed = false) => ({ id, name: id, collapsed });
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe('chatsInSidebarOrder', () => {
  it('is just the list when there are no folders', () => {
    expect(ids(chatsInSidebarOrder([c('a'), c('b'), c('c')], []))).toEqual(['a', 'b', 'c']);
  });

  it("puts each folder's chats first, folders in their own order, then the chats outside folders", () => {
    const chats = [c('loose1'), c('w1', 'work'), c('p1', 'play'), c('loose2'), c('w2', 'work')];
    expect(ids(chatsInSidebarOrder(chats, [folder('play'), folder('work')]))).toEqual(['p1', 'w1', 'w2', 'loose1', 'loose2']);
  });

  it("leaves out chats in a collapsed folder, which can't be seen", () => {
    const chats = [c('a'), c('hidden', 'closed'), c('shown', 'open')];
    expect(ids(chatsInSidebarOrder(chats, [folder('closed', true), folder('open')]))).toEqual(['shown', 'a']);
  });

  it('treats a chat whose folder is gone as not in a folder', () => {
    expect(ids(chatsInSidebarOrder([c('a', 'deleted'), c('b')], []))).toEqual(['a', 'b']);
  });

  it('is empty when there are no chats', () => {
    expect(chatsInSidebarOrder([], [folder('f')])).toEqual([]);
  });
});
