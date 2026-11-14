// The fonts you can choose in Preferences. All of them are bundled with the app (nothing comes from the internet).
// The two defaults are loaded at start-up (see main.tsx); the others load the first time they're needed.

export type TextFont = 'jakarta' | 'inter' | 'dm-sans' | 'lora' | 'comic' | 'system';
export type CodeFont = 'geist' | 'jetbrains' | 'fira' | 'source' | 'system';

type Font<Id extends string> = { id: Id; label: string; stack: string; load?: () => Promise<unknown> };

const UI_FALLBACK = "system-ui, 'Segoe UI', sans-serif";
const MONO_FALLBACK = "Consolas, monospace";

export const TEXT_FONTS: Font<TextFont>[] = [
  { id: 'jakarta', label: 'Plus Jakarta Sans', stack: `'Plus Jakarta Sans Variable', ${UI_FALLBACK}` },
  {
    id: 'inter',
    label: 'Inter',
    stack: `'Inter Variable', ${UI_FALLBACK}`,
    load: () => Promise.all([import('@fontsource-variable/inter'), import('@fontsource-variable/inter/wght-italic.css')]),
  },
  {
    id: 'dm-sans',
    label: 'DM Sans',
    stack: `'DM Sans Variable', ${UI_FALLBACK}`,
    load: () => Promise.all([import('@fontsource-variable/dm-sans'), import('@fontsource-variable/dm-sans/wght-italic.css')]),
  },
  {
    id: 'lora',
    label: 'Lora',
    stack: `'Lora Variable', Georgia, serif`,
    load: () => Promise.all([import('@fontsource-variable/lora'), import('@fontsource-variable/lora/wght-italic.css')]),
  },
  {
    // The real Comic Sans where the computer has it (Windows and Mac do); otherwise Comic Neue, a look-alike bundled here.
    id: 'comic',
    label: 'Comic Sans',
    stack: `'Comic Sans MS', 'Comic Sans', 'Comic Neue', cursive`,
    load: () =>
      Promise.all([
        import('@fontsource/comic-neue/latin-400.css'),
        import('@fontsource/comic-neue/latin-700.css'),
        import('@fontsource/comic-neue/latin-400-italic.css'),
      ]),
  },
  { id: 'system', label: 'System', stack: UI_FALLBACK },
];

export const CODE_FONTS: Font<CodeFont>[] = [
  { id: 'geist', label: 'Geist Mono', stack: `'Geist Mono Variable', ${MONO_FALLBACK}` },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    stack: `'JetBrains Mono Variable', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([import('@fontsource-variable/jetbrains-mono'), import('@fontsource-variable/jetbrains-mono/wght-italic.css')]),
  },
  {
    id: 'fira',
    label: 'Fira Code',
    stack: `'Fira Code Variable', ${MONO_FALLBACK}`,
    load: () => import('@fontsource-variable/fira-code'),
  },
  {
    id: 'source',
    label: 'Source Code Pro',
    stack: `'Source Code Pro Variable', ${MONO_FALLBACK}`,
    load: () =>
      Promise.all([import('@fontsource-variable/source-code-pro'), import('@fontsource-variable/source-code-pro/wght-italic.css')]),
  },
  { id: 'system', label: 'System', stack: MONO_FALLBACK },
];

export const TEXT_FONT_IDS = TEXT_FONTS.map((f) => f.id);
export const CODE_FONT_IDS = CODE_FONTS.map((f) => f.id);

/** Load every font's stylesheet, so Preferences can show each name in its own font. */
export function loadAllFonts() {
  for (const f of [...TEXT_FONTS, ...CODE_FONTS]) f.load?.().catch(() => {});
}
