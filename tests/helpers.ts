// Small builders so each test can say what it's about in one line.
import type { ChatMessage } from '../src/api';
import type { Chat } from '../src/storage';

let counter = 0;

export function msg(role: 'user' | 'assistant', content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: `m${++counter}`, role, content, ...extra };
}
export const user = (content: string, extra?: Partial<ChatMessage>) => msg('user', content, extra);
export const bot = (content: string, extra?: Partial<ChatMessage>) => msg('assistant', content, extra);

export function chat(title: string, messages: ChatMessage[], extra: Partial<Chat> = {}): Chat {
  return { id: `c${++counter}`, title, messages, updatedAt: 1000, folderId: null, ...extra };
}

/** One token per character: easy to reason about in a test. */
export const countChars = async (text: string) => text.length;

/** Streams `text` the way LM Studio does: server-sent events, one `data:` line per chunk. */
export function sse(chunks: unknown[], { done = true }: { done?: boolean } = {}): string {
  return chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '');
}
export const delta = (content: string) => ({ choices: [{ delta: { content } }] });
export const reasoningDelta = (reasoning_content: string) => ({ choices: [{ delta: { reasoning_content } }] });

/** A fetch Response whose body arrives in the given pieces. */
export function streamResponse(pieces: string[], init: ResponseInit = { status: 200 }): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
  return new Response(body, init);
}
