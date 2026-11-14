import { describe, expect, it, vi } from 'vitest';
import { downloadBackup, readBackup } from '../src/backup';
import { storeImageData } from '../src/images';
import { bot, chat, user } from './helpers';

const file = (data: unknown) => new File([typeof data === 'string' ? data : JSON.stringify(data)], 'backup.json');
const backup = (extra: Record<string, unknown> = {}) => ({
  format: 'bobgpt-backup',
  version: 2,
  chats: [{ id: 'c1', title: 'One', updatedAt: 1, folderId: null, messages: [{ id: 'm1', role: 'user', content: 'hi' }] }],
  folders: [],
  images: {},
  ...extra,
});

describe('readBackup', () => {
  it('reads a current backup', async () => {
    const result = await readBackup(file(backup()));
    expect(result.chats).toHaveLength(1);
    expect(result.chats[0].messages[0].content).toBe('hi');
  });

  it('reads an old version 1 backup (no images, no version-2 fields)', async () => {
    const old = { format: 'bobgpt-backup', version: 1, chats: backup().chats, folders: [] };
    const result = await readBackup(file(old));
    expect(result.chats).toHaveLength(1);
    expect(result.images).toEqual({});
  });

  it('refuses files that are not backups, with a plain message', async () => {
    await expect(readBackup(file('not json at all'))).rejects.toThrow(/isn't a BobGPT backup/);
    await expect(readBackup(file({ hello: 'world' }))).rejects.toThrow(/isn't a BobGPT backup/);
    await expect(readBackup(file({ format: 'bobgpt-backup' }))).rejects.toThrow(/isn't a BobGPT backup/);
    await expect(readBackup(file(null))).rejects.toThrow(/isn't a BobGPT backup/);
  });

  it('refuses a backup from a newer version instead of half-restoring it', async () => {
    await expect(readBackup(file(backup({ version: 99 })))).rejects.toThrow(/newer version/);
  });

  it('drops chats and messages that are broken, keeping the rest', async () => {
    const result = await readBackup(
      file(
        backup({
          chats: [
            { id: 'a', title: 'Good', messages: [{ role: 'user', content: 'x' }, { role: 'robot', content: 'y' }] },
            { id: 'b', title: 'No messages', messages: [] },
            { id: 'c', messages: [] },
            'junk',
          ],
        }),
      ),
    );
    expect(result.chats.map((c) => c.id)).toEqual(['a']);
    expect(result.chats[0].messages).toHaveLength(1);
  });

  it('keeps only the first of any repeated chat or folder id', async () => {
    const m = [{ role: 'user', content: 'x' }];
    const result = await readBackup(
      file(
        backup({
          chats: [
            { id: 'a', title: 'First', messages: m },
            { id: 'a', title: 'Second', messages: m },
          ],
          folders: [
            { id: 'f', name: 'One' },
            { id: 'f', name: 'Two' },
          ],
        }),
      ),
    );
    expect(result.chats.map((c) => c.title)).toEqual(['First']);
    expect(result.folders.map((f) => f.name)).toEqual(['One']);
  });

  it('moves a chat whose folder is not in the file to the main list', async () => {
    const m = [{ role: 'user', content: 'x' }];
    const result = await readBackup(
      file(
        backup({
          chats: [
            { id: 'a', title: 'In folder', folderId: 'f', messages: m },
            { id: 'b', title: 'Orphan', folderId: 'gone', messages: m },
          ],
          folders: [{ id: 'f', name: 'Work', collapsed: true }],
        }),
      ),
    );
    expect(result.chats.map((c) => c.folderId)).toEqual(['f', null]);
    expect(result.folders).toEqual([{ id: 'f', name: 'Work', collapsed: true }]);
  });

  it('only accepts real image data, and only keeps image ids that the file contains', async () => {
    const result = await readBackup(
      file(
        backup({
          chats: [{ id: 'a', title: 'Pics', messages: [{ role: 'user', content: '', images: ['good', 'bad', 'missing'] }] }],
          images: { good: 'data:image/jpeg;base64,AAAA', bad: 'javascript:alert(1)', other: 'http://example.com/x.png' },
        }),
      ),
    );
    expect(result.images).toEqual({ good: 'data:image/jpeg;base64,AAAA' });
    expect(result.chats[0].messages[0].images).toEqual(['good']);
  });
});

describe('downloadBackup', () => {
  it('writes chats, folders and the images the chats use, and can be read back', async () => {
    await storeImageData({ pic1: 'data:image/jpeg;base64,QUJD' });
    const chats = [chat('Pics', [user('look', { images: ['pic1'] }), bot('nice')])];

    let saved: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((saved = b as Blob), 'blob:test'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    let filename = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
    });

    await downloadBackup(chats, [{ id: 'f', name: 'Work', collapsed: false }]);

    expect(filename).toMatch(/^bobgpt-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const result = await readBackup(new File([saved!], 'x.json'));
    expect(result.chats[0].title).toBe('Pics');
    expect(result.chats[0].messages[0].images).toEqual(['pic1']);
    expect(result.images).toEqual({ pic1: 'data:image/jpeg;base64,QUJD' });
    expect(result.folders[0].name).toBe('Work');
  });
});
