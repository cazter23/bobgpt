// The addresses a model's reply may link to (Markdown.tsx), kept apart so they can be checked on their own.

/**
 * The addresses a reply may link to: web pages (http and https) and places within the reply itself (footnotes).
 * Anything else (javascript:, data:, file:, mailto: with a ready-written email, or a path on this app's own server)
 * becomes an empty address, and the link's text is then shown as plain text.
 */
export function safeUrl(url: string): string {
  if (url.startsWith('#')) return url;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : '';
  } catch {
    return ''; // not a full address
  }
}

/** The site an address points to, without "www.", e.g. "example.com". Empty if it can't be read. */
export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
