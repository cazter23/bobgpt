// Settings kept in this browser's localStorage.

export type OverflowPolicy = 'keep-start' | 'drop-oldest';
export type Theme = 'system' | 'light' | 'dark';
export type TextSize = 'small' | 'medium' | 'large';
export type ThinkingView = 'collapsed' | 'open' | 'hidden';
export const COLOURS = ['default', 'ocean', 'sunset', 'forest', 'rose', 'ember', 'graphite', 'plain', 'custom'] as const;
export type Colour = (typeof COLOURS)[number];

/** Load settings for one model. Anything left out uses LM Studio's own default. */
export type ModelLoadSettings = {
  contextLength?: number;
  gpuOffload?: number; // 0 to 1
};

export type Settings = {
  systemPrompt: string;
  temperature: number;
  maxTokens: number | null; // null = no limit
  overflow: OverflowPolicy;
  models: Record<string, ModelLoadSettings>; // by model key
  theme: Theme;
  textSize: TextSize;
  colour: Colour; // the background gradient and accent
  customColour: string; // "#rrggbb", used when colour is 'custom'
  thinking: ThinkingView; // how a reasoning model's thinking is shown
  ctrlEnterToSend: boolean; // false: Enter sends. true: Ctrl+Enter sends and Enter adds a new line
  autoTitle: boolean; // let the loaded model write chat names
  showSpeed: boolean; // tokens per second under each reply
};

export const DEFAULT_SETTINGS: Settings = {
  systemPrompt: '',
  temperature: 0.8,
  maxTokens: null,
  overflow: 'keep-start',
  models: {},
  theme: 'system',
  textSize: 'medium',
  colour: 'default',
  customColour: '#7c5cff',
  thinking: 'collapsed',
  ctrlEnterToSend: false,
  autoTitle: true,
  showSpeed: false,
};

const KEY = 'homegpt-settings';

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      systemPrompt: typeof s.systemPrompt === 'string' ? s.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
      temperature: isNumber(s.temperature) ? s.temperature : DEFAULT_SETTINGS.temperature,
      maxTokens: isNumber(s.maxTokens) && s.maxTokens > 0 ? s.maxTokens : null,
      overflow: s.overflow === 'drop-oldest' ? 'drop-oldest' : 'keep-start',
      models: s.models && typeof s.models === 'object' ? s.models : {},
      theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system',
      textSize: s.textSize === 'small' || s.textSize === 'large' ? s.textSize : 'medium',
      colour: COLOURS.includes(s.colour) ? s.colour : 'default',
      customColour: typeof s.customColour === 'string' && /^#[0-9a-f]{6}$/i.test(s.customColour) ? s.customColour : '#7c5cff',
      thinking: s.thinking === 'open' || s.thinking === 'hidden' ? s.thinking : 'collapsed',
      ctrlEnterToSend: s.ctrlEnterToSend === true,
      autoTitle: s.autoTitle !== false,
      showSpeed: s.showSpeed === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Returns false if the browser refused (storage full or blocked). */
export function saveSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
