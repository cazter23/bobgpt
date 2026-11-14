// Talking to LM Studio, with a fake server: `fetch` is replaced, so nothing real is contacted.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerUnreachableError, generateTitle, getLoadedModel, streamChat, type ChatOptions } from '../src/api';
import { bot, delta, reasoningDelta, sse, streamResponse, user } from './helpers';

const options: ChatOptions = { systemPrompt: '', temperature: 0.8, maxTokens: null };
const noImages = new Map<string, string>();

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit; body?: any }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return handler(url, init);
    }),
  );
  return calls;
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const piece of gen) out.push(piece);
  return out;
}

const stream = (messages = [user('hi')], opts = options, signal = new AbortController().signal, stats?: { tokens: number }) =>
  streamChat('model-x', messages, noImages, opts, signal, stats);

afterEach(() => vi.useRealTimers());

describe('streamChat: reading the reply', () => {
  it('yields the text pieces as they arrive', async () => {
    fakeFetch(() => streamResponse([sse([delta('Hel'), delta('lo')])]));
    expect(await collect(stream())).toEqual(['Hel', 'lo']);
  });

  it('copes with a line split across network pieces', async () => {
    const whole = sse([delta('one'), delta('two')]);
    fakeFetch(() => streamResponse([whole.slice(0, 20), whole.slice(20, 45), whole.slice(45)]));
    expect(await collect(stream())).toEqual(['one', 'two']);
  });

  it('reads a last line that has no newline after it', async () => {
    fakeFetch(() => streamResponse([`data: ${JSON.stringify(delta('end'))}`]));
    expect(await collect(stream())).toEqual(['end']);
  });

  it('ignores comments, blank lines and garbage, and stops at [DONE]', async () => {
    fakeFetch(() => streamResponse([': keep-alive\n\ndata: {oops\n\n', sse([delta('ok')]), `data: ${JSON.stringify(delta('after'))}\n\n`]));
    expect(await collect(stream())).toEqual(['ok']);
  });

  it('wraps separately-sent reasoning in <think> tags, closing them when the answer starts', async () => {
    fakeFetch(() => streamResponse([sse([reasoningDelta('hmm '), reasoningDelta('ok'), delta('Answer')])]));
    expect((await collect(stream())).join('')).toBe('<think>hmm ok</think>Answer');
  });

  it('counts tokens in the stats it is given', async () => {
    fakeFetch(() => streamResponse([sse([delta('a'), delta('b'), delta('c')])]));
    const stats = { tokens: 0 };
    await collect(stream(undefined, options, undefined, stats));
    expect(stats.tokens).toBe(3);
  });

  it("prefers LM Studio's own token count when it sends one", async () => {
    fakeFetch(() => streamResponse([sse([delta('a'), { choices: [], usage: { completion_tokens: 42 } }])]));
    const stats = { tokens: 0 };
    await collect(stream(undefined, options, undefined, stats));
    expect(stats.tokens).toBe(42);
  });
});

describe('streamChat: the request', () => {
  it('sends only role and content, with the system prompt first', async () => {
    const calls = fakeFetch(() => streamResponse([sse([])]));
    await collect(stream([user('hi'), bot('hello', { thinking: 'secret', trimmed: true }), user('again')], { ...options, systemPrompt: 'Be brief.' }));
    expect(calls[0].url).toBe('http://localhost:1234/v1/chat/completions');
    expect(calls[0].body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'again' },
    ]);
    expect(calls[0].body.stream).toBe(true);
  });

  it('leaves out a blank system prompt and a max length of "no limit"', async () => {
    const calls = fakeFetch(() => streamResponse([sse([])]));
    await collect(stream([user('hi')], { systemPrompt: '   ', temperature: 0.5, maxTokens: null }));
    expect(calls[0].body.messages).toHaveLength(1);
    expect(calls[0].body).not.toHaveProperty('max_tokens');
    expect(calls[0].body.temperature).toBe(0.5);
  });

  it('includes the max response length when set', async () => {
    const calls = fakeFetch(() => streamResponse([sse([])]));
    await collect(stream([user('hi')], { ...options, maxTokens: 300 }));
    expect(calls[0].body.max_tokens).toBe(300);
  });

  it('sends images as image_url parts before the text, and skips ones that are gone', async () => {
    const calls = fakeFetch(() => streamResponse([sse([])]));
    const images = new Map([['a', 'data:image/jpeg;base64,AAAA']]);
    await collect(streamChat('m', [user('what is this?', { images: ['a', 'lost'] })], images, options, new AbortController().signal));
    expect(calls[0].body.messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'text', text: 'what is this?' },
    ]);
  });

  it('sends plain text when every image of a message is gone', async () => {
    const calls = fakeFetch(() => streamResponse([sse([])]));
    await collect(streamChat('m', [user('hi', { images: ['lost'] })], noImages, options, new AbortController().signal));
    expect(calls[0].body.messages[0].content).toBe('hi');
  });
});

