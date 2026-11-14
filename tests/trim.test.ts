import { describe, expect, it } from 'vitest';
import {
  ContextFullError,
  IMAGE_TOKENS,
  MessageTooLongError,
  conversationTokens,
  fitToContext,
  tidyForModel,
  withoutImages,
} from '../src/trim';
import { bot, countChars, user } from './helpers';

// With one token per character, a message of 10 letters costs 10 + 8 (role markers) = 18.
const ten = 'x'.repeat(10);
const five = () => [user(ten), bot(ten), user(ten), bot(ten), user(ten)]; // 90 tokens in all

describe('conversationTokens', () => {
  it('adds up the text and the role markers of every message', async () => {
    expect(await conversationTokens(five(), '', countChars)).toBe(90);
  });

  it('counts the system prompt too, but not a blank one', async () => {
    expect(await conversationTokens([user(ten)], 'abcde', countChars)).toBe(18 + 5 + 8);
    expect(await conversationTokens([user(ten)], '   ', countChars)).toBe(18);
  });

  it('adds a fixed cost for each image', async () => {
    expect(await conversationTokens([user(ten, { images: ['a', 'b'] })], '', countChars)).toBe(18 + 2 * IMAGE_TOKENS);
  });
});

describe('fitToContext', () => {
  it('sends everything untouched when it fits', async () => {
    const history = five();
    const result = await fitToContext(history, 90, 'drop-oldest', countChars);
    expect(result).toEqual({ messages: history, trimmed: false });
  });

  describe('Rolling window (drop-oldest)', () => {
    it('keeps the newest messages that fit', async () => {
      const history = five();
      const { messages, trimmed } = await fitToContext(history, 60, 'drop-oldest', countChars);
      expect(messages).toEqual(history.slice(2));
      expect(trimmed).toBe(true);
    });

    it("never starts with a reply: it moves on to the next of your messages", async () => {
      const history = five();
      const { messages } = await fitToContext(history, 40, 'drop-oldest', countChars);
      expect(messages).toEqual([history[4]]);
    });
  });

  describe('Truncate middle (keep-start)', () => {
    it('keeps your first message and its reply, then the newest that fit', async () => {
      const history = five();
      const { messages, trimmed } = await fitToContext(history, 80, 'keep-start', countChars);
      expect(messages).toEqual([history[0], history[1], history[4]]);
      expect(trimmed).toBe(true);
    });

    it('behaves like a rolling window when the start would not leave room', async () => {
      const history = five();
      const { messages } = await fitToContext(history, 40, 'keep-start', countChars);
      expect(messages).toEqual([history[4]]);
    });

    it('keeps the roles alternating, starting with you', async () => {
      const history = [...five(), bot(ten), user(ten)];
      for (const budget of [40, 60, 80, 100]) {
        const { messages } = await fitToContext(history, budget, 'keep-start', countChars);
        expect(messages[0].role).toBe('user');
        messages.forEach((m, i) => i > 0 && expect(m.role).not.toBe(messages[i - 1].role));
      }
    });
  });

  describe('Stop at limit', () => {
    it('refuses, rather than trimming, when the chat does not fit', async () => {
      await expect(fitToContext(five(), 60, 'stop', countChars)).rejects.toBeInstanceOf(ContextFullError);
    });

    it('lets a chat that fits through', async () => {
      const result = await fitToContext(five(), 90, 'stop', countChars);
      expect(result.trimmed).toBe(false);
    });
  });

  it('says so when the newest message alone is too long, whatever the policy', async () => {
    const history = [user(ten), bot(ten), user('y'.repeat(200))];
    await expect(fitToContext(history, 100, 'drop-oldest', countChars)).rejects.toBeInstanceOf(MessageTooLongError);
    await expect(fitToContext(history, 100, 'keep-start', countChars)).rejects.toBeInstanceOf(MessageTooLongError);
  });

  it('counts images against the budget', async () => {
    const history = [user(ten), bot(ten), user(ten, { images: ['a'] })];
    const { messages, trimmed } = await fitToContext(history, 1030, 'drop-oldest', countChars);
    expect(trimmed).toBe(true);
    expect(messages).toEqual([history[2]]);
  });

  it('does not change the history it was given', async () => {
    const history = five();
    const copy = [...history];
    await fitToContext(history, 40, 'drop-oldest', countChars);
    expect(history).toEqual(copy);
  });
});

describe('tidyForModel', () => {
  it('joins neighbours from the same side into one message', () => {
    const out = tidyForModel([user('a'), user('b'), bot('c'), bot('d')]);
    expect(out.map((m) => [m.role, m.content])).toEqual([
      ['user', 'a\n\nb'],
      ['assistant', 'c\n\nd'],
    ]);
  });

  it('leaves out replies that come before your first message', () => {
    expect(tidyForModel([bot('a'), bot('b'), user('c'), bot('d')]).map((m) => m.content)).toEqual(['c', 'd']);
  });

  it('keeps the images of joined messages, and no blank gap for an image-only message', () => {
    const [joined] = tidyForModel([user('', { images: ['a'] }), user('hello', { images: ['b'] })]);
    expect(joined.content).toBe('hello');
    expect(joined.images).toEqual(['a', 'b']);
  });

  it('handles an empty chat', () => {
    expect(tidyForModel([])).toEqual([]);
  });

  it('does not change the saved messages', () => {
    const history = [user('a'), user('b')];
    tidyForModel(history);
    expect(history.map((m) => m.content)).toEqual(['a', 'b']);
  });
});

describe('withoutImages', () => {
  it('drops the images and keeps the text', () => {
    const [m] = withoutImages([user('hi', { images: ['a'] })]);
    expect(m.content).toBe('hi');
    expect(m.images).toBeUndefined();
  });
});
