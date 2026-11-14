import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { generateTitle, getLoadedModel, streamChat, ServerUnreachableError, type ChatMessage } from './api';
import { ensureNothingLoaded, listLoaded, swapModel, tokenCounter, type ModelOption } from './lmstudio';
import ModelPicker from './ModelPicker';
import ContextDial from './ContextDial';
import SettingsPanel from './SettingsPanel';
import PreferencesPanel from './PreferencesPanel';
import { SETTINGS_KEY, loadSettings, saveSettings, type ModelLoadSettings, type Settings } from './settings';
import { ContextError, NoVisionError, conversationTokens, fitToContext, tidyForModel, withoutImages } from './trim';
import { addImage, forgetImages, getImages, imageIdsIn, pruneImages, shrinkImage, storeImageData, storeImages } from './images';
import { AttachmentThumb, MessageImages } from './ImageThumbs';
import MessageRow, { type RowAction } from './MessageRow';
import { splitThinking } from './thinking';
import { downloadBackup, readBackup } from './backup';
import { firstMatchIndex, searchTerms } from './search';
import { applyAppearance, applyFonts, followSystemTheme } from './theme';
import {
  CloseIcon,
  ComposeIcon,
  GearIcon,
  GhostIcon,
  PlusIcon,
  SendIcon,
  SidebarIcon,
  SlidersIcon,
  StopIcon,
} from './icons';
import Sidebar from './Sidebar';
import {
  CHATS_KEY,
  FOLDERS_KEY,
  loadChats,
  loadFolders,
  loadSidebarSize,
  saveChats,
  saveFolders,
  saveSidebarSize,
  savedChatsUnreadable,
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

const NO_VISION = "The loaded model can't see images. Load a vision model to attach them.";

/** One of your messages, with its images (if any). An edited message keeps its `id`. */
function userMessage(text: string, images: string[], id: string = crypto.randomUUID()): ChatMessage {
  return { id, role: 'user', content: text, ...(images.length ? { images } : {}) };
}

/** True while files (not, say, a chat from the sidebar) are being dragged. */
const draggingFiles = (e: { dataTransfer: DataTransfer | null }) => !!e.dataTransfer?.types.includes('Files');

function withLast(messages: ChatMessage[], patch: Partial<ChatMessage>): ChatMessage[] {
  const copy = messages.slice();
  copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch };
  return copy;
}

/**
 * Waits for `promise`, but gives up after `ms` (throwing an Error with `timeoutMessage`) or as soon as `signal`
 * is aborted (throwing its reason). For calls that could otherwise hang: LM Studio's SDK socket and IndexedDB.
 */
function within<T>(promise: Promise<T>, ms: number, timeoutMessage: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      finish();
    };
    const onAbort = () => settle(() => reject(signal!.reason));
    const timer = setTimeout(() => settle(() => reject(new Error(timeoutMessage))), ms);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    promise.then(
      (value) => settle(() => resolve(value)),
      (e) => settle(() => reject(e)),
    );
  });
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