describe('streamChat: when things go wrong', () => {
  it('says LM Studio is unreachable when the server is not there', async () => {
    fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(collect(stream())).rejects.toBeInstanceOf(ServerUnreachableError);
  });

  it("shows LM Studio's own error message", async () => {
    fakeFetch(() => new Response(JSON.stringify({ error: { message: 'Model unloaded.' } }), { status: 400 }));
    await expect(collect(stream())).rejects.toThrow('Model unloaded.');
    fakeFetch(() => new Response(JSON.stringify({ error: 'plain string error' }), { status: 500 }));
    await expect(collect(stream())).rejects.toThrow('plain string error');
  });

  it('gives a generic message when the error is not JSON', async () => {
    fakeFetch(() => new Response('<html>oops</html>', { status: 502 }));
    await expect(collect(stream())).rejects.toThrow('LM Studio returned an error (502).');
  });

  it('throws an error that arrives in the middle of the stream, after the text before it', async () => {
    fakeFetch(() => streamResponse([sse([delta('partial'), { error: { message: 'Out of memory' } }], { done: false })]));
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const p of stream()) seen.push(p);
      })(),
    ).rejects.toThrow('Out of memory');
    expect(seen).toEqual(['partial']);
  });

  it('passes an abort through as an abort, not as "unreachable"', async () => {
    const controller = new AbortController();
    fakeFetch((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    });
    const run = collect(stream([user('hi')], options, controller.signal));
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('getLoadedModel', () => {
  it('finds the loaded chat model in the v0 list, skipping embedding models', async () => {
    fakeFetch(() =>
      Response.json({
        data: [
          { id: 'embed', state: 'loaded', type: 'embeddings' },
          { id: 'idle', state: 'not-loaded', type: 'llm' },
          { id: 'qwen', state: 'loaded', type: 'llm' },
        ],
      }),
    );
    expect(await getLoadedModel()).toBe('qwen');
  });

  it('is null when nothing is loaded', async () => {
    fakeFetch(() => Response.json({ data: [{ id: 'idle', state: 'not-loaded', type: 'llm' }] }));
    expect(await getLoadedModel()).toBeNull();
  });

  it('falls back to the newer v1 list', async () => {
    fakeFetch((url) =>
      url.includes('/api/v0/') ? new Response('', { status: 404 }) : Response.json({ models: [{ key: 'gemma', type: 'llm', loaded_instances: [{}] }] }),
    );
    expect(await getLoadedModel()).toBe('gemma');
  });

  it('throws "unreachable" when LM Studio is not running', async () => {
    fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(getLoadedModel()).rejects.toBeInstanceOf(ServerUnreachableError);
  });
});

describe('generateTitle', () => {
  const reply = (content: unknown) => Response.json({ choices: [{ message: { content } }] });

  it('cleans up the title: quotes, markdown, trailing full stop, extra lines', async () => {
    fakeFetch(() => reply('"**Pasta Ideas**."\nSome extra explanation'));
    expect(await generateTitle('m', 'q', 'a')).toBe('Pasta Ideas');
  });

  it("ignores a reasoning model's <think> block", async () => {
    fakeFetch(() => reply('<think>let me think</think>Dinner Plans'));
    expect(await generateTitle('m', 'q', 'a')).toBe('Dinner Plans');
  });

  it('shortens a very long title', async () => {
    fakeFetch(() => reply('word '.repeat(40)));
    const title = (await generateTitle('m', 'q', 'a'))!;
    expect(title.length).toBeLessThanOrEqual(51);
    expect(title.endsWith('…')).toBe(true);
  });

  it('is null when there is no usable answer, an error, or no server', async () => {
    fakeFetch(() => reply('   '));
    expect(await generateTitle('m', 'q', 'a')).toBeNull();
    fakeFetch(() => reply(null));
    expect(await generateTitle('m', 'q', 'a')).toBeNull();
    fakeFetch(() => new Response('', { status: 500 }));
    expect(await generateTitle('m', 'q', 'a')).toBeNull();
    fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    expect(await generateTitle('m', 'q', 'a')).toBeNull();
  });

  it('only sends the start of long messages', async () => {
    const calls = fakeFetch(() => reply('Title'));
    await generateTitle('m', 'u'.repeat(5000), 'a'.repeat(5000));
    expect(calls[0].body.messages[1].content.length).toBeLessThan(1400);
  });
});
