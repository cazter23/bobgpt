import { useEffect, useRef, useState } from 'react';
import { listChatModels, listLoaded, type LoadedModel, type ModelOption } from './lmstudio';
import { CheckIcon, ChevronDownIcon, EjectIcon, SpinnerIcon, TrashIcon } from './icons';
import type { ModelLoadSettings, Settings } from './settings';

const MIN_CONTEXT = 512;

type Props = {
  dot: string; // status dot colour class: ready, no-model, offline, checking
  label: string; // the loaded model's name, or what's wrong
  mono: boolean; // true when the label is a model name
  loading: { name: string; progress: number; stopping?: boolean; message?: string } | null;
  disabled: boolean; // a reply is being written
  currentId: string | null; // what the top bar says is loaded
  modelSettings: Settings['models']; // each model's remembered load settings
  onSelect: (model: ModelOption, options: ModelLoadSettings) => void;
  onCancel: () => void; // stop a load in progress
  onEject: (name: string) => void; // unload the loaded model
};

type Choices = { models: ModelOption[]; loaded: LoadedModel[] };

const gigabytes = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/** The model name in the top bar. Click it to pick a different downloaded model. */
export default function ModelPicker({ dot, label, mono, loading,
  disabled,
  currentId,
  modelSettings,
  onSelect,
  onCancel,
  onEject,
}: Props) {
  const [open, setOpen] = useState(false);
  // Choosing a model first asks how to load it. These hold that step.
  const [pending, setPending] = useState<ModelOption | null>(null);
  const [contextDraft, setContextDraft] = useState('');
  const [gpuDraft, setGpuDraft] = useState<number | undefined>(undefined); // 0 to 1; undefined = LM Studio's default
  const [choices, setChoices] = useState<Choices | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Fetch the list fresh each time it opens, so new downloads and outside changes show up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChoices(null);
    setProblem(null);
    setPending(null);
    Promise.all([listChatModels(), listLoaded()])
      .then(([models, loaded]) => !cancelled && setChoices({ models, loaded }))
      .catch(() => !cancelled && setProblem("Couldn't get the model list. Is LM Studio's server running?"));
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Close on a click outside, or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); // handled here, so it doesn't also stop a reply
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const locked = disabled || !!loading;

  function startLoadStep(model: ModelOption) {
    const saved = modelSettings[model.key] ?? {};
    setContextDraft(saved.contextLength ? String(saved.contextLength) : '');
    setGpuDraft(saved.gpuOffload);
    setPending(model);
  }

  function confirmLoad() {
    if (!pending) return;
    const typed = Number(contextDraft);
    const contextLength =
      contextDraft.trim() && typed > 0 ? Math.min(pending.maxContext, Math.max(MIN_CONTEXT, Math.floor(typed))) : undefined;
    const model = pending;
    setOpen(false);
    onSelect(model, { contextLength, gpuOffload: gpuDraft });
  }

  return (
    <div className="picker" ref={wrapRef}>
      <button
        className="picker-button"
        onClick={() => setOpen((o) => !o)}
        disabled={locked}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={disabled ? 'Wait for the reply to finish' : 'Change model'}
      >
        {loading ? <SpinnerIcon /> : <span className={`dot ${dot}`} />}
        <span className={mono && !loading ? 'model' : undefined}>
          {loading
            ? loading.message
              ? loading.message
              : loading.stopping
              ? `Stopping the load of ${loading.name}…`
              : `Loading ${loading.name}… ${Math.round(loading.progress * 100)}%`
            : label}
        </span>
        {!loading && <ChevronDownIcon />}
      </button>

      {loading && !loading.stopping && (
        <button className="topbar-button" aria-label="Stop loading" title="Stop loading" onClick={onCancel}>
          <TrashIcon />
        </button>
      )}

      {open && (
        <div className="popover" role={pending ? 'dialog' : 'listbox'}>
          {pending && (
            <div className="load-step">
              <h3 className="load-title">Load {pending.name}</h3>

              <label className="field">
                <span className="field-label">
                  Context length <span className="field-value">max {pending.maxContext.toLocaleString()}</span>
                </span>
                <input
                  type="number"
                  min={MIN_CONTEXT}
                  max={pending.maxContext}
                  step={1024}
                  value={contextDraft}
                  placeholder="LM Studio's default"
                  onChange={(e) => setContextDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirmLoad()}
                  autoFocus
                />
                <span className="hint">A larger context uses more memory.</span>
              </label>

              <label className="field">
                <span className="field-label">
                  GPU offload{' '}
                  <span className="field-value">
                    {gpuDraft === undefined ? 'Default' : gpuDraft >= 1 ? 'Max' : `${Math.round(gpuDraft * 100)}%`}
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={Math.round((gpuDraft ?? 1) * 100)}
                  onChange={(e) => setGpuDraft(Number(e.target.value) / 100)}
                />
                {gpuDraft !== undefined && (
                  <button className="link-button" onClick={() => setGpuDraft(undefined)}>
                    Use LM Studio's default
                  </button>
                )}
              </label>

              <div className="load-actions">
                <button className="link-button" onClick={() => setPending(null)}>
                  Back
                </button>
                <button className="reload-button" onClick={confirmLoad}>
                  Load
                </button>
              </div>
            </div>
          )}

          {!pending && problem && <p className="popover-note">{problem}</p>}
          {!pending && !problem && !choices && <p className="popover-note">Loading models…</p>}
          {!pending && choices?.models.length === 0 && <p className="popover-note">No downloaded models found.</p>}
          {!pending && choices?.models.map((m) => {
            // Tick only the model the top bar names. (While a model is still loading, the SDK already lists it.)
            const isLoaded = !!currentId && choices.loaded.some((l) => l.identifier === currentId && l.key === m.key);
            return (
              <div key={m.key} className="popover-row">
                <button
                  className="popover-item"
                  role="option"
                  aria-selected={isLoaded}
                  onClick={() => {
                    if (isLoaded) setOpen(false);
                    else startLoadStep(m);
                  }}
                >
                  <span className="popover-check">{isLoaded && <CheckIcon />}</span>
                  <span className="popover-name">{m.name}</span>
                  <span className="popover-size">{gigabytes(m.sizeBytes)}</span>
                </button>
                {isLoaded && (
                  <button
                    className="eject-button"
                    aria-label="Eject"
                    title="Eject model"
                    onClick={() => {
                      setOpen(false);
                      onEject(m.name);
                    }}
                  >
                    <EjectIcon />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
