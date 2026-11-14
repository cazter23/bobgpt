import { describe, expect, it, vi } from 'vitest';
import { chatToMarkdown, downloadChatMarkdown } from '../src/export';
import { bot, chat, user } from './helpers';

describe('chatToMarkdown', () => {
  it('has the title, then each message under "You" or "Assistant"', () => {
    const md = chatToMarkdown(chat('Pasta ideas', [user('Give me an idea'), bot('Try **cacio e pepe**.')]));
    expect(md).toMatch(/^# Pasta ideas\n/);
    expect(md).toContain('## You\n\nGive me an idea');
    expect(md).toContain('## Assistant\n\nTry **cacio e pepe**.');
    expect(md.indexOf('## You')).toBeLessThan(md.indexOf('## Assistant'));
  });

  it("leaves out a reasoning model's hidden thinking", () => {
    const md = chatToMarkdown(chat('T', [user('q'), bot('answer', { thinking: 'private thoughts' })]));
    expect(md).not.toContain('private thoughts');
  });

  it('notes attached images instead of embedding them', () => {
    const one = chatToMarkdown(chat('T', [user('look', { images: ['a'] })]));
    const two = chatToMarkdown(chat('T', [user('look', { images: ['a', 'b'] })]));
    expect(one).toContain('*(1 image attached)*');
    expect(two).toContain('*(2 images attached)*');
    expect(one).not.toContain('data:');
  });

  it('keeps code blocks as written', () => {
    const md = chatToMarkdown(chat('T', [bot('```py\nprint(1)\n```')]));
    expect(md).toContain('```py\nprint(1)\n```');
  });
});

describe('downloadChatMarkdown', () => {
  function capture() {
    let filename = '';
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
    });
    return () => filename;
  }

  it('names the file after the chat', () => {
    const name = capture();
    downloadChatMarkdown(chat('Pasta ideas', [user('x')]));
    expect(name()).toBe('Pasta ideas.md');
  });

  it("removes characters Windows doesn't allow in file names", () => {
    const name = capture();
    downloadChatMarkdown(chat('a/b:c?"d"<e>|f*', [user('x')]));
    expect(name()).toBe('abcdef.md');
  });

  it('falls back to "chat" when nothing is left, and shortens very long titles', () => {
    const name = capture();
    downloadChatMarkdown(chat('???', [user('x')]));
    expect(name()).toBe('chat.md');
    downloadChatMarkdown(chat('a'.repeat(300), [user('x')]));
    expect(name().length).toBeLessThanOrEqual(83);
  });
});
