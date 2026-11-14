import { describe, expect, it } from 'vitest';
import { firstMatchIndex, searchChats, searchTerms, splitMatches } from '../src/search';
import { bot, chat, user } from './helpers';

describe('searchTerms', () => {
  it('splits on spaces and ignores capitals and extra spaces', () => {
    expect(searchTerms('  Hello   WORLD ')).toEqual(['hello', 'world']);
    expect(searchTerms('   ')).toEqual([]);
  });
});

describe('searchChats', () => {
  const pasta = chat('Dinner', [user('Give me a pasta idea'), bot('Try cacio e pepe with lots of pepper.')], { updatedAt: 1 });
  const code = chat('Python help', [user('How do I read a file?'), bot('Use open() and read().')], { updatedAt: 2 });

  it('finds chats by what is said in them, ignoring capitals', () => {
    expect(searchChats([pasta, code], 'PEPE').map((h) => h.chat.title)).toEqual(['Dinner']);
  });

  it('finds chats by title', () => {
    expect(searchChats([pasta, code], 'python').map((h) => h.chat.title)).toEqual(['Python help']);
  });

  it('needs every word to be somewhere in the chat, in any order', () => {
    expect(searchChats([pasta, code], 'pepper pasta')).toHaveLength(1);
    expect(searchChats([pasta, code], 'pasta python')).toHaveLength(0);
  });

  it('puts the newest chat first', () => {
    const hits = searchChats([pasta, code], 'a');
    expect(hits.map((h) => h.chat.title)).toEqual(['Python help', 'Dinner']);
  });

  it('returns nothing for an empty search', () => {
    expect(searchChats([pasta], '')).toEqual([]);
    expect(searchChats([pasta], '   ')).toEqual([]);
  });

  it("does not search a reasoning model's hidden thinking", () => {
    const c = chat('Maths', [user('2+2?'), bot('4', { thinking: 'secretword' })]);
    expect(searchChats([c], 'secretword')).toEqual([]);
  });

  it('shows a snippet of the first match, and none when only the title matched', () => {
    const [hit] = searchChats([pasta], 'cacio');
    expect(hit.snippet).toContain('cacio e pepe');
    expect(searchChats([pasta], 'dinner')[0].snippet).toBeNull();
  });

  it('shortens a long message around the match with ellipses', () => {
    const long = chat('Long', [user(`${'a '.repeat(80)}needle${' b'.repeat(80)}`)]);
    const snippet = searchChats([long], 'needle')[0].snippet!;
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('needle');
    expect(snippet.length).toBeLessThan(160);
  });
});

describe('firstMatchIndex', () => {
  const messages = [user('about apples'), bot('apples and pears'), user('pears')];

  it('prefers the first message that has every word', () => {
    expect(firstMatchIndex(messages, ['apples', 'pears'])).toBe(1);
  });

  it('falls back to the first message with any of the words', () => {
    expect(firstMatchIndex(messages, ['pears', 'zebra'])).toBe(1);
  });

  it('is -1 when nothing matches', () => {
    expect(firstMatchIndex(messages, ['zebra'])).toBe(-1);
  });
});

describe('splitMatches', () => {
  it('marks the matching pieces, ignoring capitals', () => {
    expect(splitMatches('Hello hello world', ['hello'])).toEqual([
      { text: 'Hello', match: true },
      { text: ' ', match: false },
      { text: 'hello', match: true },
      { text: ' world', match: false },
    ]);
  });

  it('treats characters like ( . * as plain text, not as a pattern', () => {
    expect(() => splitMatches('a (b) c.d', ['(b', '.', '*'])).not.toThrow();
    expect(splitMatches('a (b) c.d', ['(b']).filter((p) => p.match).map((p) => p.text)).toEqual(['(b']);
    expect(splitMatches('abc', ['.']).some((p) => p.match)).toBe(false);
  });

  it('returns the text whole when there is nothing to mark', () => {
    expect(splitMatches('abc', [])).toEqual([{ text: 'abc', match: false }]);
  });
});
