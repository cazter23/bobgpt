// Talks to LM Studio's local server (default http://localhost:1234).

export const LMSTUDIO_URL = 'http://localhost:1234';

export type Role = 'system' | 'user' | 'assistant';
export type ChatMessage = {
  role: Role;
  content: string;
  trimmed?: boolean; // on a reply: older messages were left out of what the model saw
  thinking?: string; // on a reply from a reasoning model: what it thought first (never sent back to the model)
  thoughtSeconds?: number; // how long that took
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

/**
 * Streams a chat reply from LM Studio, yielding text pieces as they arrive.
 * Pass an AbortSignal to stop generation early.
 */
export async function* streamChat(
  model: string,
  messages: ChatMessage[],
  options: ChatOptions,
  signal: AbortSignal,
): AsyncGenerator<string> {
  // Only role and content go to the model, with the system prompt (if any) first.
  const sent = messages.map(({ role, content }) => ({ role, content }));
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
