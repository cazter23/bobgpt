// What a browser needs to offer "Install": a valid manifest, real icon files of the sizes it claims, and links in the page.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));

/** Width and height from a PNG file's header. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('manifest', () => {
  it('names the app and opens it in its own window', () => {
    expect(manifest.name).toBe('BobGPT');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
  });

  it('lists a 192, a 512 and a maskable icon', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('only lists icon files that exist and really are the size they claim', () => {
    for (const icon of manifest.icons as { src: string; sizes: string }[]) {
      const file = `public${icon.src}`;
      expect(existsSync(file), file).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(file), file).toEqual({ width: w, height: h });
    }
  });

  it('has colours that are valid', () => {
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('the page', () => {
  const html = readFileSync('index.html', 'utf8');

  it('links the manifest, the icon and the theme colour', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('<link rel="icon" href="/favicon.svg"');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`);
    expect(existsSync('public/favicon.svg')).toBe(true);
  });

  it('still only allows talking to itself and LM Studio (the privacy rule)', () => {
    const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)![1];
    const connect = csp.split(';').find((part) => part.trim().startsWith('connect-src'))!;
    const allowed = connect.trim().split(/\s+/).slice(1);
    for (const source of allowed) expect(source).toMatch(/^('self'|(http|ws):\/\/(localhost|127\.0\.0\.1):(1234|\*))$/);
  });
});

describe('the Desktop shortcut icon (bobgpt.ico)', () => {
  const ico = readFileSync('bobgpt.ico');

  it('is a real Windows icon with several sizes, from 16 to 256 pixels', () => {
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]); // reserved, type "icon"
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256); // a stored 0 means 256
    expect(sizes).toContain(16);
    expect(sizes).toContain(256);
  });

  it('points each size at real picture data inside the file', () => {
    const count = ico.readUInt16LE(4);
    for (let i = 0; i < count; i++) {
      const length = ico.readUInt32LE(6 + i * 16 + 8);
      const offset = ico.readUInt32LE(6 + i * 16 + 12);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      expect(ico.subarray(offset + 1, offset + 4).toString()).toBe('PNG');
    }
  });
});
