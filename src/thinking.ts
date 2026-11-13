// Reasoning models (like Qwen) write their "thinking" before the answer. LM Studio sends it either inside
// <think>...</think> tags in the text, or (when its "separate reasoning" setting is on) in its own field,
// which api.ts wraps in the same tags. This splits a raw reply into the thinking and the answer.

const OPEN = '<think>';
const CLOSE = '</think>';

export function splitThinking(raw: string, streaming = false): { thinking: string; answer: string; open: boolean } {
  // While streaming, hide a half-arrived tag such as "</thi" so it doesn't flash on screen.
  const text = streaming ? raw.replace(/<\/?(?:t(?:h(?:i(?:n(?:k)?)?)?)?)?$/, '') : raw;

  const start = text.indexOf(OPEN);
  const end = text.indexOf(CLOSE);

  let thinking = '';
  let answer = text;
  let open = false;

  if (start === -1 && end !== -1) {
    // Some chat templates put the opening tag in the prompt, so only the closing one comes back.
    thinking = text.slice(0, end);
    answer = text.slice(end + CLOSE.length);
  } else if (start !== -1) {
    const after = text.slice(start + OPEN.length);
    const close = after.indexOf(CLOSE);
    if (close === -1) {
      thinking = after;
      answer = text.slice(0, start);
      open = true; // still thinking
    } else {
      thinking = after.slice(0, close);
      answer = text.slice(0, start) + after.slice(close + CLOSE.length);
    }
  }

  return { thinking: thinking.trim(), answer: answer.replace(/^\s+/, ''), open };
}
