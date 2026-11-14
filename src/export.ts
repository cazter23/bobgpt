// Save one chat as a Markdown (.md) file you can read or share.
import type { Chat } from './storage';

/** The chat as Markdown: its title, then each message under "You" or "Assistant". Hidden thinking is left out. */
export function chatToMarkdown(chat: Chat): string {
  const parts = [`# ${chat.title}`, `*Exported from BobGPT on ${new Date().toLocaleDateString()}*`];
  for (const m of chat.messages) {
    const count = m.images?.length ?? 0;
    const note = count ? `*(${count} image${count === 1 ? '' : 's'} attached)*\n\n` : '';
    parts.push(`## ${m.role === 'user' ? 'You' : 'Assistant'}\n\n${note}${m.content.trim()}`);
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
