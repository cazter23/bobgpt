// A pretend LM Studio for the app tests. `fetch` is replaced and the SDK module is mocked, so nothing real is contacted.
// Each chat request waits until the test finishes it, so a test can see exactly what the app does in between.
import { vi } from 'vitest';

export type PendingReply = {
  body: { model: string; messages: { role: string; content: unknown }[]; stream: boolean };
  /** Sends a piece of the reply text. */
  say(text: string): void;
  /** Ends the reply normally. */
  finish(): void;
  /** Ends the stream with an error, like LM Studio failing mid-reply. */
  fail(message: string): void;
  ended: boolean;
};

export type FakeServer = {
  /** Every chat request received, in order (including ones already finished). */
  replies: PendingReply[];
  /** Requests being answered at this very moment. */
  open(): PendingReply[];
  /** Highest number of replies that were open at the same time. */
  maxOpen(): number;
  /** Every request URL, in order. */
  urls: string[];
  /** Makes the server unreachable, like LM Studio being switched off. */
  goOffline(): void;
};

const encoder = new TextEncoder();

export function installFakeServer(): FakeServer {
  const server: FakeServer = {
    replies: [],
    urls: [],
    open: () => server.replies.filter((r) => !r.ended),
    maxOpen: () => max,
    goOffline: () => (offline = true),
  };
  let offline = false;
  let max = 0;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      server.urls.push(url);
      if (offline) throw new TypeError('Failed to fetch');

      if (url.endsWith('/api/v0/models')) {
        return Response.json({ data: [{ id: 'test-model', state: 'loaded', type: 'llm' }] });
      }

      if (url.endsWith('/v1/chat/completions')) {
        const body = JSON.parse(init!.body as string);
        // The chat-naming request: answer at once.
        if (body.stream === false) return Response.json({ choices: [{ message: { content: 'A Title' } }] });

        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const stream = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
        const reply: PendingReply = {
          body,
          ended: false,
          say: (text) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)),
          finish: () => {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            reply.ended = true;
          },
          fail: (message) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { message } })}\n\n`));
            controller.close();
            reply.ended = true;
          },
        };
        // If the app aborts the request (Stop), the reply ends.
        init?.signal?.addEventListener('abort', () => {
          if (reply.ended) return;
          reply.ended = true;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
        server.replies.push(reply);
        max = Math.max(max, server.open().length);
        return new Response(stream, { status: 200 });
      }

      return new Response('not found', { status: 404 });
    }),
  );

  return server;
}
