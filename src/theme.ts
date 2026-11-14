// Light/dark theme, text size and colour, applied to <html> (the default colours live in styles.css).
import { CODE_FONTS, TEXT_FONTS, type CodeFont, type TextFont } from './fonts';
import { COLOURS, type Colour, type LineSpacing, type TextSize, type Theme } from './settings';

const dark = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Hues (0-360) for the two ends of the gradient, plus how colourful it is. */
type Palette = { h1: number; h2: number; h3: number; sat: number; flat?: boolean };

const PRESETS: Record<Exclude<Colour, 'default' | 'custom'>, Palette> = {
  ocean: { h1: 175, h2: 215, h3: 195, sat: 1 },
  sunset: { h1: 25, h2: 335, h3: 5, sat: 1 },
  forest: { h1: 145, h2: 185, h3: 100, sat: 1 },
  rose: { h1: 335, h2: 275, h3: 310, sat: 1 },
  ember: { h1: 5, h2: 38, h3: 20, sat: 1 },
  graphite: { h1: 250, h2: 250, h3: 250, sat: 0 },
  plain: { h1: 255, h2: 215, h3: 255, sat: 1, flat: true },
};

/** Gradient for a swatch in Preferences. */
export function swatchBackground(colour: Colour, custom: string): string {
  const p = colour === 'default' ? { h1: 252, h2: 215, sat: 1, flat: false } : paletteFor(colour, custom);
  const s = Math.round(p.sat * 100);
  return p.flat
    ? 'linear-gradient(135deg, hsl(255 25% 96%), hsl(255 25% 88%))'
    : `linear-gradient(135deg, hsl(${p.h1} ${s}% 66%), hsl(${p.h2} ${s}% 60%))`;
}

export function hueOf(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 255;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 250; // a grey has no hue
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}

function paletteFor(colour: Colour, custom: string): Palette {
  if (colour === 'custom') {
    const h = hueOf(custom);
    return { h1: h, h2: (h + 40) % 360, h3: (h + 320) % 360, sat: 1 };
  }
  return PRESETS[colour as keyof typeof PRESETS] ?? PRESETS.ocean;
}

const mid = (a: number, b: number) => (a + ((((b - a + 540) % 360) - 180) / 2) + 360) % 360;
const warm = (h: number) => h >= 15 && h <= 190; // yellows and greens need to be darker to read on white

/** The CSS variables for a palette. Same shape as the ones in styles.css. */
/** With incognito set it's the version used inside incognito chats: darker in dark mode, dimmer and greyer in light mode. */
function variables(p: Palette, isDark: boolean, incognito = false): string {
  const { h1, h2, sat } = p;
  const s = (v: number) => Math.round(v * sat);
  const hm = mid(h1, h2);
  const c = (h: number, sPct: number, l: number, a = 1) => `hsl(${h} ${s(sPct)}% ${l}% / ${a})`;
  const tweak = (h: number) => (isDark ? 0 : h >= 150 && h <= 200 ? -22 : warm(h) ? -12 : 0); // teals and greens need to be darkest
  const grey = sat === 0;
  const a1 = isDark ? (grey ? 78 : 74) : grey ? 38 : 68 + tweak(h1);
  const a2 = isDark ? (grey ? 64 : 68) : grey ? 52 : 62 + tweak(h2);
  const b1 = grey ? 38 : 60 + tweak(h1);

  let page: string;
  let blobs: string;
  if (incognito && isDark) {
    page = p.flat ? 'hsl(255 18% 6%)' : `linear-gradient(135deg, ${c(h1, 40, 5)} 0%, ${c(hm, 40, 4.5)} 45%, ${c(h2, 46, 4)} 100%)`;
    blobs = p.flat
      ? 'linear-gradient(transparent, transparent)'
      : [
          `radial-gradient(60% 50% at 8% 10%, ${c(h1, 100, 62, 0.14)}, transparent 70%)`,
          `radial-gradient(55% 50% at 92% 88%, ${c(h2, 100, 58, 0.11)}, transparent 70%)`,
        ].join(', ');
  } else if (incognito) {
    page = p.flat ? 'hsl(255 12% 86%)' : `linear-gradient(135deg, ${c(h1, 28, 85)} 0%, ${c(hm, 28, 84)} 45%, ${c(h2, 32, 82)} 100%)`;
    blobs = p.flat
      ? 'linear-gradient(transparent, transparent)'
      : [
          `radial-gradient(60% 50% at 8% 10%, ${c(h1, 60, 70, 0.25)}, transparent 70%)`,
          `radial-gradient(55% 50% at 92% 88%, ${c(h2, 60, 66, 0.2)}, transparent 70%)`,
        ].join(', ');
  } else if (p.flat) {
    page = isDark ? 'hsl(255 18% 11%)' : 'hsl(255 25% 96%)';
    blobs = 'linear-gradient(transparent, transparent)';
  } else if (isDark) {
    // A saturated mid-dark wash goes muddy (brown, olive, grey-green), so the base is nearly black and the colour comes from the glows.
    page = `linear-gradient(135deg, ${c(h1, 42, 9)} 0%, ${c(hm, 40, 8)} 45%, ${c(h2, 46, 8)} 100%)`;
    blobs = [
      `radial-gradient(65% 55% at 6% 6%, ${c(h1, 92, 52, 0.3)}, transparent 70%)`,
      `radial-gradient(60% 55% at 94% 94%, ${c(h2, 95, 54, 0.26)}, transparent 70%)`,
    ].join(', ');
  } else {
    page = `linear-gradient(135deg, ${c(h1, 70, 93)} 0%, ${c(hm, 70, 93)} 45%, ${c(h2, 70, 92)} 100%)`;
    blobs = [
      `radial-gradient(60% 50% at 8% 10%, ${c(h1, 100, 76, 0.4)}, transparent 70%)`,
      `radial-gradient(55% 50% at 92% 88%, ${c(h2, 100, 71, 0.35)}, transparent 70%)`,
    ].join(', ');
  }

  // Solid surface for the top bar, sidebar and input box
  const surface = incognito
    ? isDark
      ? p.flat ? 'hsl(255 18% 5%)' : c(h1, 34, 5.5)
      : p.flat ? 'hsl(255 12% 91%)' : c(h1, 22, 91)
    : p.flat ? (isDark ? 'hsl(255 18% 8%)' : 'hsl(255 25% 99%)') : isDark ? c(h1, 32, 10.5) : c(h1, 70, 98);
  const panel = incognito ? (isDark ? c(h1, 36, 9) : c(h1, 40, 95)) : isDark ? c(h1, 36, 15) : c(h1, 100, 98);
  return [
    `${incognito ? '--page-incognito' : '--page'}: ${page};`,
    `${incognito ? '--blobs-incognito' : '--blobs'}: ${blobs};`,
    `--surface: ${surface};`,
    `--panel: ${panel};`, // Settings and Preferences
    `--select-bg: ${panel};`, // drop-down lists
    `--accent-1: ${c(h1, 100, a1)};`,
    `--accent-2: ${c(h2, 100, a2)};`,
    `--bubble: ${c(h1, 100, a1, isDark ? (incognito ? 0.2 : 0.22) : 0.14)};`,
    `--button: ${c(h1, 100, b1)};`,
    `--active-bg: ${c(h1, 100, a1, isDark ? 0.14 : 0.1)};`,
    // The stylesheet's dark text, links and borders are tinted for Twilight (cool lavender), which clashes with other colours.
    // Graphite stays grey, with the stylesheet's own blue for links.
    ...(isDark
      ? [
          `--text: ${c(h1, 28, 94)};`,
          `--muted: ${c(h1, 16, 69)};`,
          `--border: ${c(h1, 30, 90, 0.14)};`,
          ...(grey ? [] : [`--hl-title: ${c(h2, 100, 76)};`]),
        ]
      : []),
  ].join(' ');
}

