import { describe, expect, it } from 'vitest';
import { CODE_FONTS, CODE_FONT_IDS, TEXT_FONTS, TEXT_FONT_IDS } from '../src/fonts';
import { COLOURS } from '../src/settings';
import { applyAppearance, applyFonts, hueOf, swatchBackground } from '../src/theme';

const root = document.documentElement;
const colourCss = () => document.getElementById('colour-theme')?.textContent ?? '';

function darkSystem(dark: boolean) {
  window.matchMedia = ((q: string) => ({ matches: dark && q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

describe('hueOf', () => {
  it('finds the hue of a colour', () => {
    expect(hueOf('#ff0000')).toBe(0);
    expect(hueOf('#00ff00')).toBe(120);
    expect(hueOf('#0000ff')).toBe(240);
  });

  it('gives greys and invalid input a fixed hue instead of failing', () => {
    expect(hueOf('#888888')).toBe(250);
    expect(hueOf('banana')).toBe(255);
  });
});

describe('applyAppearance', () => {
  it('sets the theme and text size on <html>', () => {
    applyAppearance('dark', 'large', 'default', '#7c5cff');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-size')).toBe('large');
  });

  it('sets the line spacing on <html>, and uses Normal when none is given', () => {
    applyAppearance('dark', 'medium', 'default', '#7c5cff', 'relaxed');
    expect(root.getAttribute('data-spacing')).toBe('relaxed');
    applyAppearance('dark', 'medium', 'default', '#7c5cff');
    expect(root.getAttribute('data-spacing')).toBe('normal');
  });

  it('"system" follows the computer', () => {
    darkSystem(true);
    applyAppearance('system', 'medium', 'default', '#7c5cff');
    expect(root.getAttribute('data-theme')).toBe('dark');
    darkSystem(false);
    applyAppearance('system', 'medium', 'default', '#7c5cff');
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('uses the stylesheet’s own Twilight colours in dark mode (no generated rules)', () => {
    applyAppearance('dark', 'medium', 'ocean', '#7c5cff');
    expect(document.getElementById('colour-theme')).not.toBeNull();
    applyAppearance('dark', 'medium', 'default', '#7c5cff');
    expect(document.getElementById('colour-theme')).toBeNull();
  });

  it('writes normal and incognito colours for every colour choice, in light and dark', () => {
    for (const colour of COLOURS) {
      for (const theme of ['light', 'dark'] as const) {
        applyAppearance(theme, 'medium', colour, '#33aa55');
        const css = colourCss();
        if (colour === 'default' && theme === 'dark') continue; // the stylesheet's own
        expect(css, `${colour} ${theme}`).toContain('[data-incognito]');
        expect(css, `${colour} ${theme}`).toContain('--page-incognito');
        if (colour !== 'default') expect(css, `${colour} ${theme}`).toContain('--accent-1');
        expect(css).not.toMatch(/NaN|undefined/);
      }
    }
  });

  it('makes the custom colour follow the chosen hue', () => {
    applyAppearance('dark', 'medium', 'custom', '#ff0000');
    const red = colourCss();
    applyAppearance('dark', 'medium', 'custom', '#0000ff');
    expect(colourCss()).not.toBe(red);
    expect(red).toContain('hsl(0 ');
  });

  it('makes incognito darker than the normal page in dark mode', () => {
    applyAppearance('dark', 'medium', 'ocean', '#7c5cff');
    const lightness = (name: string) => Number(new RegExp(`${name}: linear-gradient\\(135deg, hsl\\(\\d+ \\d+% (\\d+)%`).exec(colourCss())?.[1]);
    expect(lightness('--page-incognito')).toBeLessThan(lightness('--page'));
  });

  it('survives an unknown colour name', () => {
    expect(() => applyAppearance('light', 'medium', 'neon' as never, '#7c5cff')).not.toThrow();
  });
});

describe('swatchBackground', () => {
  it('gives a gradient for every colour', () => {
    for (const colour of COLOURS) expect(swatchBackground(colour, '#7c5cff')).toContain('linear-gradient');
  });
});

describe('fonts', () => {
  it('offers Comic Sans as a text font and JetBrains Mono as a code font', () => {
    expect(TEXT_FONT_IDS).toContain('comic');
    expect(CODE_FONT_IDS).toContain('jetbrains');
  });

  it('has no repeated ids, and every font has a name and a fallback stack', () => {
    expect(new Set(TEXT_FONT_IDS).size).toBe(TEXT_FONTS.length);
    expect(new Set(CODE_FONT_IDS).size).toBe(CODE_FONTS.length);
    for (const f of [...TEXT_FONTS, ...CODE_FONTS]) {
      expect(f.label).toBeTruthy();
      expect(f.stack).toContain(',');
    }
  });

  it('applyFonts sets the font variables, and falls back to the first font for an unknown id', () => {
    applyFonts('lora', 'fira');
    expect(root.style.getPropertyValue('--font-ui')).toContain('Lora');
    expect(root.style.getPropertyValue('--font-mono')).toContain('Fira Code');
    applyFonts('nonsense' as never, 'nonsense' as never);
    expect(root.style.getPropertyValue('--font-ui')).toBe(TEXT_FONTS[0].stack);
    expect(root.style.getPropertyValue('--font-mono')).toBe(CODE_FONTS[0].stack);
  });

  it('Comic Sans uses the real font first and the bundled look-alike as a fallback', () => {
    const comic = TEXT_FONTS.find((f) => f.id === 'comic')!;
    expect(comic.stack.indexOf('Comic Sans MS')).toBeLessThan(comic.stack.indexOf('Comic Neue'));
  });
});

