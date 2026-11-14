import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from '../src/settings';

const store = (value: unknown) => localStorage.setItem(SETTINGS_KEY, typeof value === 'string' ? value : JSON.stringify(value));

describe('loadSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('uses the defaults when the saved data is corrupt', () => {
    store('{ not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips what was saved', () => {
    const custom = { ...DEFAULT_SETTINGS, temperature: 0.2, colour: 'ocean' as const, overflow: 'stop' as const, showSpeed: true };
    expect(saveSettings(custom)).toBe(true);
    expect(loadSettings()).toEqual(custom);
  });

  it('replaces silly values with defaults, one setting at a time', () => {
    store({
      temperature: 'hot',
      maxTokens: -5,
      overflow: 'explode',
      theme: 'purple',
      textSize: 'huge',
      colour: 'neon',
      customColour: 'red',
      textFont: 'wingdings',
      codeFont: 7,
      thinking: 'maybe',
      systemPrompt: 'Be brief.', // this one is fine, and should survive the others being bad
    });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, systemPrompt: 'Be brief.' });
  });

  it('accepts every colour, font and overflow option the app offers', () => {
    store({ colour: 'custom', customColour: '#AbCdEf', textFont: 'comic', codeFont: 'jetbrains', overflow: 'drop-oldest' });
    expect(loadSettings()).toMatchObject({ colour: 'custom', customColour: '#AbCdEf', textFont: 'comic', codeFont: 'jetbrains', overflow: 'drop-oldest' });
  });

  it('treats a max response length of 0 as "no limit"', () => {
    store({ maxTokens: 0 });
    expect(loadSettings().maxTokens).toBeNull();
  });

  it('keeps the on/off settings on their defaults unless clearly set', () => {
    store({ autoTitle: 'no', showContext: 0, ctrlEnterToSend: 'yes', showSpeed: 1 });
    expect(loadSettings()).toMatchObject({ autoTitle: true, showContext: true, ctrlEnterToSend: false, showSpeed: false });
    store({ autoTitle: false, showContext: false, ctrlEnterToSend: true, showSpeed: true });
    expect(loadSettings()).toMatchObject({ autoTitle: false, showContext: false, ctrlEnterToSend: true, showSpeed: true });
  });

  it('still reads settings under the original storage name', () => {
    expect(SETTINGS_KEY).toBe('homegpt-settings');
  });
});

describe('saveSettings', () => {
  it('reports a full or blocked storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });
});
