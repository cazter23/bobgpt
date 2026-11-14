import { describe, expect, it, vi } from 'vitest';
import { chatToMarkdown, downloadChatMarkdown, inertMarkdown } from '../src/export';
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

  it('makes images and raw HTML harmless in the title and in both sides of the chat', () => {
    const md = chatToMarkdown(
      chat('<img src=https://example.com/t.png> Title', [
        user('mine ![u](https://example.com/u.png)'),
        bot('see ![a cat](https://example.com/cat.png?q=secret) and <iframe src="https://example.com/f"></iframe>'),
      ]),
    );
    expect(md).toContain('# &lt;img src=https://example.com/t.png> Title');
    expect(md).toContain('mine [Image: u](https://example.com/u.png)');
    expect(md).toContain('see [Image: a cat](https://example.com/cat.png?q=secret) and &lt;iframe src="https://example.com/f">&lt;/iframe>');
    expect(md).not.toMatch(/!\[|<img|<iframe/);
  });
});

describe('inertMarkdown', () => {
  it('turns every kind of image into a link that only opens when clicked', () => {
    expect(inertMarkdown('![](https://e.com/a.png)')).toBe('[Image](https://e.com/a.png)');
    expect(inertMarkdown('![x][ref]\n\n[ref]: https://e.com/r.png')).toBe('[Image: x][ref]\n\n[ref]: https://e.com/r.png');
    expect(inertMarkdown('![r]\n\n[r]: https://e.com/r.png')).toBe('[Image: r][r]\n\n[r]: https://e.com/r.png');
    expect(inertMarkdown('![r][]\n\n[r]: https://e.com/r.png')).toBe('[Image: r][r]\n\n[r]: https://e.com/r.png');
    expect(inertMarkdown('| a | ![t](https://e.com/t.png) |\n|---|---|\n| 1 | 2 |')).toContain('[Image: t](https://e.com/t.png)');
    expect(inertMarkdown('note[^1]\n\n[^1]: ![f](https://e.com/f.png)')).toContain('[^1]: [Image: f](https://e.com/f.png)');
    expect(inertMarkdown('[![logo](https://e.com/l.png)](https://e.com)')).toBe('[[Image: logo](https://e.com/l.png)](https://e.com)');
  });

  it('shows raw HTML as text, in a paragraph or on its own', () => {
    expect(inertMarkdown('a <img src=x onerror=alert(1)> b')).toBe('a &lt;img src=x onerror=alert(1)> b');
    // Read as a web address here, but as an image by other Markdown readers:
    expect(inertMarkdown('<img src=https://e.com/t.png> b')).toBe('&lt;img src=https://e.com/t.png> b');
    expect(inertMarkdown('already safe: \\<img src=x>')).toBe('already safe: \\<img src=x>');
    expect(inertMarkdown('<script>\nfetch("https://e.com")\n</script>')).toBe('&lt;script>\nfetch("https://e.com")\n&lt;/script>');
  });

  it('leaves code, links and ordinary text exactly as written', () => {
    const text = [
      'Use `<img src="x">` or `![a](b)` in code.',
      '',
      '```html',
      '<img src="https://e.com/in-code.png">',
      '![alt](https://e.com/in-code.png)',
      '```',
      '',
      '    <img src="indented-code.png">',
      '',
      'A [link](https://e.com), <https://e.com/auto>, www.e.com, 2 < 3 and a > b. **Bold** and *more*!',
    ].join('\n');
    expect(inertMarkdown(text)).toBe(text);
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
