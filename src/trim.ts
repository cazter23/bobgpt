// Leaves out older messages when a chat is too long for the model's context.
// Only what is sent to the model changes; the saved chat is never touched.
import type { ChatMessage } from './api';
import type { OverflowPolicy } from './settings';

/** Rough extra tokens each message costs for the chat template's role markers. */
const PER_MESSAGE_OVERHEAD = 8;

export class MessageTooLongError extends Error {
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
      out[out.length - 1] = { ...prev, content: `${prev.content}\n\n${m.content}` };
    } else if (prev || m.role === 'user') {
      out.push(m);
    }
  }
  return out;
}

/**
 * `history` ends with the message being answered. `budget` is how many tokens the history may use.
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
  const cost = await Promise.all(history.map(async (m) => (await count(m.content)) + PER_MESSAGE_OVERHEAD));
  const total = cost.reduce((a, b) => a + b, 0);
  if (total <= budget) return { messages: history, trimmed: false };

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
