// Talks to LM Studio's local server (default http://localhost:1234).
import { splitThinking } from './thinking';

export const LMSTUDIO_URL = 'http://localhost:1234';

export type Role = 'system' | 'user' | 'assistant';
export type ChatMessage = {
  role: Role;
  content: string;
  images?: string[]; // on one of your messages: ids of attached images (the images themselves are in images.ts)
  trimmed?: boolean; // on a reply: older messages were left out of what the model saw
  thinking?: string; // on a reply from a reasoning model: what it thought first (never sent back to the model)
  thoughtSeconds?: number; // how long that took
  tokensPerSecond?: number; // how fast the reply was written
};

/** How a reply should be generated. */
export type ChatOptions = {
  systemPrompt: string; // empty = none
  temperature: number;
  maxTokens: number | null; // null = no limit
};

export class ServerUnreachableError extends Error {
  constructor() {
    super("Can't reach LM Studio. Start its server on port 1234 and enable CORS.");
  }
}

async function getJson(path: string): Promise<any | null> {
  let res: Response;
  try {
    res = await fetch(LMSTUDIO_URL + path);
  } catch {
    // fetch only throws when the server isn't there (or CORS blocked it).
    throw new ServerUnreachableError();
  }
  return res.ok ? res.json() : null;
}

/**
 * Returns the id of the chat model currently loaded in LM Studio, or null if none is loaded.
 * Different LM Studio versions describe models differently, so a few shapes are checked.
 */
export async function getLoadedModel(): Promise<string | null> {
  // LM Studio REST API (v0): each model has a `state` of "loaded" or "not-loaded".
  const v0 = await getJson('/api/v0/models');
  if (Array.isArray(v0?.data)) {
    const m = v0.data.find((m: any) => m.state === 'loaded' && m.type !== 'embeddings');
    return m?.id ?? null;
  }

  // Newer LM Studio REST API (v1): models list their loaded instances.
  const v1 = await getJson('/api/v1/models');
  if (Array.isArray(v1?.models)) {
    const m = v1.models.find(
      (m: any) => m.type !== 'embedding' && m.type !== 'embeddings' && m.loaded_instances?.length > 0,
    );
    return m?.key ?? m?.id ?? null;
  }

  return null;
}

/** A message's content as the model gets it: plain text, or images and text as OpenAI-compatible parts. */
type SentContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

function sentContent(m: ChatMessage, images: ReadonlyMap<string, string>): SentContent {
  const urls = (m.images ?? []).map((id) => images.get(id)).filter((url): url is string => !!url);
  if (urls.length === 0) return m.content;
  return [
    ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
  ];
}

/**
 * Streams a chat reply from LM Studio, yielding text pieces as they arrive.
 * `images` maps the messages' image ids to their data URLs. Pass an AbortSignal to stop generation early.
 */
export async function* streamChat(
  model: string,
  messages: ChatMessage[],
  images: ReadonlyMap<string, string>,
  options: ChatOptions,
  signal: AbortSignal,
  stats?: { tokens: number }, // if given, counts the tokens that arrive (one per piece, or LM Studio's own count)
): AsyncGenerator<string> {
  // Only role and content (with any images) go to the model, with the system prompt (if any) first.
  const sent: { role: Role; content: SentContent }[] = messages.map((m) => ({ role: m.role, content: sentContent(m, images) }));
  if (options.systemPrompt.trim()) sent.unshift({ role: 'system', content: options.systemPrompt });

  let res: Response;
  try {
    res = await fetch(`${LMSTUDIO_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: sent,
        stream: true,
        temperature: options.temperature,
        ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ServerUnreachableError();
  }

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let message = `LM Studio returned an error (${res.status}).`;
    try {
      const err = JSON.parse(text).error;
      if (err) message = typeof err === 'string' ? err : err.message ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }

  // The reply arrives as server-sent events: lines like `data: {...json...}`.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let reasoning = false; // inside a reasoning_content stretch
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;

      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (data === '[DONE]') return;

        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) {
          throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message);
        }
        const delta = chunk.choices?.[0]?.delta;
        if (stats && (delta?.content || delta?.reasoning_content || delta?.reasoning)) stats.tokens++;
        if (stats && typeof chunk.usage?.completion_tokens === 'number') stats.tokens = chunk.usage.completion_tokens;
        // Reasoning that LM Studio sends separately is wrapped in <think> tags, like the inline kind.
        const thought = delta?.reasoning_content ?? delta?.reasoning;
        if (thought) {
          if (!reasoning) yield '<think>';
          reasoning = true;
          yield thought;
        }
        const piece = delta?.content;
        if (piece) {
          if (reasoning) yield '</think>';
          reasoning = false;
          yield piece;
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/**
 * Asks the loaded model for a short name for a chat, from its first message and reply.
 * Returns null if it couldn't (no answer, an error, or it took too long).
 */
export async function generateTitle(model: string, userText: string, replyText: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(`${LMSTUDIO_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0.3,
        max_tokens: 200,
        messages: [
          {
            role: 'system',
            content: 'Write a title of 2 to 5 words for the chat below. Reply with only the title: no quotes, no full stop.',
          },
          { role: 'user', content: `User: ${userText.slice(0, 600)}\n\nAssistant: ${replyText.slice(0, 600)}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const raw: unknown = (await res.json())?.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') return null;
    const { answer } = splitThinking(raw);
    const title = answer
      .split('\n')[0]
      .replace(/^[\s"'`*#]+|[\s"'`*.]+$/g, '')
      .trim();
    if (!title) return null;
    return title.length > 50 ? `${title.slice(0, 50).trimEnd()}…` : title;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
