// Save one chat as a Markdown (.md) file you can read or share.
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Chat } from './storage';

// The same Markdown reader the app uses to show replies (react-markdown with remark-gfm), so code blocks, tables
// and footnotes are understood exactly as they are on screen.
const reader = unified().use(remarkParse).use(remarkGfm);

type MdNode = {
  type: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  alt?: string | null;
  label?: string | null;
  referenceType?: string;
};

/**
 * Markdown with nothing in it that a Markdown viewer would load or run by itself. Opening the file shouldn't send a
 * request to an address the model wrote (it could carry text from the chat), so:
 * - images become links, marked "Image:", which open only if clicked: ![a cat](url) → [Image: a cat](url)
 * - raw HTML (an <img>, <iframe>, <script>…) is shown as text instead of being run: its < becomes &lt;
 * Code blocks and inline code are left exactly as written, and so is everything else.
 */
export function inertMarkdown(markdown: string): string {
  const edits: { start: number; end: number; text: string }[] = [];
  const visit = (node: MdNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined) {
      const source = markdown.slice(start, end);
      if ((node.type === 'image' || node.type === 'imageReference') && source.startsWith('![')) {
        const shortcut = node.type === 'imageReference' && node.referenceType !== 'full';
        if (shortcut) {
          // ![label] and ![label][] name their definition by their text, so the text and the name are kept apart.
          edits.push({ start, end, text: `[Image: ${node.label ?? ''}][${node.label ?? ''}]` });
        } else {
          edits.push({ start, end: start + 2, text: source.startsWith('![]') ? '[Image' : '[Image: ' });
        }
        return; // an image's description can't hold anything that loads
      }
      if (node.type === 'html') {
        edits.push({ start, end, text: source.replace(/</g, '&lt;') });
        return;
      }
      // Other Markdown readers don't always agree on what is HTML (in `<img src=https://…>` this one sees a web
      // address, GitHub's sees an image), so a < that could start a tag is escaped in plain text too. One that is
      // escaped already (\<), and ones that can't start a tag (2 < 3), are left alone.
      if (node.type === 'text') {
        const escaped = source.replace(/(?<!\\)<(?=[A-Za-z/!?])/g, '&lt;');
        if (escaped !== source) edits.push({ start, end, text: escaped });
        return;
      }
    }
    node.children?.forEach(visit);
  };
  visit(reader.parse(markdown) as MdNode);

  // From the end backwards, so earlier offsets stay right.
  let out = markdown;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/**
 * The chat as Markdown: its title, then each message under "You" or "Assistant". Hidden thinking is left out.
 * Images and raw HTML in the text are made harmless (see inertMarkdown).
 */
export function chatToMarkdown(chat: Chat): string {
  const parts = [`# ${inertMarkdown(chat.title)}`, `*Exported from BobGPT on ${new Date().toLocaleDateString()}*`];
  for (const m of chat.messages) {
    const count = m.images?.length ?? 0;
    const note = count ? `*(${count} image${count === 1 ? '' : 's'} attached)*\n\n` : '';
    parts.push(`## ${m.role === 'user' ? 'You' : 'Assistant'}\n\n${note}${inertMarkdown(m.content.trim())}`);
  }
  return parts.join('\n\n') + '\n';
}

export function downloadChatMarkdown(chat: Chat) {
  const name = chat.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 80) || 'chat';
  const blob = new Blob([chatToMarkdown(chat)], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
