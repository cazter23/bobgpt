import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getLoadedModel, streamChat, ServerUnreachableError, type ChatMessage } from './api';
import { ensureNothingLoaded, listLoaded, swapModel, tokenCounter, type ModelOption } from './lmstudio';
import ModelPicker from './ModelPicker';
import SettingsPanel from './SettingsPanel';
import { loadSettings, saveSettings, type ModelLoadSettings, type Settings } from './settings';
import { fitToContext, MessageTooLongError, tidyForModel } from './trim';
import Markdown from './Markdown';
import { splitThinking } from './thinking';
import { ComposeIcon, EditIcon, GearIcon, GhostIcon, RegenerateIcon, SendIcon, SidebarIcon, StopIcon, TrashIcon } from './icons';
import Sidebar from './Sidebar';
import CopyButton from './CopyButton';
import {
  loadChats,
  loadFolders,
  loadSidebarSize,
  saveChats,
  saveFolders,
  saveSidebarSize,
  titleFrom,
  type Chat,
  type Folder,
} from './storage';

type Status = 'checking' | 'ready' | 'no-model' | 'offline';

const STATUS_TEXT: Record<Exclude<Status, 'ready'>, string> = {
  checking: 'Connecting to LM Studio…',
  'no-model': 'No model loaded in LM Studio',
  offline: "Can't reach LM Studio",
};

/** A short line shown above the input box on an empty chat. */
function pickGreeting(): string {
  const hour = new Date().getHours();
  const timeOfDay = hour < 5 ? 'Up late?' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const options = [
    timeOfDay,
    'What can I help with?',
    "What's on your mind?",
    'Where should we start?',
    'Ask me anything',
    'Running on your PC, not the cloud',
    'Your GPU says hi (and is a little warm)',
    "Go on, I'm all tokens",
    'No subscription required',
    "I'd say I'm all ears, but I'm mostly matrices",
    'Nobody else is listening in here',
    'Thinking cap: on',
  ];
  return options[Math.floor(Math.random() * options.length)];
}

function withLast(messages: ChatMessage[], patch: Partial<ChatMessage>): ChatMessage[] {
  const copy = messages.slice();
  copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
  return copy;
}

