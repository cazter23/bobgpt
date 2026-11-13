// Settings kept in this browser's localStorage.

export type OverflowPolicy = 'keep-start' | 'drop-oldest';

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
};

export const DEFAULT_SETTINGS: Settings = {
  systemPrompt: '',
  temperature: 0.8,
  maxTokens: null,
  overflow: 'keep-start',
  models: {},
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
