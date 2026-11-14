import { useEffect, useState } from 'react';
import { listChatModels, listLoaded, type LoadedModel, type ModelOption } from './lmstudio';
import type { ModelLoadSettings, OverflowPolicy, Settings } from './settings';
import { CloseIcon } from './icons';

const MIN_CONTEXT = 512;

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
  onReload: (key: string, name: string, options: ModelLoadSettings) => void;
  busy: boolean; // a model is loading or a reply is being written
  version: number; // goes up after each model load, so the panel re-reads what's loaded
};

type Current = { model: ModelOption; loaded: LoadedModel };

/** The settings panel that slides in from the right. */
export default function SettingsPanel({
  settings,
  onChange,
  onClose,
  onReload,
  busy,
  version,
}: Props) {
  const [current, setCurrent] = useState<Current | null | undefined>(undefined); // undefined = still looking
  const [gpuTouched, setGpuTouched] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Find out which model is loaded, and how.
  useEffect(() => {
    let cancelled = false;
    setGpuTouched(false);
    Promise.all([listChatModels(), listLoaded()])
      .then(([models, loaded]) => {
        if (cancelled) return;
        const first = loaded[0];
        const model = first && models.find((m) => m.key === first.key);
        setCurrent(first && model ? { model, loaded: first } : null);
      })
      .catch(() => !cancelled && setCurrent(null));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const setModel = (key: string, patch: Partial<ModelLoadSettings>) =>
    set({ models: { ...settings.models, [key]: { ...settings.models[key], ...patch } } });

  const key = current?.model.key;
  const saved: ModelLoadSettings = (key && settings.models[key]) || {};
  const wantedContext = saved.contextLength ?? current?.loaded.contextLength ?? 0;
  const contextChanged = !!current && wantedContext !== current.loaded.contextLength;
  const gpuPercent = Math.round((saved.gpuOffload ?? 1) * 100);

  function reload() {
    if (!current) return;
    const maxContext = current.model.maxContext;
    const contextLength = Math.min(maxContext, Math.max(MIN_CONTEXT, wantedContext));
    const options = { ...saved, contextLength };
    setModel(current.model.key, { contextLength });
    onReload(current.model.key, current.model.name, options);
  }

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <aside className="settings-panel" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <h2>Settings</h2>
          <button className="topbar-button" aria-label="Close settings" title="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <label className="field">
            <span className="field-label">System prompt</span>
            <textarea
              value={settings.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              placeholder="Instructions the model follows in every chat"
              rows={4}
            />
          </label>

          <label className="field">
            <span className="field-label">
              Temperature <span className="field-value">{settings.temperature.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature}
              onChange={(e) => set({ temperature: Number(e.target.value) })}
            />
          </label>

          <label className="field">
            <span className="field-label">Max response length (tokens)</span>
            <input
              type="number"
              min={1}
              value={settings.maxTokens ?? ''}
              placeholder="No limit"
              onChange={(e) => set({ maxTokens: e.target.value && Number(e.target.value) > 0 ? Math.floor(Number(e.target.value)) : null })}
            />
          </label>

          <fieldset className="field">
            <legend className="field-label">When a chat is too long for the context</legend>
            {(
              [
                ['keep-start', 'Keep the start and the recent messages', 'Leaves out the middle'],
                ['drop-oldest', 'Drop the oldest messages', 'Keeps only the newest'],
              ] as [OverflowPolicy, string, string][]
            ).map(([value, title, hint]) => (
              <label key={value} className="choice">
                <input type="radio" name="overflow" checked={settings.overflow === value} onChange={() => set({ overflow: value })} />
                <span>
                  {title} <span className="hint">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <hr />

          {current === undefined && <p className="hint">Checking the loaded model…</p>}
          {current === null && <p className="hint">No model is loaded, or LM Studio can't be reached. Load one to change its settings.</p>}
          {current && (
            <>
              <h3 className="model-heading">{current.model.name}</h3>
              <p className="hint">Changing these reloads the model.</p>

              <label className="field">
                <span className="field-label">
                  Context length <span className="field-value">max {current.model.maxContext.toLocaleString()}</span>
                </span>
                <input
                  type="number"
                  min={MIN_CONTEXT}
                  max={current.model.maxContext}
                  step={1024}
                  value={wantedContext}
                  onChange={(e) => setModel(current.model.key, { contextLength: Number(e.target.value) || undefined })}
                  disabled={busy}
                />
                <span className="hint">Loaded with {current.loaded.contextLength.toLocaleString()}</span>
              </label>

              <label className="field">
                <span className="field-label">
                  GPU offload{' '}
                  <span className="field-value">
                    {saved.gpuOffload === undefined ? 'Default' : gpuPercent === 100 ? 'Max' : `${gpuPercent}%`}
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={gpuPercent}
                  onChange={(e) => {
                    setGpuTouched(true);
                    setModel(current.model.key, { gpuOffload: Number(e.target.value) / 100 });
                  }}
                  disabled={busy}
                />
                {saved.gpuOffload !== undefined && (
                  <button
                    className="link-button"
                    onClick={() => {
                      setGpuTouched(true);
                      setModel(current.model.key, { gpuOffload: undefined });
                    }}
                    disabled={busy}
                  >
                    Use LM Studio's default
                  </button>
                )}
              </label>

              {(contextChanged || gpuTouched) && (
                <button className="reload-button" onClick={reload} disabled={busy}>
                  Reload model
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