/**
 * The colour choice goes in its own <style> element, after the main stylesheet: one rule for normal chats and
 * one for incognito chats (a darker version of the same colour). "Default" removes it, so the stylesheet's
 * colours (Twilight) apply untouched.
 */
function applyColour(colour: Colour, custom: string, isDark: boolean) {
  let el = document.getElementById('colour-theme') as HTMLStyleElement | null;
  const isDefault = colour === 'default';
  if (isDefault && isDark) {
    el?.remove(); // Twilight is the stylesheet's own colours (dark incognito included)
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = 'colour-theme';
    document.head.appendChild(el);
  }
  const palette = isDefault ? { h1: 252, h2: 215, h3: 252, sat: 1 } : paletteFor(colour, custom);
  const normal = variables(palette, isDark);
  // The page backgrounds (normal and incognito) apply in every state. Otherwise the backdrop that is fading in or out
  // would flash back to Twilight for a moment when entering or leaving incognito.
  const incognito = variables(palette, isDark, true);
  const page = /--page: [^;]*; --blobs: [^;]*;/.exec(normal)?.[0] ?? '';
  const incognitoPage = /--page-incognito: [^;]*; --blobs-incognito: [^;]*;/.exec(incognito)?.[0] ?? '';
  // [data-theme] on the selectors makes them win over the stylesheet's dark-mode and incognito rules.
  el.textContent =
    `html:root[data-theme] { ${isDefault ? '' : page} ${incognitoPage} }
` +
    (isDefault ? '' : `html:root:not([data-incognito]) { ${normal} }
`) +
    `html:root[data-incognito][data-theme] { ${incognito} }`;
}

export function applyAppearance(theme: Theme, textSize: TextSize, colour: Colour, custom: string, lineSpacing: LineSpacing = 'normal') {
  const root = document.documentElement;
  const isDark = theme === 'dark' || (theme === 'system' && dark().matches);
  root.setAttribute('data-theme', isDark ? 'dark' : 'light');
  root.setAttribute('data-size', textSize);
  root.setAttribute('data-spacing', lineSpacing);
  applyColour(COLOURS.includes(colour) ? colour : 'default', custom, isDark);
}

/** When the theme is "system", re-apply whenever the computer switches between light and dark. */
export function followSystemTheme(onChange: () => void): () => void {
  const query = dark();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Switch the text and code fonts (loading them first if they haven't been used yet). */
export function applyFonts(text: TextFont, code: CodeFont) {
  const root = document.documentElement;
  const t = TEXT_FONTS.find((f) => f.id === text) ?? TEXT_FONTS[0];
  const c = CODE_FONTS.find((f) => f.id === code) ?? CODE_FONTS[0];
  root.style.setProperty('--font-ui', t.stack);
  root.style.setProperty('--font-mono', c.stack);
  t.load?.().catch(() => {});
  c.load?.().catch(() => {});
}
