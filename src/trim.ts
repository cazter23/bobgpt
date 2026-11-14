// Leaves out older messages when a chat is too long for the model's context.
// Only what is sent to the model changes; the saved chat is never touched.
import type { ChatMessage } from './api';
import type { OverflowPolicy } from './settings';

/** Rough extra tokens each message costs for the chat template's role markers. */
const PER_MESSAGE_OVERHEAD = 8;

/**
 * Rough tokens one image costs. The tokenizer can't count images, and each vision model turns an image
 * into a different number of tokens: for a 1000 px image (the size images are shrunk to), Gemma 3 uses
 * 256, LLaVA 576, Qwen2.5-VL about 950, and Pixtral or Mistral Small more. Guessing a little high keeps
 * Stop at limit on the safe side.
 */
export const IMAGE_TOKENS = 1000;

/** What one message costs: its text, the role markers, and any images. */
async function messageCost(m: ChatMessage, count: (text: string) => Promise<number>): Promise<number> {
  return (await count(m.content)) + PER_MESSAGE_OVERHEAD + (m.images?.length ?? 0) * IMAGE_TOKENS;
}

/** How many tokens a chat takes up in the model's context (with the system prompt, if any). */
export async function conversationTokens(
  history: ChatMessage[],
  systemPrompt: string,
  count: (text: string) => Promise<number>,
): Promise<number> {
  const costs = await Promise.all(history.map((m) => messageCost(m, count)));
  const system = systemPrompt.trim() ? (await count(systemPrompt)) + PER_MESSAGE_OVERHEAD : 0;
  return costs.reduce((a, b) => a + b, system);
}

/** The chat can't be sent as it is: it doesn't fit, and it can't be shortened. */
export class ContextError extends Error {}

export class ContextFullError extends ContextError {
  constructor() {
    super(
      "This chat has reached the model's context limit, so nothing was sent. " +
        'Start a new chat, or change Context overflow in settings.',
    );
  }
}

export class NoVisionError extends ContextError {
  constructor() {
    super("The loaded model can't see images, so nothing was sent. Load a vision model, or send the message without them.");
  }
}

export class MessageTooLongError extends ContextError {
  constructor(tokens: number, room: number) {
    super(
      `That message is about ${tokens} tokens, but only ${room} fit in the model's context. ` +
        'Shorten it, or raise the context length in settings.',
    );
  }
}

/**
 * Tidies a chat before it is sent, because deleting a message can leave two messages from the same
 * side in a row, or a chat that starts with a reply. Some models' chat templates refuse both.
 * Neighbours from the same side are joined into one, and replies before your first message are left out.
 * Only what is sent changes; the saved chat stays as it is.
 */
export function tidyForModel(history: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of history) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      const images = [...(prev.images ?? []), ...(m.images ?? [])];
      out[out.length - 1] = {
        ...prev,
        content: [prev.content, m.content].filter(Boolean).join('\n\n'), // an image-only message has no text
        ...(images.length ? { images } : {}),
      };
    } else if (prev || m.role === 'user') {
      out.push(m);
    }
  }
  return out;
}

/** The chat without its images, for a model that can't see them. Only what is sent changes. */
export function withoutImages(history: ChatMessage[]): ChatMessage[] {
  return history.map(({ images: _images, ...m }) => m);
}

/**
 * `history` ends with the message being answered. `budget` is how many tokens the history may use.
 * - stop: sends nothing if the chat doesn't fit.
 * - drop-oldest: keeps the newest messages that fit.
 * - keep-start: keeps your first message and its reply, plus the newest messages that fit.
 * The result always starts with a user message and keeps roles alternating, because some
 * models' chat templates refuse anything else.
 */
export async function fitToContext(
  history: ChatMessage[],
  budget: number,
  policy: OverflowPolicy,
  count: (text: string) => Promise<number>,
): Promise<{ messages: ChatMessage[]; trimmed: boolean }> {
  const cost = await Promise.all(history.map((m) => messageCost(m, count)));
  const total = cost.reduce((a, b) => a + b, 0);
  if (total <= budget) return { messages: history, trimmed: false };
  if (policy === 'stop') throw new ContextFullError();

  const last = history.length - 1;
  if (cost[last] > budget) throw new MessageTooLongError(cost[last], Math.max(budget, 0));

  let used = cost[last];
  let headEnd = 0; // messages before this index are kept from the start

  if (policy === 'keep-start' && last >= 2) {
    const headCost = cost[0] + cost[1];
    if (used + headCost <= budget) {
      used += headCost;
      headEnd = 2;
    }
  }

  // Take as many of the newest messages as fit.
  let tailStart = last;
  while (tailStart - 1 >= headEnd && used + cost[tailStart - 1] <= budget) {
    tailStart--;
    used += cost[tailStart];
  }
  // The kept recent messages must begin with a user message.
  while (tailStart < last && history[tailStart].role !== 'user') tailStart++;

  const messages = [...history.slice(0, headEnd), ...history.slice(tailStart)];
  return { messages, trimmed: messages.length < history.length };
}
