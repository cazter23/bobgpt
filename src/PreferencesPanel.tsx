import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Colour, Settings } from './settings';
import { swatchBackground } from './theme';
import { CloseIcon } from './icons';

const SWATCHES: [Colour, string][] = [
  ['default', 'Default'],
  ['ocean', 'Ocean'],
  ['sunset', 'Sunset'],
  ['forest', 'Forest'],
  ['rose', 'Rose'],
  ['ember', 'Ember'],
  ['graphite', 'Graphite'],
  ['plain', 'Plain'],
];

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
  chatCount: number; // saved chats
  onExport: () => void; // save a backup file
  onImport: (file: File) => Promise<string>; // add a backup file's chats; says what happened, or throws
  onDeleteAll: () => void;
  busy: boolean; // a reply is being written
};

/** A row of buttons where exactly one is chosen. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map(([v, label]) => (
        <button key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Preferences for the whole app (not for one chat or model). Slides in from the left. */
export default function PreferencesPanel({ settings, onChange, onClose, chatCount, onExport, onImport, onDeleteAll, busy }: Props) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dataNote, setDataNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function restore(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so choosing the same file again still works
    if (!file) return;
    try {
      setDataNote(await onImport(file));
    } catch (err) {
      setDataNote(err instanceof Error ? err.message : "Couldn't read that file.");
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });

  return (
    <div className="settings-overlay from-left" onMouseDown={onClose}>
      <aside className="settings-panel left" role="dialog" aria-label="Preferences" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <h2>Preferences</h2>
          <button className="topbar-button" aria-label="Close preferences" title="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <h3 className="settings-section">Appearance</h3>

          <div className="field">
            <span className="field-label">Theme</span>
            <Segmented
              value={settings.theme}
              onChange={(theme) => set({ theme })}
              options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]}
            />
          </div>

          <div className="field">
            <span className="field-label">Colour</span>
            <div className="swatches" role="group" aria-label="Colour">
              {SWATCHES.map(([value, label]) => (
                <button
                  key={value}
                  className="swatch"
                  style={{ background: swatchBackground(value, settings.customColour) }}
                  aria-pressed={settings.colour === value}
                  aria-label={label}
                  title={label}
                  onClick={() => set({ colour: value })}
                />
              ))}
              <label
                className="swatch custom"
                style={{ background: swatchBackground('custom', settings.customColour) }}
                aria-pressed={settings.colour === 'custom'}
                title="Pick your own colour"
              >
                <input
                  type="color"
                  aria-label="Custom colour"
                  value={settings.customColour}
                  onChange={(e) => set({ colour: 'custom', customColour: e.target.value })}
                />
              </label>
            </div>
            <span className="hint">{settings.colour === 'custom' ? 'Custom' : SWATCHES.find(([v]) => v === settings.colour)?.[1]}</span>
          </div>

          <div className="field">
            <span className="field-label">Text size</span>
            <Segmented
              value={settings.textSize}
              onChange={(textSize) => set({ textSize })}
              options={[['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]}
            />
          </div>

          <div className="field">
            <span className="field-label">Thinking (reasoning models)</span>
            <Segmented
              value={settings.thinking}
              onChange={(thinking) => set({ thinking })}
              options={[['collapsed', 'Collapsed'], ['open', 'Open'], ['hidden', 'Hidden']]}
            />
          </div>

          <hr />
          <h3 className="settings-section">Behaviour</h3>

          <label className="choice">
            <input type="checkbox" checked={settings.ctrlEnterToSend} onChange={(e) => set({ ctrlEnterToSend: e.target.checked })} />
            <span>
              Ctrl+Enter to send <span className="hint">Enter then adds a new line</span>
            </span>
          </label>

          <label className="choice">
            <input type="checkbox" checked={settings.autoTitle} onChange={(e) => set({ autoTitle: e.target.checked })} />
            <span>
              Let the model name chats{' '}
              <span className="hint">Uses the loaded model for a few seconds after the first reply</span>
            </span>
          </label>

          <label className="choice">
            <input type="checkbox" checked={settings.showSpeed} onChange={(e) => set({ showSpeed: e.target.checked })} />
            <span>
              Show speed under replies <span className="hint">Tokens per second</span>
            </span>
          </label>

          <hr />
          <h3 className="settings-section">Your data</h3>

          <div className="data-actions">
            <button className="secondary-button" onClick={onExport} disabled={chatCount === 0}>
              Back up chats
            </button>
            <button className="secondary-button" onClick={() => fileInput.current?.click()} disabled={busy}>
              Restore from backup
            </button>
            <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={restore} />
          </div>
          {dataNote && <p className="hint">{dataNote}</p>}

          {confirmingDelete ? (
            <div className="confirm-inline">
              <p>
                Delete {chatCount === 1 ? 'your saved chat' : `all ${chatCount} saved chats`} and every folder? This can't be undone.
              </p>
              <div className="data-actions">
                <button className="secondary-button" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
                <button
                  className="secondary-button danger"
                  onClick={() => {
                    onDeleteAll();
                    setConfirmingDelete(false);
                    setDataNote('All chats deleted.');
                  }}
                >
                  Delete everything
                </button>
              </div>
            </div>
          ) : (
            <div className="data-actions">
              <button
                className="secondary-button danger"
                onClick={() => {
                  setDataNote(null);
                  setConfirmingDelete(true);
                }}
                disabled={busy || chatCount === 0}
              >
                Delete all chats…
              </button>
            </div>
          )}

        </div>
      </aside>
    </div>
  );
}
