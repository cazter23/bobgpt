// Settings kept in this browser's localStorage.
import { CODE_FONT_IDS, TEXT_FONT_IDS, type CodeFont, type TextFont } from './fonts';

export type OverflowPolicy = 'keep-start' | 'drop-oldest' | 'stop';
export type Theme = 'system' | 'light' | 'dark';
export type TextSize = 'small' | 'medium' | 'large';
export type LineSpacing = 'compact' | 'normal' | 'relaxed';
export type ThinkingView = 'collapsed' | 'open' | 'hidden';
export const COLOURS = ['default', 'ocean', 'sunset', 'forest', 'rose', 'ember', 'graphite', 'plain', 'custom'] as const;
export type Colour = (typeof COLOURS)[number];

/** Load settings for one model. Anything left out uses LM Studio's own default. */
export type ModelLoadSettings = {
  contextLength?: number;
  gpuOffload?: number; // 0 to 1
  keepInMemory?: boolean; // keep the whole model in memory (RAM); off unless chosen
};

export type Settings = {
  systemPrompt: string;
  temperature: number;
  maxTokens: number | null; // null = no limit
  overflow: OverflowPolicy;
  models: Record<string, ModelLoadSettings>; // by model key
  theme: Theme;
  textSize: TextSize;
  lineSpacing: LineSpacing; // the height of each line of chat text
  colour: Colour; // the background gradient and accent
  customColour: string; // "#rrggbb", used when colour is 'custom'
  textFont: TextFont;
  codeFont: CodeFont;
  thinking: ThinkingView; // how a reasoning model's thinking is shown
  ctrlEnterToSend: boolean; // false: Enter sends. true: Ctrl+Enter sends and Enter adds a new line
  autoTitle: boolean; // let the loaded model write chat names
  showSpeed: boolean; // tokens per second under each reply
  showContext: boolean; // the context dial in the top bar
};

export const DEFAULT_SETTINGS: Settings = {
  systemPrompt: '',
  temperature: 0.8,
  maxTokens: null,
  overflow: 'keep-start',
  models: {},
  theme: 'system',
  textSize: 'medium',
  lineSpacing: 'normal',
  colour: 'default',
  customColour: '#7c5cff',
  textFont: 'jakarta',
  codeFont: 'geist',
  thinking: 'collapsed',
  ctrlEnterToSend: false,
  autoTitle: true,
  showSpeed: false,
  showContext: true,
};

export const SETTINGS_KEY = 'homegpt-settings';

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return {
      systemPrompt: typeof s.systemPrompt === 'string' ? s.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
      temperature: isNumber(s.temperature) ? s.temperature : DEFAULT_SETTINGS.temperature,
      maxTokens: isNumber(s.maxTokens) && s.maxTokens > 0 ? s.maxTokens : null,
      overflow: s.overflow === 'drop-oldest' || s.overflow === 'stop' ? s.overflow : 'keep-start',
      models: s.models && typeof s.models === 'object' ? s.models : {},
      theme: s.theme === 'light' || s.theme === 'dark' ? s.theme : 'system',
      textSize: s.textSize === 'small' || s.textSize === 'large' ? s.textSize : 'medium',
      lineSpacing: s.lineSpacing === 'compact' || s.lineSpacing === 'relaxed' ? s.lineSpacing : 'normal',
      colour: COLOURS.includes(s.colour) ? s.colour : 'default',
      customColour: typeof s.customColour === 'string' && /^#[0-9a-f]{6}$/i.test(s.customColour) ? s.customColour : '#7c5cff',
      textFont: TEXT_FONT_IDS.includes(s.textFont) ? s.textFont : 'jakarta',
      codeFont: CODE_FONT_IDS.includes(s.codeFont) ? s.codeFont : 'geist',
      thinking: s.thinking === 'open' || s.thinking === 'hidden' ? s.thinking : 'collapsed',
      ctrlEnterToSend: s.ctrlEnterToSend === true,
      autoTitle: s.autoTitle !== false,
      showSpeed: s.showSpeed === true,
      showContext: s.showContext !== false,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Returns false if the browser refused (storage full or blocked). */
export function saveSettings(settings: Settings): boolean {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
