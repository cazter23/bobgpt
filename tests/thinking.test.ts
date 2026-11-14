import { describe, expect, it } from 'vitest';
import { splitThinking } from '../src/thinking';

describe('splitThinking', () => {
  it('leaves a normal reply alone', () => {
    expect(splitThinking('Just an answer.')).toEqual({ thinking: '', answer: 'Just an answer.', open: false });
  });

  it('separates <think> from the answer', () => {
    expect(splitThinking('<think>hmm</think>The answer')).toEqual({ thinking: 'hmm', answer: 'The answer', open: false });
  });

  it('says the model is still thinking while the tag is open', () => {
    const r = splitThinking('<think>working on it');
    expect(r).toMatchObject({ thinking: 'working on it', answer: '', open: true });
  });

  it('copes with a template that only sends the closing tag', () => {
    expect(splitThinking('I thought a lot</think>Done')).toMatchObject({ thinking: 'I thought a lot', answer: 'Done' });
  });

  it('keeps text before the thinking, and trims blank space', () => {
    const r = splitThinking('Hi. <think>\n  x  \n</think>\n\nBye');
    expect(r.thinking).toBe('x');
    expect(r.answer).toBe('Hi. \n\nBye');
  });

  it('hides a half-arrived tag at the end while streaming, but not once finished', () => {
    for (const partial of ['<', '<t', '<thi', '<think', '</', '</thin']) {
      expect(splitThinking(`Hello ${partial}`, true).answer).toBe('Hello ');
    }
    expect(splitThinking('Hello <thi', false).answer).toBe('Hello <thi');
  });

  it('does not hide ordinary text that merely ends in "<"-like characters while streaming', () => {
    expect(splitThinking('a < b', true).answer).toBe('a < b');
  });
});