/** Enter submits and Shift+Enter adds a new line; or, if `ctrlToSend`, Ctrl+Enter submits and Enter adds a new line. */
function enterToSubmit(submit: () => void, ctrlToSend: boolean) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const submits = ctrlToSend ? e.ctrlKey || e.metaKey : !e.shiftKey;
    if (submits) {
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
  const [settingsOpen, setSettingsOpen] = useState(false); // the gear: chat and model settings
  const [prefsOpen, setPrefsOpen] = useState(false); // the bottom-left icon: appearance, behaviour, your data

  function openPreferences() {
    setSettingsOpen(false);
    setPrefsOpen(true);
  }
  const [loading, setLoading] = useState<{ name: string; progress: number; stopping?: boolean; message?: string } | null>(null); // a model is being swapped
  const [modelsVersion, setModelsVersion] = useState(0); // goes up after each swap
  const [incognito, setIncognito] = useState(false); // this chat is never saved
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null); // waiting for "discard this incognito chat?"
  const [queue, setQueue] = useState<{ id: string; text: string; images: string[] }[]>([]); // messages waiting to be sent, one at a time, each after the previous reply
  const [attachments, setAttachments] = useState<string[]>([]); // ids of images waiting in the input box
  const [vision, setVision] = useState(false); // the loaded model can see images
  const [dragOver, setDragOver] = useState(false); // files are being dragged over the chat
  const incognitoImages = useRef(new Set<string>()); // images from this incognito chat, held only in memory
  const attachInput = useRef<HTMLInputElement>(null);
  const [searchFocus, setSearchFocus] = useState(0); // goes up on Ctrl+K, to focus the sidebar's search field
  const [jump, setJump] = useState<{ chatId: string; query: string } | null>(null); // scroll to a search match once the chat is open
  const [queueExpanded, setQueueExpanded] = useState(false); // show every queued message, not just the first few
  const [leavingItem, setLeavingItem] = useState<{ id: string; text: string; images: string[]; index: number } | null>(null); // a removed row, shrinking away
  const [queuePaused, setQueuePaused] = useState(false); // after Stop or an error, the queue waits for you
  const pendingName = useRef<{ modelId: string; chatId: string; userText: string; replyText: string } | null>(null); // a chat name still to be asked for

  const [contextSize, setContextSize] = useState(0); // how many tokens the loaded model can hold (0 = unknown)
  const [contextUsed, setContextUsed] = useState(0); // how many this chat uses
  const counters = useRef<Record<string, (text: string) => Promise<number>>>({});

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
  // Images of saved chats are kept in IndexedDB. Once no saved chat uses one (its chat or message was
  // deleted, or an edit cut the chat short) it is deleted too. Also runs on start, to tidy up.
  // Images used by the chats saved in storage are kept as well, as another tab may have chats this one doesn't know of yet.
  // Not if the saved chats couldn't be read: their images are still needed if they're rescued.
  useEffect(() => {
    if (savedChatsUnreadable()) return;
    const timer = setTimeout(() => {
      pruneImages(() => new Set([...imageIdsIn(chats), ...imageIdsIn(loadChats())])).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [chats]);

  // Say so if the saved chats couldn't be read when the app started.
  useEffect(() => {
    const problem = savedChatsUnreadable();
    if (!problem) return;
    setError(
      problem.blocked
        ? "This browser isn't letting the app use its storage, so saved chats can't be shown and new ones won't be saved."
        : problem.copiedTo
        ? `Your saved chats couldn't be read, so the list starts empty. The unreadable data was kept in this browser's storage as "${problem.copiedTo}".`
        : "Your saved chats couldn't be read, and there was no room to keep a copy. Chats won't be saved until that is sorted out, so the old ones aren't overwritten.",
    );
  }, []);

  // Another tab saved its chats, folders or settings: take them on here, so that this tab's next save doesn't
  // overwrite them. (This tab's own saves don't fire the event, and saving what was just read changes nothing.)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.storageArea !== localStorage) return;
      const all = e.key === null; // the other tab cleared the storage
      if (all || e.key === CHATS_KEY) {
        const fresh = loadChats();
        setChats(fresh);
        // If the open chat was changed there, show that, unless a reply is being written or a message edited here.
        const open = activeId ? fresh.find((c) => c.id === activeId) : undefined;
        if (open && !busy.current && editingIndex === null) {
          setMessages((prev) => (JSON.stringify(prev) === JSON.stringify(open.messages) ? prev : open.messages));
        }
      }
      if (all || e.key === FOLDERS_KEY) setFolders(loadFolders());
      if (all || e.key === SETTINGS_KEY) setSettings(loadSettings());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [activeId, editingIndex]);
  useEffect(() => {
    if (!saveSettings(settings)) setError("Couldn't save your settings: the browser's storage is full or blocked.");
  }, [settings]);

  // Theme and text size. "System" follows the computer's light/dark setting as it changes.
  useEffect(() => {
    const apply = () => applyAppearance(settings.theme, settings.textSize, settings.colour, settings.customColour);
    apply();
    if (settings.theme !== 'system') return;
    return followSystemTheme(apply);
  }, [settings.theme, settings.textSize, settings.colour, settings.customColour]);

  useEffect(() => {
    applyFonts(settings.textFont, settings.codeFont);
  }, [settings.textFont, settings.codeFont]);

  // The context dial: the loaded model's context length (and whether it can see images)...
  useEffect(() => {
    if (status !== 'ready' || !model) {
      setContextSize(0);
      setVision(false);
      return;
    }
    let cancelled = false;
    listLoaded()
      .then((loaded) => {
        if (cancelled) return;
        const m = loaded.find((m) => m.identifier === model);
        setContextSize(m?.contextLength ?? 0);
        setVision(!!m?.vision);
      })
      .catch(() => {
        if (cancelled) return;
        setContextSize(0);
        setVision(false);
      });
    return () => {
      cancelled = true;
    };
  }, [model, status, modelsVersion]);

  // ...and how much of it this chat uses. Counted by the model's own tokenizer, once a reply has finished
  // (and not while a model is being loaded or ejected, when `model` still names the one on its way out).
  const swapping = !!loading;
  useEffect(() => {
    if (!settings.showContext || !model || !contextSize || generating || swapping) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const count = (counters.current[model] ??= tokenCounter(model));
      try {
        // A model that can't see images is sent only the text, so their cost doesn't count then.
        const used = await conversationTokens(tidyForModel(vision ? messages : withoutImages(messages)), settings.systemPrompt, count);
        if (!cancelled) setContextUsed(used);
      } catch {
        /* keep the last number */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [messages, settings.systemPrompt, settings.showContext, model, contextSize, generating, vision, swapping]);

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
    if (busy.current) return false;
    if (loadingRef.current) {
      setError('Wait for the model to finish loading, then try again.');
      return false;
    }
    if (history[history.length - 1]?.role !== 'user') return false; // nothing to answer
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
      // Like any error, this pauses the queue. (A message queued meanwhile would otherwise wait for good,
      // as nothing else would tell the queue to try again.) The next reply that starts un-pauses it.
      setQueuePaused(true);
      return false;
    }

    setQueuePaused(false);

    // Images go to IndexedDB before the chat that uses them is saved (never for incognito chats).
    // (Not waited on for ever: there's no Stop button yet at this point.)
    if (!incognito) {
      try {
        await within(storeImages(history.flatMap((m) => m.images ?? [])), 15000, 'timeout');
      } catch {
        setError("Couldn't save the images in this browser's storage. They'll still be sent, but may be gone later.");
      }
    }

    // Save the conversation up to here right away (so an edit or regenerate cuts the saved copy too).
    const chatId = activeId ?? crypto.randomUUID();
    if (!incognito) setActiveId(chatId);
    commit(chatId, history);

    setEditingIndex(null);
    const replyId = crypto.randomUUID(); // the same while it streams and once it's saved
    setMessages([...history, { id: replyId, role: 'assistant', content: '' }]);
    setGenerating(true);
    stickToBottom.current = true;
    stream(currentModel, history, chatId, replyId);
    return true;
  }

  async function stream(currentModel: string, history: ChatMessage[], chatId: string, replyId: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    let reply = '';
    let trimmed = false;
    let failed = false;
    let frame = 0;
    let startedAt = 0; // when the first piece arrived
    let lastAt = 0; // when the latest one did
    const stats = { tokens: 0 };
    let thoughtSeconds: number | undefined;
    /** The reply so far, split into its thinking (if any) and the answer. */
    const view = (streaming: boolean): Partial<Omit<ChatMessage, 'id' | 'role'>> => {
      const { thinking, answer, open } = splitThinking(reply, streaming);
      // Done thinking once the answer starts, or once the reply is over (even if it was stopped mid-thought).
      if (thinking && (!open || !streaming) && thoughtSeconds === undefined) thoughtSeconds = (Date.now() - startedAt) / 1000;
      // Speed only counts once the reply is over, and only if there was enough to measure.
      const seconds = (lastAt - startedAt) / 1000;
      const tokensPerSecond = !streaming && stats.tokens > 1 && seconds > 0.3 ? Math.round((stats.tokens / seconds) * 10) / 10 : undefined;
      return {
        content: answer,
        ...(thinking ? { thinking } : {}),
        ...(thoughtSeconds !== undefined ? { thoughtSeconds } : {}),
        ...(tokensPerSecond ? { tokensPerSecond } : {}),
      };
    };
    // Re-render at most once per animation frame, not once per token.
    const flush = () => {
      frame = 0;
      setMessages((prev) => withLast(prev, view(true)));
    };

    /** If the chat is too long for the model's context, leaves out older messages (only in what is sent). */
    const fit = async (): Promise<{ messages: ChatMessage[]; trimmed: boolean } | null> => {
      const loaded = (await listLoaded()).find((m) => m.identifier === currentModel);
      if (!loaded) return null;
      // A model that can't see images gets only the text of earlier messages (the chat keeps its images).
      if (!loaded.vision && history[history.length - 1].images?.length) throw new NoVisionError();
      const shown = loaded.vision ? history : withoutImages(history);
      const count = tokenCounter(currentModel);
      const system = settings.systemPrompt.trim() ? (await count(settings.systemPrompt)) + 8 : 0;
      const budget = loaded.contextLength - (settings.maxTokens ?? 1024) - system - 32;
      return fitToContext(tidyForModel(shown), budget, settings.overflow, count);
    };

    let sent = tidyForModel(history);
    try {
      // Stop works here too, and if LM Studio doesn't answer in time the whole chat is sent and it copes.
      try {
        const fitted = await within(fit(), 15000, "LM Studio didn't answer about the model's context.", controller.signal);
        if (fitted) {
          sent = fitted.messages;
          trimmed = fitted.trimmed;
          if (trimmed) setMessages((prev) => withLast(prev, { trimmed: true }));
        }
      } catch (e) {
        if (e instanceof ContextError || controller.signal.aborted) throw e;
        // Couldn't ask LM Studio about the context: send everything and let it cope.
      }

      const options = { systemPrompt: settings.systemPrompt, temperature: settings.temperature, maxTokens: settings.maxTokens };
      const images = await within(
        getImages(sent.flatMap((m) => m.images ?? [])),
        15000,
        "Couldn't read this chat's images from the browser's storage.",
        controller.signal,
      );
      for await (const piece of streamChat(currentModel, sent, images, options, controller.signal, stats)) {
        lastAt = Date.now();
        if (!startedAt) startedAt = lastAt;
        reply += piece;
        if (!frame) frame = requestAnimationFrame(flush);
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        if (e instanceof ServerUnreachableError) setStatus('offline');
        setError(e instanceof Error ? e.message : String(e));
        failed = true;
      }
    } finally {
      cancelAnimationFrame(frame);
      // Keep whatever arrived; drop the reply if nothing did (or only blank space). Then save it.
      const final = view(false);
      const gotReply = !!(final.content || final.thinking);
      const stopped = controller.signal.aborted;
      const finalMessages: ChatMessage[] = gotReply
        ? [...history, { id: replyId, role: 'assistant', content: '', ...final, ...(trimmed ? { trimmed } : {}) }]
        : history;
      setMessages(finalMessages);
      commit(chatId, finalMessages);
      setGenerating(false);
      abortRef.current = null;
      busy.current = false;
      inputRef.current?.focus();
      if (!gotReply && !stopped && !failed) setError('The model sent back an empty reply. Try again, or try another model.');
      // Stopping a reply, or an error, pauses the queue instead of sending the next message.
      if (stopped || failed || !gotReply) setQueuePaused(true);

      // After the first reply of a saved chat, let the model write its name (if that's switched on).
      // Not after an error: the model may have been unloaded, and asking it for a name could load it again.
      if (gotReply && !stopped && !failed && !incognito && settings.autoTitle && history.length === 1 && final.content) {
        pendingName.current = { modelId: currentModel, chatId, userText: history[0].content, replyText: final.content };
      }
    }
  }

  /** Asks the model for a short name and applies it, unless the chat has been renamed in the meantime. */
  async function nameChat(modelId: string, chatId: string, userText: string, replyText: string) {
    const title = await generateTitle(modelId, userText, replyText);
    if (!title) return;
    const placeholder = titleFrom(userText);
    setChats((prev) => prev.map((c) => (c.id === chatId && c.title === placeholder ? { ...c, title } : c)));
  }

  async function send() {
    const text = input.trim();
    const images = attachments;
    if (!text && images.length === 0) return;
    if (images.length > 0 && !vision) {
      setError(NO_VISION);
      return;
    }
    // While a reply is being written, the message waits in the queue.
    if (busy.current) {
      if (loadingRef.current) return;
      setQueue((q) => [...q, { id: crypto.randomUUID(), text, images }]);
      setInput('');
      setAttachments([]);
      return;
    }
    setInput(''); // cleared at once, so a quick second Enter can't send or queue it again
    setAttachments([]);
    if (!(await replyTo([...messages, userMessage(text, images)]))) {
      setInput(text);
      setAttachments(images);
    }
  }

  /** Shrinks image files and adds them to the input box. They're kept in memory until the message is sent. */
  async function attachFiles(files: File[]) {
    if (files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) {
      setError('Only images can be attached.');
      return;
    }
    if (!vision) {
      setError(NO_VISION);
      return;
    }
    setError(null);
    for (const file of images) {
      try {
        const id = addImage(await shrinkImage(file));
        if (incognito) incognitoImages.current.add(id);
        setAttachments((a) => [...a, id]);
      } catch {
        setError("Couldn't read that image.");
      }
    }
    inputRef.current?.focus();
  }

  function removeAttachment(id: string) {
    setAttachments((a) => a.filter((x) => x !== id));
    forgetImages([id]);
  }

  // A file dropped outside the chat would make the browser open it (and leave the app), so such drops are ignored.
  useEffect(() => {
    const ignore = (e: globalThis.DragEvent) => {
      if (e.defaultPrevented || !draggingFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
      if (e.type === 'drop') setDragOver(false);
    };
    window.addEventListener('dragover', ignore);
    window.addEventListener('drop', ignore);
    return () => {
      window.removeEventListener('dragover', ignore);
      window.removeEventListener('drop', ignore);
    };
  }, []);

  // Ctrl+K: jump to the search field (opening the sidebar first if it's hidden).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (sidebarSize === 'hidden') setSidebarSize('medium');
        setSearchFocus((n) => n + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarSize]);

  // After opening a chat from a search result, scroll to the first matching message and flash it.
  useEffect(() => {
    if (!jump || activeId !== jump.chatId || messages.length === 0) return;
    setJump(null);
    const index = firstMatchIndex(messages, searchTerms(jump.query));
    const el = index >= 0 ? scrollRef.current?.querySelector<HTMLElement>(`[data-msg-index="${index}"]`) : null;
    if (!el) return;
    stickToBottom.current = false;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  }, [jump, activeId, messages]);

  // The model writes a chat's name only once it has nothing queued to answer, so it never holds up your messages.
  useEffect(() => {
    const p = pendingName.current;
    if (!p || generating || busy.current || (queue.length > 0 && !queuePaused)) return;
    pendingName.current = null;
    if (p.modelId !== model) return; // another model is loaded now, and asking the old one could load it again
    nameChat(p.modelId, p.chatId, p.userText, p.replyText);
  }, [generating, queue, queuePaused]);

  useEffect(() => {
    if (queue.length <= 3) setQueueExpanded(false);
  }, [queue.length]);

  function removeQueued(id: string) {
    const index = queue.findIndex((item) => item.id === id);
    if (index < 0) return;
    setLeavingItem({ ...queue[index], index });
    setQueue((q) => q.filter((item) => item.id !== id));
    forgetImages(queue[index].images); // never sent, so never stored
    setTimeout(() => setLeavingItem((cur) => (cur?.id === id ? null : cur)), 200);
  }

  // Sends the queue one message at a time: the next goes only once the model has finished the previous reply.
  useEffect(() => {
    if (generating || busy.current || queuePaused || queue.length === 0 || loading) return;
    const next = queue[0];
    setQueue((q) => q.slice(1));
    replyTo([...messages, userMessage(next.text, next.images)]).then((started) => {
      if (!started) {
        setQueue((q) => [next, ...q]);
        setQueuePaused(true);
      }
    });
  }, [generating, queuePaused, queue, loading, messages]);

  /**
   * The message that Regenerate at `index` answers again: that message if it's yours, otherwise your nearest
   * message before it (after a delete, two replies can be next to each other). -1 if there is none, which
   * happens when the chat starts with a reply because your first message was deleted.
   */
  function answerFor(index: number): number {
    for (let i = index; i >= 0; i--) if (messages[i].role === 'user') return i;
    return -1;
  }

  /** On a reply: replace it. On one of your messages: answer it again. Everything after is deleted. */
  function regenerate(index: number) {
    const keepThrough = answerFor(index);
    if (keepThrough >= 0) replyTo(messages.slice(0, keepThrough + 1));
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
    const { id, images = [] } = messages[editingIndex]; // an edit keeps the message's images (and its id)
    if (!text && images.length === 0) return;
    replyTo([...messages.slice(0, editingIndex), userMessage(text, images, id)]);
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
  function showChat(id: string | null, query?: string) {
    if (busy.current) return;
    // Leaving an incognito chat that has messages throws it away, so ask first.
    if (incognito && messages.length > 0) {
      setLeaveAction(() => () => openChat(id, query));
      return;
    }
    openChat(id, query);
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
      forgetIncognitoImages(attachments); // images still in the input box stay there
      setIncognito(false);
    }
  }

  /** Lets go of the incognito chat's images (they were only ever in memory), apart from `keep`. */
  function forgetIncognitoImages(keep: string[] = []) {
    const ids = incognitoImages.current;
    for (const id of keep) ids.delete(id);
    forgetImages(ids);
    ids.clear();
  }

  function openChat(id: string | null, query?: string) {
    setJump(id && query ? { chatId: id, query } : null);
    // Images waiting in the input box or the queue were never stored; they go with the chat being left.
    forgetImages([...attachments, ...queue.flatMap((item) => item.images)]);
    if (incognito) forgetIncognitoImages();
    setAttachments([]);
    setQueue([]);
    setQueuePaused(false);
    setIncognito(false);
    setLeaveAction(null);
    setActiveId(id);
    setMessages(chats.find((c) => c.id === id)?.messages ?? []);
    setInput('');
    setError(null);
    setEditingIndex(null);
    stickToBottom.current = true;
  }

  /** Adds the chats and folders from a backup file. Anything already here (same id) is left as it is. */
  async function importChats(file: File): Promise<string> {
    const backup = await readBackup(file); // throws a readable error if it isn't a backup
    const haveChat = new Set(chats.map((c) => c.id));
    const haveFolder = new Set(folders.map((f) => f.id));
    const newChats = backup.chats.filter((c) => !haveChat.has(c.id));
    const newFolders = backup.folders.filter((f) => !haveFolder.has(f.id));
    // The new chats' images are stored before the chats are added, so they're never missing.
    const used = imageIdsIn(newChats);
    try {
      await storeImageData(Object.fromEntries(Object.entries(backup.images).filter(([id]) => used.has(id))));
    } catch {
      throw new Error("Couldn't store the backup's images in this browser, so nothing was restored.");
    }
    setFolders((prev) => [...prev, ...newFolders]);
    setChats((prev) => [...prev, ...newChats].sort((a, b) => b.updatedAt - a.updatedAt));

    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const skipped = backup.chats.length - newChats.length;
    if (newChats.length === 0 && newFolders.length === 0) return `Nothing new: ${plural(skipped, 'chat')} already here.`;
    return (
      `Added ${plural(newChats.length, 'chat')}` +
      (newFolders.length ? ` and ${plural(newFolders.length, 'folder')}` : '') +
      '.' +
      (skipped ? ` ${plural(skipped, 'chat')} already here.` : '')
    );
  }

  /** Deletes every saved chat and folder (an incognito chat on screen is left alone). */
  function deleteAllChats() {
    if (busy.current) return;
    setChats([]);
    setFolders([]);
    if (activeId) openChat(null);
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

  const sendTitle = `Send (${settings.ctrlEnterToSend ? 'Ctrl+Enter' : 'Enter'})`;
  const firstUser = messages.findIndex((m) => m.role === 'user'); // replies before it have nothing to regenerate

  // The message rows' buttons all go through one function that never changes, so that MessageRow's memo can
  // skip rows that haven't changed. It calls the current version of each handler.
  const rowHandlers = useRef({ regenerate, startEdit, deleteMessage });
  useLayoutEffect(() => {
    rowHandlers.current = { regenerate, startEdit, deleteMessage };
  });
  const onRowAction = useCallback((action: RowAction, index: number) => {
    const handlers = rowHandlers.current;
    if (action === 'regenerate') handlers.regenerate(index);
    else if (action === 'edit') handlers.startEdit(index);
    else handlers.deleteMessage(index);
  }, []);

  const composer = (
    <>
      {(queue.length > 0 || leavingItem) && (
        <div className={`queue${queuePaused ? ' paused' : ''}`} aria-label="Queued messages">
          {queuePaused && queue.length > 0 && (
            <div className="queue-head">
              <span className="queue-status">
                <span className="queue-dot" />
                Paused
              </span>
              <span className="queue-actions">
                <button className="small-button" onClick={() => setQueuePaused(false)} disabled={!!loading}>
                  Resume
                </button>
                <button
                  className="small-button"
                  onClick={() => {
                    forgetImages(queue.flatMap((item) => item.images));
                    setQueue([]);
                  }}
                >
                  Clear
                </button>
              </span>
            </div>
          )}
          {(() => {
            const rows: { id: string; text: string; images: string[]; leaving?: boolean }[] = queue.map((item) => ({ ...item }));
            const imageCount = (n: number) => (n === 0 ? '' : n === 1 ? '1 image' : `${n} images`);
            if (leavingItem) rows.splice(Math.min(leavingItem.index, rows.length), 0, { ...leavingItem, leaving: true });
            const shown = queueExpanded || rows.length <= 3 ? rows : rows.slice(0, 3);
            return (
              <>
                {shown.map((row, i) => (
                  <div key={row.id} className={`queue-item${i === 0 && !row.leaving ? ' next' : ''}${row.leaving ? ' leaving' : ''}`}>
                    <span className="queue-num">{i + 1}</span>
                    <span className="queue-text" title={row.text}>
                      {[row.text, imageCount(row.images.length)].filter(Boolean).join(' · ')}
                    </span>
                    {i === 0 && !row.leaving && !queuePaused && <span className="queue-next">Up next</span>}
                    {!row.leaving && (
                      <button
                        className="queue-remove"
                        aria-label="Remove from queue"
                        title="Remove from queue"
                        onClick={() => removeQueued(row.id)}
                      >
                        <CloseIcon />
                      </button>
                    )}
                  </div>
                ))}
                {rows.length > 3 && (
                  <button className="queue-more" onClick={() => setQueueExpanded((v) => !v)}>
                    {queueExpanded ? 'Show fewer' : `+${rows.length - 3} more`}
                  </button>
                )}
              </>
            );
          })()}
        </div>
      )}
    <div className={`inputbox${queue.length > 0 ? ' has-queue' : ''}${dragOver ? ' drop-target' : ''}`}>
      {attachments.length > 0 && (
        <div className="attachments">
          {attachments.map((id) => (
            <AttachmentThumb key={id} id={id} onRemove={() => removeAttachment(id)} />
          ))}
        </div>
      )}
      {/* aria-disabled rather than disabled, so the tooltip saying why still shows */}
      <button
        className="attach-button"
        aria-label="Attach images"
        aria-disabled={!vision}
        title={vision ? 'Attach images' : 'Needs a model that can see images'}
        onClick={() => vision && attachInput.current?.click()}
      >
        <PlusIcon />
      </button>
      <input
        ref={attachInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          attachFiles([...(e.target.files ?? [])]);
          e.target.value = ''; // so choosing the same file again still works
        }}
      />
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={enterToSubmit(send, settings.ctrlEnterToSend)}
        onPaste={(e) => {
          // A pasted image is attached; if the clipboard also has text (e.g. cells copied from a spreadsheet), the text wins.
          const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
          if (files.length === 0 || e.clipboardData.types.includes('text/plain')) return;
          e.preventDefault();
          attachFiles(files);
        }}
        placeholder={loading ? `Loading ${loading.name}…` : generating ? 'Queue another message…' : 'Message'}
        rows={1}
        autoFocus
      />
      {generating && !input.trim() && attachments.length === 0 ? (
        <button className="icon-button" aria-label="Stop" title="Stop" onClick={() => abortRef.current?.abort()}>
          <StopIcon />
        </button>
      ) : (
        <button className="icon-button" aria-label="Send" title={generating ? sendTitle.replace('Send', 'Queue') : sendTitle} onClick={send} disabled={!!loading}>
          <SendIcon />
        </button>
      )}
    </div>
    </>
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
          {settings.showContext && status === 'ready' && contextSize > 0 && (
            <ContextDial used={contextUsed} size={contextSize} overflow={settings.overflow} />
          )}
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
          <button className="topbar-button" aria-label="Settings" title="Settings" onClick={() => {
              setPrefsOpen(false);
              setSettingsOpen(true);
            }}>
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
          onOpenPreferences={openPreferences}
          focusSearch={searchFocus}
        />
        <div
          className="pane"
          // Images can be dropped anywhere on the chat.
          onDragOver={(e) => {
            if (!draggingFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
          }}
          onDrop={(e) => {
            if (!draggingFiles(e)) return;
            e.preventDefault();
            setDragOver(false);
            attachFiles([...e.dataTransfer.files]);
          }}
        >
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
                    if (m.role === 'user' && i === editingIndex) {
                      return (
                        <div key={m.id} className="msg user editing">
                          {m.images?.length ? <MessageImages ids={m.images} withText={false} /> : null}
                          <textarea
                            ref={editRef}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setEditingIndex(null);
                              else enterToSubmit(submitEdit, settings.ctrlEnterToSend)(e);
                            }}
                            rows={1}
                          />
                          <div className="edit-buttons">
                            <button onClick={() => setEditingIndex(null)}>Cancel</button>
                            <button className="icon-button" aria-label="Send" title={sendTitle} onClick={submitEdit}>
                              <SendIcon />
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <MessageRow
                        key={m.id}
                        message={m}
                        index={i}
                        generating={generating}
                        streaming={generating && i === messages.length - 1}
                        canRegenerate={firstUser >= 0 && i >= firstUser}
                        thinkingView={settings.thinking}
                        showSpeed={settings.showSpeed}
                        onAction={onRowAction}
                      />
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

      {prefsOpen && (
        <PreferencesPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setPrefsOpen(false)}
          chatCount={chats.length}
          onExport={() => downloadBackup(chats, folders)}
          onImport={importChats}
          onDeleteAll={deleteAllChats}
          busy={generating}
        />
      )}

      {/* With the sidebar hidden, the preferences button stays reachable in the bottom-left corner. */}
      {sidebarSize === 'hidden' && (
        <button className="topbar-button prefs-floating" aria-label="Preferences" title="Preferences" onClick={openPreferences}>
          <SlidersIcon />
        </button>
      )}

      {leaveAction && (
        <div className="confirm-backdrop" onMouseDown={() => setLeaveAction(null)}>
          <div
            className="confirm-card"
            role="alertdialog"
            aria-labelledby="leave-title"
            aria-describedby="leave-text"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === 'Escape' && setLeaveAction(null)}
          >
            <div className="confirm-icon">
              <GhostIcon />
            </div>
            <h2 id="leave-title">Leave incognito chat?</h2>
            <p id="leave-text">Nothing in it was saved, so it will be gone for good.</p>
            <div className="confirm-actions">
              <button className="secondary-button" onClick={() => setLeaveAction(null)} autoFocus>
                Stay
              </button>
              <button className="danger-button" onClick={leaveAction}>
                Discard chat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
