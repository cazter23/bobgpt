// Searching your saved chats. Everything happens in this browser.
import type { ChatMessage } from './api';
import type { Chat } from './storage';

/** The words typed in the search box, lower-cased. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export type SearchHit = {
  chat: Chat;
  snippet: string | null; // a short piece of the first matching message (null if only the title matched)
};

/** A short piece of text around the first match, so you can see why a chat came up. */
function snippetFor(messages: ChatMessage[], terms: string[]): string | null {
  for (const m of messages) {
    const lower = m.content.toLowerCase();
    let at = -1;
    for (const t of terms) {
      const i = lower.indexOf(t);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at < 0) continue;
    const start = Math.max(0, at - 40);
    const end = at + 100;
    const text = m.content.slice(start, end).replace(/\s+/g, ' ').trim();
    return (start > 0 ? '…' : '') + text + (end < m.content.length ? '…' : '');
  }
  return null;
}

/** Chats whose title and messages together contain every word, newest first. The model's hidden thinking isn't searched. */
export function searchChats(chats: Chat[], query: string): SearchHit[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const chat of chats) {
    const all = [chat.title, ...chat.messages.map((m) => m.content)].join('\n').toLowerCase();
    if (terms.every((t) => all.includes(t))) hits.push({ chat, snippet: snippetFor(chat.messages, terms) });
  }
  return hits.sort((a, b) => b.chat.updatedAt - a.chat.updatedAt);
}

/** Which message to scroll to when opening a result: the first one with every word, else the first with any. */
export function firstMatchIndex(messages: ChatMessage[], terms: string[]): number {
  const lowers = messages.map((m) => m.content.toLowerCase());
  const all = lowers.findIndex((l) => terms.every((t) => l.includes(t)));
  return all >= 0 ? all : lowers.findIndex((l) => terms.some((t) => l.includes(t)));
}

/** Splits text into pieces, marking the ones that match a search word (for highlighting). */
export function splitMatches(text: string, terms: string[]): { text: string; match: boolean }[] {
  if (terms.length === 0) return [{ text, match: false }];
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text
    .split(pattern)
    .map((part, i) => ({ text: part, match: i % 2 === 1 }))
    .filter((p) => p.text !== '');
}