/** Makes a textarea grow with its content (up to the max-height set in CSS). */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>) {
  // Runs after every render, so it also catches a textarea that has just appeared.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '';
    if (el.value) el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`; // + borders
  });
}

/** Enter submits, Shift+Enter adds a new line. */
function enterToSubmit(submit: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
}

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('checking');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [greeting] = useState(pickGreeting);
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [folders, setFolders] = useState<Folder[]>(loadFolders);
  const [activeId, setActiveId] = useState<string | null>(null); // null = a new chat that isn't saved yet
  const [sidebarSize, setSidebarSize] = useState(loadSidebarSize);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState<{ name: string; progress: number; stopping?: boolean; message?: string } | null>(null); // a model is being swapped
  const [modelsVersion, setModelsVersion] = useState(0); // goes up after each swap
  const [incognito, setIncognito] = useState(false); // this chat is never saved
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null); // waiting for "discard this incognito chat?"

  const abortRef = useRef<AbortController | null>(null);
  const busy = useRef(false); // true from the moment a send starts, so double-clicks can't start two replies
  const loadingRef = useRef(false); // true while a model is being swapped
  const loadAbort = useRef<AbortController | null>(null); // stops that swap
  const scrollRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useAutoGrow(inputRef);
  useAutoGrow(editRef);

  // Save chats and the sidebar size whenever they change.
  useEffect(() => {
    if (!saveChats(chats)) setError("Couldn't save your chats: the browser's storage is full or blocked.");
  }, [chats]);
  useEffect(() => {
    if (!saveFolders(folders)) setError("Couldn't save your folders: the browser's storage is full or blocked.");
  }, [folders]);
  useEffect(() => saveSidebarSize(sidebarSize), [sidebarSize]);
  useEffect(() => {
    if (!saveSettings(settings)) setError("Couldn't save your settings: the browser's storage is full or blocked.");
  }, [settings]);

  // Incognito gets its own colours (see the end of styles.css), so the whole page, not just .app, changes.
  useEffect(() => {
    const root = document.documentElement;
    if (incognito) root.setAttribute('data-incognito', '');
    else root.removeAttribute('data-incognito');
    return () => root.removeAttribute('data-incognito');
  }, [incognito]);

  /** Stores `msgs` as the content of chat `id`, creating the chat (named after its first message) if needed. */
  function commit(id: string, msgs: ChatMessage[]) {
    if (incognito) return; // incognito chats are never saved
    setChats((prev) => {
      const existing = prev.find((c) => c.id === id);
      const chat: Chat = {
        ...existing, // keeps its folder
        id,
        title: existing ? existing.title : titleFrom(msgs[0].content),
        messages: msgs,
        updatedAt: Date.now(),
      };
      return [chat, ...prev.filter((c) => c.id !== id)];
    });
  }

  // Ask LM Studio which model is loaded. Called on start, on window focus, and before each reply.
  const refreshModel = useCallback(async (): Promise<{ id: string | null; status: Status }> => {
    let id: string | null = null;
    let next: Status;
    try {
      id = await getLoadedModel();
      next = id ? 'ready' : 'no-model';
    } catch {
      next = 'offline';
    }
    setModel(id);
    setStatus(next);
    return { id, status: next };
  }, []);

  useEffect(() => {
    refreshModel();
    const onFocus = () => {
      if (!busy.current && !loadingRef.current) refreshModel();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshModel]);

  // Keep the newest text in view while streaming, unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, error]);

  /**
   * Replaces the conversation with `history` (which ends with a user message) and streams a new reply.
   * Anything that was after that point is gone for good.
   * Returns false if no reply could be started (nothing changes in that case).
   */
  async function replyTo(history: ChatMessage[]): Promise<boolean> {
    if (busy.current || loadingRef.current) return false;
    busy.current = true;
    setError(null);

    const { id: currentModel, status: current } = await refreshModel();
    if (!currentModel) {
      setError(
        current === 'offline'
          ? "Can't reach LM Studio. Make sure its server is running on port 1234 with CORS enabled."
          : 'No model is loaded in LM Studio. Load one there, then try again.',
      );
      busy.current = false;
      return false;
    }

    // Save the conversation up to here right away (so an edit or regenerate cuts the saved copy too).
    const chatId = activeId ?? crypto.randomUUID();
    if (!incognito) setActiveId(chatId);
    commit(chatId, history);

    setEditingIndex(null);
    setMessages([...history, { role: 'assistant', content: '' }]);
    setGenerating(true);
    stickToBottom.current = true;
    stream(currentModel, history, chatId);
    return true;
  }

  async function stream(currentModel: string, history: ChatMessage[], chatId: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';
    let trimmed = false;
    let frame = 0;
    let startedAt = 0; // when the first piece arrived
    let thoughtSeconds: number | undefined;
    /** The reply so far, split into its thinking (if any) and the answer. */
    const view = (streaming: boolean): Partial<ChatMessage> => {
      const { thinking, answer, open } = splitThinking(reply, streaming);
      // Done thinking once the answer starts, or once the reply is over (even if it was stopped mid-thought).
      if (thinking && (!open || !streaming) && thoughtSeconds === undefined) thoughtSeconds = (Date.now() - startedAt) / 1000;
      return {
        content: answer,
        ...(thinking ? { thinking } : {}),
        ...(thoughtSeconds !== undefined ? { thoughtSeconds } : {}),
      };
    };
    // Re-render at most once per animation frame, not once per token.
    const flush = () => {
      frame = 0;
      setMessages((prev) => withLast(prev, view(true)));
    };

    let sent = tidyForModel(history);
    try {
      // If the chat is too long for the model's context, leave out older messages (only in what is sent).
      try {
        const loaded = (await listLoaded()).find((m) => m.identifier === currentModel);
        if (loaded) {
          const count = tokenCounter(currentModel);
          const system = settings.systemPrompt.trim() ? (await count(settings.systemPrompt)) + 8 : 0;
          const budget = loaded.contextLength - (settings.maxTokens ?? 1024) - system - 32;
          const fitted = await fitToContext(tidyForModel(history), budget, settings.overflow, count);
          sent = fitted.messages;
          trimmed = fitted.trimmed;
          if (trimmed) {
            setMessages((prev) => {
              const copy = prev.slice();
              copy[copy.length - 1] = { ...copy[copy.length - 1], trimmed: true };
              return copy;
            });
          }
        }
      } catch (e) {
        if (e instanceof MessageTooLongError) throw e;
        // Couldn't ask LM Studio about the context: send everything and let it cope.
      }

      const options = { systemPrompt: settings.systemPrompt, temperature: settings.temperature, maxTokens: settings.maxTokens };
      for await (const piece of streamChat(currentModel, sent, options, controller.signal)) {
        if (!startedAt) startedAt = Date.now();
        reply += piece;
        if (!frame) frame = requestAnimationFrame(flush);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        if (e instanceof ServerUnreachableError) setStatus('offline');
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      cancelAnimationFrame(frame);
      // Keep whatever arrived; drop the reply if nothing did. Then save it.
      const finalMessages: ChatMessage[] = reply
        ? [...history, { role: 'assistant', ...view(false), ...(trimmed ? { trimmed } : {}) } as ChatMessage]
        : history;
      setMessages(finalMessages);
      commit(chatId, finalMessages);
      setGenerating(false);
      abortRef.current = null;
      busy.current = false;
      inputRef.current?.focus();
    }
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    if (await replyTo([...messages, { role: 'user', content: text }])) setInput('');
  }

  /** On a reply: replace it. On one of your messages: answer it again. Everything after is deleted. */
  function regenerate(index: number) {
    const keepThrough = messages[index].role === 'assistant' ? index - 1 : index;
    replyTo(messages.slice(0, keepThrough + 1));
  }

  /** Removes just this one message. If it was the last one, the whole chat goes. */
  function deleteMessage(index: number) {
    if (busy.current || (!activeId && !incognito)) return;
    const remaining = messages.filter((_, i) => i !== index);
    if (incognito) {
      setEditingIndex(null);
      setMessages(remaining);
      return;
    }
    if (!activeId) return;
    if (remaining.length === 0) {
      deleteChat(activeId);
      return;
    }
    setEditingIndex(null);
    setMessages(remaining);
    setChats((prev) => prev.map((c) => (c.id === activeId ? { ...c, messages: remaining } : c)));
  }

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditText(messages[index].content);
  }

  function submitEdit() {
    if (editingIndex === null) return;
    const text = editText.trim();
    if (!text) return;
    replyTo([...messages.slice(0, editingIndex), { role: 'user', content: text }]);
  }

  /** Unloads the current model and loads another, with its saved context length and GPU offload. */
  async function switchModel(key: string, name: string, options: ModelLoadSettings) {
    if (busy.current || loadingRef.current) return;
    loadingRef.current = true;
    setLoading({ name, progress: 0 });
    setError(null);
    let loaded = false;
    let stopped = false;
    const controller = new AbortController();
    loadAbort.current = controller;
    try {
      // LM Studio stops the load when asked but the SDK call never reports back, so stop waiting on cancel.
      const load = swapModel(
        key,
        options,
        (progress) => {
          if (!stopped) setLoading({ name, progress }); // late updates after a cancel or failure are ignored
        },
        controller.signal,
      );
      load.catch(() => {});
      const cancelled = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new Error('Cancelled'))),
      );
      await Promise.race([load, cancelled]);
      loaded = true;
    } catch (e) {
      stopped = true;
      if (!controller.signal.aborted) setError(`Couldn't load ${name}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!loaded) {
        // A cancelled or failed load must not leave a half-loaded model behind: wait until none is left.
        setLoading({ name, progress: 0, stopping: true });
        if (!(await ensureNothingLoaded())) {
          setError("Couldn't confirm that LM Studio finished stopping the load. Check LM Studio before loading again.");
        }
      }
      // Show what is really loaded now (which may be nothing). LM Studio's status can lag
      // for a moment after a swap, so after a successful load, ask again until it agrees.
      for (let tries = 0; tries < 8; tries++) {
        const { id } = await refreshModel();
        if (!loaded || id === key) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      loadAbort.current = null;
      loadingRef.current = false;
      setLoading(null);
      setModelsVersion((v) => v + 1);
    }
  }

  /** Unloads the model and waits until LM Studio confirms nothing is left loaded. */
  async function ejectModel(name: string) {
    if (busy.current || loadingRef.current) return;
    loadingRef.current = true;
    setLoading({ name, progress: 0, stopping: true, message: `Ejecting ${name}…` });
    setError(null);
    try {
      if (!(await ensureNothingLoaded())) setError("Couldn't confirm that LM Studio finished unloading. Check LM Studio.");
    } finally {
      await refreshModel();
      loadingRef.current = false;
      setLoading(null);
      setModelsVersion((v) => v + 1);
    }
  }

  /** Loads a model with what was chosen in the picker, and remembers it for next time. */
  function pickModel(m: ModelOption, options: ModelLoadSettings) {
    setSettings((s) => ({ ...s, models: { ...s.models, [m.key]: options } }));
    switchModel(m.key, m.name, options);
  }

  /** Shows chat `id` (or an empty new chat when null). */
  function showChat(id: string | null) {
    if (busy.current) return;
    // Leaving an incognito chat that has messages throws it away, so ask first.
    if (incognito && messages.length > 0) {
      setLeaveAction(() => () => openChat(id));
      return;
    }
    openChat(id);
  }

  /** Starts a new incognito chat, or leaves incognito if you're already in one. */
  function toggleIncognito() {
    if (busy.current) return;
    if (!incognito) {
      openChat(null);
      setIncognito(true);
    } else if (messages.length > 0) {
      setLeaveAction(() => () => openChat(null));
    } else {
      setIncognito(false);
    }
  }

  function openChat(id: string | null) {
    setIncognito(false);
    setLeaveAction(null);
    setActiveId(id);
    setMessages(chats.find((c) => c.id === id)?.messages ?? []);
    setInput('');
    setError(null);
    setEditingIndex(null);
    stickToBottom.current = true;
  }

  function renameChat(id: string, title: string) {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
  }

  function deleteChat(id: string) {
    if (busy.current) return;
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) showChat(null);
  }

  function newFolder(): string {
    const id = crypto.randomUUID();
    setFolders((prev) => [...prev, { id, name: 'New folder', collapsed: false }]);
    return id;
  }

  function renameFolder(id: string, name: string) {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
  }

  function toggleFolder(id: string) {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)));
  }

  /** Removes the folder only; its chats go back to the main list. */
  function deleteFolder(id: string) {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setChats((prev) => prev.map((c) => (c.folderId === id ? { ...c, folderId: null } : c)));
  }

  function moveChat(chatId: string, folderId: string | null) {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, folderId } : c)));
    if (folderId) setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, collapsed: false } : f)));
  }

  // Put the cursor at the end of the text when an edit box opens.
  useEffect(() => {
    const el = editRef.current;
    if (editingIndex === null || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editingIndex]);

  const composer = (
    <div className="inputbox">
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={enterToSubmit(send)}
        placeholder={loading ? `Loading ${loading.name}…` : 'Message'}
        rows={1}
        autoFocus
      />
      {generating ? (
        <button className="icon-button" aria-label="Stop" title="Stop" onClick={() => abortRef.current?.abort()}>
          <StopIcon />
        </button>
      ) : (
        <button className="icon-button" aria-label="Send" title="Send (Enter)" onClick={send} disabled={!!loading}>
          <SendIcon />
        </button>
      )}
    </div>
  );

  return (
    <div className={`app${incognito ? ' incognito' : ''}`}>
      <header className="topbar">
        {loading && !loading.stopping && <div className="load-bar" style={{ width: `${Math.round(loading.progress * 100)}%` }} />}
        <span className="topbar-left">
          {sidebarSize === 'hidden' && (
            <button className="topbar-button" aria-label="Show chats" title="Show chats" onClick={() => setSidebarSize('medium')}>
              <SidebarIcon />
            </button>
          )}
          <span className="brand">BobGPT</span>
          {incognito && <span className="incognito-tag">Incognito</span>}
        </span>
        <span className="topbar-right">
          <ModelPicker
            dot={status}
            label={status === 'ready' ? (model ?? '') : STATUS_TEXT[status]}
            mono={status === 'ready'}
            loading={loading}
            disabled={generating}
            modelSettings={settings.models}
            onSelect={pickModel}
            currentId={status === 'ready' ? model : null}
            onCancel={() => loadAbort.current?.abort()}
            onEject={ejectModel}
          />
          <button className="topbar-button" aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
            <GearIcon />
          </button>
          <button
            className={`topbar-button${incognito ? ' on' : ''}`}
            aria-label="Incognito chat"
            aria-pressed={incognito}
            title={incognito ? 'Leave incognito' : 'New incognito chat (not saved)'}
            onClick={toggleIncognito}
            disabled={generating}
          >
            <GhostIcon />
          </button>
          <button
            className="topbar-button"
            aria-label="New chat"
            title="New chat"
            onClick={() => showChat(null)}
            disabled={generating}
          >
            <ComposeIcon />
          </button>
        </span>
      </header>

      <div className="body">
        <Sidebar
          chats={chats}
          folders={folders}
          activeId={activeId}
          locked={generating}
          size={sidebarSize}
          onSize={setSidebarSize}
          onNew={() => showChat(null)}
          onOpen={showChat}
          onRename={renameChat}
          onDelete={deleteChat}
          onNewFolder={newFolder}
          onRenameFolder={renameFolder}
          onToggleFolder={toggleFolder}
          onDeleteFolder={deleteFolder}
          onMoveChat={moveChat}
        />
        <div className="pane">
          {messages.length === 0 ? (
            // Empty chat: greeting with the input box in the middle of the window.
            <main className="welcome">
              <div className="column">
                <h1 className="greeting">{incognito ? 'Incognito chat' : greeting}</h1>
                {incognito && <p className="incognito-note">Nothing here is saved. It disappears when you leave.</p>}
                {composer}
                {error && <p className="error">{error}</p>}
              </div>
            </main>
          ) : (
            <>
              <main
                className="scroll"
                ref={scrollRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                }}
              >
                <div className="column">
                  {messages.map((m, i) => {
                    const actions = (
                      <div className={`actions${generating ? ' hidden' : ''}`}>
                        {m.role === 'assistant' && <CopyButton text={m.content} />}
                        <button aria-label="Regenerate" title="Regenerate" onClick={() => regenerate(i)}>
                          <RegenerateIcon />
                        </button>
                        {m.role === 'user' && (
                          <>
                            <button aria-label="Edit" title="Edit" onClick={() => startEdit(i)}>
                              <EditIcon />
                            </button>
                            <CopyButton text={m.content} />
                          </>
                        )}
                        <button aria-label="Delete" title="Delete this message" onClick={() => deleteMessage(i)}>
                          <TrashIcon />
                        </button>
                      </div>
                    );

                    if (m.role === 'user' && i === editingIndex) {
                      return (
                        <div key={i} className="msg user editing">
                          <textarea
                            ref={editRef}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditingIndex(null);
                              else enterToSubmit(submitEdit)(e);
                            }}
                            rows={1}
                          />
                          <div className="edit-buttons">
                            <button onClick={() => setEditingIndex(null)}>Cancel</button>
                            <button className="icon-button" aria-label="Send" title="Send (Enter)" onClick={submitEdit}>
                              <SendIcon />
                            </button>
                          </div>
                        </div>
                      );
                    }

                    if (m.role === 'user') {
                      return (
                        <div key={i} className="msg user">
                          <div className="bubble">{m.content}</div>
                          {actions}
                        </div>
                      );
                    }

                    return (
                      <div key={i} className={`msg assistant${generating && i === messages.length - 1 ? ' streaming' : ''}`}>
                        {m.trimmed && <p className="trim-note">Earlier messages were left out to fit the context.</p>}
                        {m.thinking && (
                          <details className="thinking">
                            <summary>
                              {m.thoughtSeconds === undefined
                                ? 'Thinking…'
                                : `Thought for ${Math.max(1, Math.round(m.thoughtSeconds))}s`}
                            </summary>
                            <div className="thinking-text">{m.thinking}</div>
                          </details>
                        )}
                        <div className="content">
                          <Markdown text={m.content} />
                        </div>
                        {actions}
                      </div>
                    );
                  })}
                  {error && <p className="error">{error}</p>}
                </div>
              </main>

              <footer className="composer">
                <div className="column">{composer}</div>
              </footer>
            </>
          )}
        </div>
      </div>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          onReload={switchModel}
          busy={generating || !!loading}
          version={modelsVersion}
        />
      )}

      {leaveAction && (
        <div className="confirm-backdrop" onMouseDown={() => setLeaveAction(null)}>
          <div className="confirm-card" role="alertdialog" onMouseDown={(e) => e.stopPropagation()}>
            <p>Leave this incognito chat? It isn't saved, so it will be gone for good.</p>
            <div className="load-actions">
              <button className="link-button" onClick={() => setLeaveAction(null)} autoFocus>
                Stay
              </button>
              <button className="reload-button" onClick={leaveAction}>
                Discard chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
