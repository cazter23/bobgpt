// "Reduce motion" in Windows. A browser can't be switched into that mode from a test, so this reads the stylesheet itself
// and checks the shape of the rules: everything that moves is switched off, except the three things that are feedback.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles.css', 'utf8').replace(/\r\n/g, '\n');

/** The text inside every `@media (prefers-reduced-motion: reduce) { ... }`, found by matching braces. */
function reducedMotionBlocks(source: string): string[] {
  const blocks: string[] = [];
  const marker = '@media (prefers-reduced-motion: reduce)';
  let from = 0;
  while ((from = source.indexOf(marker, from)) >= 0) {
    const open = source.indexOf('{', from);
    let depth = 0;
    let i = open;
    for (; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}' && --depth === 0) break;
    }
    blocks.push(source.slice(open + 1, i));
    from = i;
  }
  return blocks;
}

const blocks = reducedMotionBlocks(css);
const all = blocks.join('\n');

describe('reduced motion', () => {
  it('switches off every animation and transition by default', () => {
    expect(all).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none\s*!important[^}]*transition:\s*none\s*!important/);
  });

  it('also switches off the colour fade when the theme changes and the incognito fade', () => {
    expect(all).toMatch(/:root,\s*body::before\s*\{\s*transition:\s*none/);
  });

  it('keeps the loading spinner turning, so a model that is loading does not look stuck', () => {
    expect(all).toMatch(/\.spinner\s*\{\s*animation:\s*spin[^}]*!important/);
    expect(css).toMatch(/@keyframes spin\b/);
  });

  it('keeps "waiting for the first word" alive, but as a fade in turn rather than bouncing dots', () => {
    expect(all).toMatch(/\.streaming \.content:empty::after\s*\{[^}]*animation:\s*dot-fade/);
    const fade = /@keyframes dot-fade\s*\{([^]*?)\n/.exec(css)![1];
    expect(fade).toContain('opacity');
    expect(fade).not.toContain('transform');
  });

  it('marks a search match with a steady highlight, since the usual fade is switched off', () => {
    expect(all).toMatch(/\.msg\.flash\s*\{[^}]*box-shadow[^}]*background/);
  });

  it('exempts nothing else: the only animations still running are the spinner and the dots', () => {
    const running = [...all.matchAll(/animation:\s*([\w-]+)/g)].map((m) => m[1]).filter((name) => name !== 'none');
    expect(new Set(running)).toEqual(new Set(['spin', 'dot-fade']));
  });
});
