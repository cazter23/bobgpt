// The app as a whole, against a pretend LM Studio. These check behaviour that is easy to break and hard to notice:
// the queue sending one message at a time, Stop, incognito never saving, Stop at limit, and search.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import * as lmstudio from '../src/lmstudio';
import { installFakeServer, type FakeServer } from './fakeLmStudio';
import { bot, chat, user as userMsg } from './helpers';

// The SDK (a WebSocket to LM Studio) is replaced. What `listLoaded` reports can be changed per test.
const sdk = vi.hoisted(() => ({
  loaded: { identifier: 'test-model', key: 'test-model', contextLength: 8192, vision: false },
}));
vi.mock('../src/lmstudio', () => ({
  listLoaded: vi.fn(async () => [sdk.loaded]),
  listChatModels: vi.fn(async () => []),
  swapModel: vi.fn(async () => {}),
  ensureNothingLoaded: vi.fn(async () => true),
  tokenCounter: () => async (text: string) => text.length, // one token per character
}));

let server: FakeServer;
let typist: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  sdk.loaded = { identifier: 'test-model', key: 'test-model', contextLength: 8192, vision: false };
});

function start({ settings = {}, chats = [] as unknown[] } = {}) {
  localStorage.setItem('homegpt-settings', JSON.stringify({ autoTitle: false, ...settings }));
  if (chats.length) localStorage.setItem('homegpt-chats', JSON.stringify(chats));
  server = installFakeServer();
  typist = userEvent.setup();
  return render(<App />);
}

const box = () => document.querySelector<HTMLTextAreaElement>('.inputbox textarea')!;
const queued = () => [...document.querySelectorAll('.queue-item:not(.leaving) .queue-text')].map((e) => e.textContent);
const savedText = () => JSON.stringify(Object.fromEntries(Object.entries(localStorage)));
const button = (name: string) => screen.getByRole('button', { name });
const topbarButton = (name: string) => within(screen.getByRole('banner')).getByRole('button', { name });

async function send(text: string) {
  await typist.click(box());
  await typist.paste(text);
  await typist.keyboard('{Enter}');
}
/** Waits until the nth chat request has reached the (pretend) LM Studio. */
const requestArrives = (n: number) => waitFor(() => expect(server.replies.length).toBeGreaterThanOrEqual(n));
const lastUserText = (reply: FakeServer['replies'][number]) => reply.body.messages.filter((m) => m.role === 'user').at(-1)?.content;

describe('sending messages', () => {
  it('shows the streamed reply and saves the chat', async () => {
    start();
    await send('Hello there');
    await requestArrives(1);
    server.replies[0].say('Hi ');
    server.replies[0].say('human!');
    server.replies[0].finish();

    expect(await screen.findByText('Hi human!')).toBeTruthy();
    await waitFor(() => expect(savedText()).toContain('Hi human!'));
    expect(document.querySelector('.chat-title')?.textContent).toBe('Hello there');
  });

  it('shows a helpful error, and keeps your message in the box, when LM Studio is not running', async () => {
    start();
    server.goOffline();
    await send('hi');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Can't reach LM Studio/);
    expect(box().value).toBe('hi');
    expect(button('Retry')).toBeTruthy();
    expect(server.replies).toHaveLength(0);
  });

  it('says so when the model sends back nothing', async () => {
    start();
    await send('hi');
    await requestArrives(1);
    server.replies[0].finish();
    expect((await screen.findByRole('alert')).textContent).toMatch(/empty reply/);
  });

  it('keeps what arrived, and shows the error, when LM Studio fails mid-reply', async () => {
    start();
    await send('hi');
    await requestArrives(1);
    server.replies[0].say('partial answer');
    server.replies[0].fail('Out of memory');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Out of memory/);
    expect(screen.getByText('partial answer')).toBeTruthy();
  });
});

describe('the prompt queue', () => {
  it('sends queued messages one at a time, each only after the previous reply has finished', async () => {
    start();
    await send('first');
    await requestArrives(1);
    server.replies[0].say('R1');

    await send('second');
    await send('third');
    await waitFor(() => expect(queued()).toEqual(['second', 'third']));
    expect(server.replies).toHaveLength(1); // nothing else sent while the first is still being written

    server.replies[0].finish();
    await requestArrives(2);
    expect(lastUserText(server.replies[1])).toBe('second');
    expect(server.replies[1].body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    await waitFor(() => expect(queued()).toEqual(['third']));
    expect(server.replies).toHaveLength(2);

    server.replies[1].say('R2');
    server.replies[1].finish();
    await requestArrives(3);
    expect(lastUserText(server.replies[2])).toBe('third');
    server.replies[2].say('R3');
    server.replies[2].finish();

    await waitFor(() => expect(queued()).toEqual([]));
    expect(server.maxOpen()).toBe(1); // never two replies at once
    await waitFor(() => expect(savedText()).toContain('R3'));
    const saved = JSON.parse(localStorage.getItem('homegpt-chats')!);
    expect(saved[0].messages.map((m: { content: string }) => m.content)).toEqual(['first', 'R1', 'second', 'R2', 'third', 'R3']);
  });

  it('shows Stop while the box is empty, and a send button once you type', async () => {
    start();
    await send('first');
    await requestArrives(1);
    expect(button('Stop')).toBeTruthy();
    await typist.type(box(), 'more');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(button('Send')).toBeTruthy();
  });

  it('Stop ends the reply and pauses the queue; Resume sends the next message', async () => {
    start();
    await send('first');
    await requestArrives(1);
    server.replies[0].say('partial');
    await screen.findByText('partial');
    await send('second');
    await waitFor(() => expect(queued()).toEqual(['second']));

    await typist.click(button('Stop'));
    expect(await screen.findByText('Paused')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.replies).toHaveLength(1); // paused: nothing new was sent
    expect(screen.getByText('partial')).toBeTruthy(); // what had arrived is kept

    await typist.click(button('Resume'));
    await requestArrives(2);
    expect(lastUserText(server.replies[1])).toBe('second');
  });

  it('keeps a message sent while paused behind the ones already waiting, in order', async () => {
    start();
    await send('first');
    await requestArrives(1);
    server.replies[0].say('partial');
    await screen.findByText('partial');
    await send('second');
    await typist.click(button('Stop'));
    await screen.findByText('Paused');
    await send('third');
    await waitFor(() => expect(queued()).toEqual(['second', 'third']));
    await typist.click(button('Resume'));
    await requestArrives(2);
    expect(lastUserText(server.replies[1])).toBe('second');
  });

  it('Clear empties a paused queue and sends nothing', async () => {
    start();
    await send('first');
    await requestArrives(1);
    await send('second');
    await typist.click(button('Stop'));
    await typist.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(queued()).toEqual([]));
    await new Promise((r) => setTimeout(r, 100));
    expect(server.replies).toHaveLength(1);
  });

  it('can take a message out of the queue', async () => {
    start();
    await send('first');
    await requestArrives(1);
    await send('second');
    await send('third');
    await waitFor(() => expect(queued()).toEqual(['second', 'third']));
    await typist.click(screen.getAllByRole('button', { name: 'Remove from queue' })[0]);
    await waitFor(() => expect(queued()).toEqual(['third']));
    server.replies[0].say('R1');
    server.replies[0].finish();
    await requestArrives(2);
    expect(lastUserText(server.replies[1])).toBe('third');
  });

  it('pauses the queue when a reply fails, instead of ploughing on', async () => {
    start();
    await send('first');
    await requestArrives(1);
    await send('second');
    server.replies[0].fail('Boom');
    await screen.findByText('Paused');
    await new Promise((r) => setTimeout(r, 100));
    expect(server.replies).toHaveLength(1);
  });
});

describe('incognito chats', () => {
  it('are never saved, and leaving one discards it', async () => {
    start();
    await typist.click(button('Incognito chat'));
    expect(document.documentElement.hasAttribute('data-incognito')).toBe(true);

    await send('my secret plan');
    await requestArrives(1);
    server.replies[0].say('a secret answer');
    server.replies[0].finish();
    await screen.findByText('a secret answer');
    await new Promise((r) => setTimeout(r, 50));

    // Nothing in storage mentions the conversation, and the sidebar lists no chat.
    expect(savedText()).not.toContain('my secret plan');
    expect(savedText()).not.toContain('a secret answer');
    expect(document.querySelectorAll('.chat-title')).toHaveLength(0);

    // Leaving asks first; staying keeps it, discarding throws it away.
    await typist.click(topbarButton('New chat'));
    const dialog = await screen.findByRole('alertdialog');
    await typist.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.getByText('a secret answer')).toBeTruthy();

    await typist.click(topbarButton('New chat'));
    await typist.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard chat' }));
    await waitFor(() => expect(screen.queryByText('a secret answer')).toBeNull());
    expect(document.documentElement.hasAttribute('data-incognito')).toBe(false);
    expect(savedText()).not.toContain('secret');
  });

  it('do not save queued messages either', async () => {
    start();
    await typist.click(button('Incognito chat'));
    await send('one');
    await requestArrives(1);
    await send('queued secret');
    server.replies[0].say('r1');
    server.replies[0].finish();
    await requestArrives(2);
    server.replies[1].say('r2');
    server.replies[1].finish();
    await screen.findByText('r2');
    await new Promise((r) => setTimeout(r, 50));
    expect(savedText()).not.toContain('queued secret');
  });
});

describe('context overflow', () => {
  it('Stop at limit sends nothing when the chat does not fit, and says why', async () => {
    sdk.loaded.contextLength = 2000;
    start({ settings: { overflow: 'stop' } });
    await send('x'.repeat(2000));
    expect((await screen.findByRole('alert')).textContent).toMatch(/context limit/);
    expect(server.replies).toHaveLength(0);
  });

  it('Truncate middle leaves old messages out of what is sent, but the saved chat keeps them all', async () => {
    sdk.loaded.contextLength = 1300; // room for about 244 tokens of chat
    const saved = chat('Long one', [userMsg('a'.repeat(100)), bot('b'.repeat(100)), userMsg('c'.repeat(100)), bot('d'.repeat(100))], {
      id: 'long',
    });
    start({ settings: { overflow: 'keep-start' }, chats: [saved] });
    await typist.click(await screen.findByText('Long one'));
    await send('e'.repeat(50));
    await requestArrives(1);

    expect(server.replies[0].body.messages).toHaveLength(1);
    expect(lastUserText(server.replies[0])).toBe('e'.repeat(50));

    server.replies[0].say('ok');
    server.replies[0].finish();
    const savedChat = () => JSON.parse(localStorage.getItem('homegpt-chats')!)[0];
    await waitFor(() => expect(savedChat().messages.at(-1).content).toBe('ok'));
    expect(savedChat().messages).toHaveLength(6); // all four old messages, the new one and its reply
  });
});

describe('search', () => {
  const chats = [
    chat('Pasta ideas', [userMsg('Give me a pasta idea'), bot('Try cacio e pepe.')], { id: 'pasta', updatedAt: 2 }),
    chat('Python help', [userMsg('How do I read a file?'), bot('Use open().')], { id: 'py', updatedAt: 1 }),
  ];

  it('finds chats by what is said in them, and Esc brings back the normal list', async () => {
    start({ chats });
    await screen.findByText('Pasta ideas');
    const search = screen.getByRole('textbox', { name: 'Search chats' });
    await typist.type(search, 'cacio');
    await waitFor(() => expect(document.querySelectorAll('.search-result')).toHaveLength(1));
    expect(document.querySelector('.search-result')?.textContent).toContain('Pasta ideas');
    expect(document.querySelector('.search-result mark')?.textContent).toBe('cacio');

    await typist.type(search, ' zebra');
    expect(await screen.findByText('No chats match.')).toBeTruthy();

    await typist.keyboard('{Escape}');
    await waitFor(() => expect(document.querySelectorAll('.chat-title')).toHaveLength(2));
    expect((search as HTMLInputElement).value).toBe('');
  });

  it('opens the chat that a result belongs to', async () => {
    start({ chats });
    await typist.type(await screen.findByRole('textbox', { name: 'Search chats' }), 'read a file');
    await typist.click(await screen.findByRole('button', { name: /Python help/ }));
    expect(await screen.findByText('Use open().')).toBeTruthy();
  });

  it('Ctrl+K jumps to the search box', async () => {
    start({ chats });
    await screen.findByText('Pasta ideas');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search chats' })));
  });
});

describe('preferences', () => {
  it('line spacing: choosing an option changes the page, is saved, and is still there after a restart', async () => {
    const view = start();
    const root = document.documentElement;
    await typist.click(button('Preferences'));
    const field = (await screen.findByText('Line spacing')).closest('.field') as HTMLElement;
    const choose = (name: string) => typist.click(within(field).getByRole('button', { name }));
    const saved = () => JSON.parse(localStorage.getItem('homegpt-settings')!).lineSpacing;

    expect(within(field).getByRole('button', { name: 'Normal' }).getAttribute('aria-pressed')).toBe('true'); // today's look is the default
    expect(root.getAttribute('data-spacing')).toBe('normal');

    await choose('Compact');
    expect(root.getAttribute('data-spacing')).toBe('compact');
    await waitFor(() => expect(saved()).toBe('compact'));
    expect(within(field).getByRole('button', { name: 'Compact' }).getAttribute('aria-pressed')).toBe('true');

    await choose('Relaxed');
    expect(root.getAttribute('data-spacing')).toBe('relaxed');
    await waitFor(() => expect(saved()).toBe('relaxed'));

    view.unmount();
    root.removeAttribute('data-spacing');
    start({ settings: { lineSpacing: 'relaxed' } });
    await waitFor(() => expect(root.getAttribute('data-spacing')).toBe('relaxed'));
  });
});

describe('two tabs open at once', () => {
  const SETTINGS = 'homegpt-settings';
  const CHATS = 'homegpt-chats';
  /** What the browser does in this tab when another tab changes saved data. */
  const otherTabSaved = (key: string) => window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
  const writes = (spy: { mock: { calls: unknown[][] } }, key: string) => spy.mock.calls.filter(([k]) => k === key).length;
  const settled = () => new Promise((resolve) => setTimeout(resolve, 150));

  it("does not start a save loop when another version of the app saves settings in its own format", async () => {
    start();
    await waitFor(() => expect(localStorage.getItem(SETTINGS)).toContain('lineSpacing'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    // An older version, which doesn't know the line spacing setting, saves its settings (without it).
    const older = JSON.parse(localStorage.getItem(SETTINGS)!);
    delete older.lineSpacing;
    localStorage.setItem(SETTINGS, JSON.stringify(older));
    setItem.mockClear();
    otherTabSaved(SETTINGS);
    await settled();

    // Nothing differs, so this tab leaves the saved settings alone. (Writing them again, in this version's
    // format, would set the other tab off, which would write its own, and so on for ever.)
    expect(writes(setItem, SETTINGS)).toBe(0);
  });

  it('still takes on a real change made in the other tab, with no more than one save', async () => {
    start();
    await waitFor(() => expect(localStorage.getItem(SETTINGS)).toContain('lineSpacing'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    localStorage.setItem(SETTINGS, JSON.stringify({ ...JSON.parse(localStorage.getItem(SETTINGS)!), lineSpacing: 'relaxed' }));
    setItem.mockClear();
    otherTabSaved(SETTINGS);

    await waitFor(() => expect(document.documentElement.getAttribute('data-spacing')).toBe('relaxed'));
    await settled();
    expect(writes(setItem, SETTINGS)).toBeLessThanOrEqual(1);
  });

  it('shows a chat saved in the other tab, and leaves unchanged chats alone', async () => {
    const mine = chat('Mine', [userMsg('hello'), bot('hi')], { id: 'mine' });
    start({ chats: [mine] });
    await screen.findByText('Mine');
    await waitFor(() => expect(localStorage.getItem(CHATS)).toContain('Mine'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    // Nothing changed: no write.
    otherTabSaved(CHATS);
    await settled();
    expect(writes(setItem, CHATS)).toBe(0);

    // A new chat appears: it is shown.
    const theirs = chat('From the other tab', [userMsg('x'), bot('y')], { id: 'theirs' });
    localStorage.setItem(CHATS, JSON.stringify([theirs, ...JSON.parse(localStorage.getItem(CHATS)!)]));
    otherTabSaved(CHATS);
    expect(await screen.findByText('From the other tab')).toBeTruthy();
  });
});

describe('keyboard shortcuts', () => {
  const press = (init: KeyboardEventInit, target: Element = document.body) => fireEvent.keyDown(target, init);
  const alt = (code: string) => press({ code, key: code.replace('Key', '').toLowerCase(), altKey: true });
  const greeting = () => document.querySelector('.greeting');
  const messageBox = () => document.querySelector<HTMLTextAreaElement>('.inputbox textarea')!;

  const alpha = chat('Alpha', [userMsg('q1'), bot('reply alpha')], { id: 'a', updatedAt: 3 });
  const beta = chat('Beta', [userMsg('q2'), bot('reply beta')], { id: 'b', updatedAt: 2 });
  const gamma = chat('Gamma', [userMsg('q3'), bot('reply gamma')], { id: 'g', updatedAt: 1 });

  it('Alt+N starts a new chat', async () => {
    start({ chats: [alpha] });
    await typist.click(await screen.findByText('Alpha'));
    expect(await screen.findByText('reply alpha')).toBeTruthy();
    alt('KeyN');
    await waitFor(() => expect(greeting()).not.toBeNull());
    expect(screen.queryByText('reply alpha')).toBeNull();
  });

  it('Alt+I starts an incognito chat, and Alt+I again leaves it', async () => {
    start();
    alt('KeyI');
    await waitFor(() => expect(document.documentElement.hasAttribute('data-incognito')).toBe(true));
    alt('KeyI');
    await waitFor(() => expect(document.documentElement.hasAttribute('data-incognito')).toBe(false));
  });

  it('Alt+I still asks before throwing away an incognito chat that has messages in it', async () => {
    start();
    alt('KeyI');
    await send('a secret');
    await requestArrives(1);
    server.replies[0].say('ok');
    server.replies[0].finish();
    await screen.findByText('ok');
    alt('KeyI');
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('ok')).toBeTruthy(); // nothing discarded yet
  });

  it('Alt+Down and Alt+Up step through the chats in the sidebar order, and stop at the ends', async () => {
    start({ chats: [alpha, beta, gamma] });
    await screen.findByText('Alpha');
    alt('ArrowDown'); // from a new chat: the first
    expect(await screen.findByText('reply alpha')).toBeTruthy();
    alt('ArrowDown');
    expect(await screen.findByText('reply beta')).toBeTruthy();
    alt('ArrowDown');
    expect(await screen.findByText('reply gamma')).toBeTruthy();
    alt('ArrowDown'); // the last one: stays
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('reply gamma')).toBeTruthy();
    alt('ArrowUp');
    expect(await screen.findByText('reply beta')).toBeTruthy();
  });

  it('"/" jumps to the message box, but is just a slash while you are typing in another field', async () => {
    start({ chats: [alpha] });
    await screen.findByText('Alpha');
    (document.activeElement as HTMLElement | null)?.blur();
    press({ key: '/', code: 'Slash' });
    await waitFor(() => expect(document.activeElement).toBe(messageBox()));

    const search = screen.getByRole('textbox', { name: 'Search chats' });
    search.focus();
    const slash = new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true, cancelable: true });
    search.dispatchEvent(slash);
    expect(slash.defaultPrevented).toBe(false); // left alone, so the slash is typed
    expect(document.activeElement).toBe(search);
  });

  it('Alt+C copies the newest reply and keeps its buttons showing for a moment', async () => {
    start({ chats: [alpha] });
    // After start(): the test library's own userEvent.setup() installs a clipboard of its own, which this replaces.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await typist.click(await screen.findByText('Alpha'));
    await screen.findByText('reply alpha');
    alt('KeyC');
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('reply alpha'));
    expect(document.querySelector('.msg.assistant')!.classList.contains('show-actions')).toBe(true);
  });

  it('does nothing with other modifiers (Shift, Ctrl, or AltGr, which sends Ctrl too)', async () => {
    start({ chats: [alpha] });
    await typist.click(await screen.findByText('Alpha'));
    await screen.findByText('reply alpha');
    press({ code: 'KeyN', key: 'N', altKey: true, shiftKey: true });
    press({ code: 'KeyN', key: 'n', altKey: true, ctrlKey: true });
    press({ code: 'KeyN', key: 'n' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('reply alpha')).toBeTruthy();
  });

  it('is ignored while Preferences is open', async () => {
    start({ chats: [alpha] });
    await typist.click(await screen.findByText('Alpha'));
    await screen.findByText('reply alpha');
    await typist.click(button('Preferences'));
    await screen.findByText('Line spacing');
    alt('KeyN');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('reply alpha')).toBeTruthy();
  });

  it('while a reply is being written, Alt+N and Alt+Up/Down still move between chats, but Alt+I and Alt+C are ignored, and "/" still works', async () => {
    start({ chats: [alpha, beta] });
    await typist.click(await screen.findByText('Alpha'));
    await screen.findByText('reply alpha');
    await send('another question');
    await requestArrives(1);

    alt('KeyI');
    await new Promise((r) => setTimeout(r, 50));
    expect(document.documentElement.hasAttribute('data-incognito')).toBe(false);

    alt('ArrowDown');
    expect(await screen.findByText('reply beta')).toBeTruthy(); // the reply carries on in Alpha
    alt('KeyN');
    await waitFor(() => expect(greeting()).not.toBeNull());

    (document.activeElement as HTMLElement | null)?.blur();
    press({ key: '/', code: 'Slash' });
    await waitFor(() => expect(document.activeElement).toBe(messageBox()));
  });
});

describe('New chat in folder', () => {
  const seedFolders = () =>
    localStorage.setItem(
      'homegpt-folders',
      JSON.stringify([
        { id: 'f1', name: 'Work', collapsed: false },
        { id: 'f2', name: 'Play', collapsed: true },
      ]),
    );
  const openFolderMenu = async (name: string) => {
    await typist.click(await screen.findByRole('button', { name: `Options for folder "${name}"` }));
    return screen.findByRole('menu');
  };
  const chooseNewChatIn = async (name: string) => {
    const menu = await openFolderMenu(name);
    await typist.click(within(menu).getByRole('menuitem', { name: 'New chat in folder' }));
  };
  const savedChats = () => JSON.parse(localStorage.getItem('homegpt-chats') ?? '[]');
  const inFolder = (name: string) => [...document.querySelectorAll(`.folder:has(button[title="${name}"]) .chat-title`)].map((e) => e.textContent);
  const rename = async (from: string, to: string) => {
    await typist.click(await screen.findByRole('button', { name: `Options for chat "${from}"` }));
    await typist.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Rename' }));
    await typist.keyboard(`${to}{Enter}`);
  };
  const reply = async (text: string, n = 1) => {
    await requestArrives(n);
    server.replies[n - 1].say(text);
    server.replies[n - 1].finish();
    await screen.findByText(text);
  };

  it("is the first choice in a folder's menu, and is not in a chat's menu", async () => {
    seedFolders();
    start({ chats: [chat('Some chat', [userMsg('q'), bot('a')], { id: 'c1', folderId: 'f1' })] });
    const menu = await openFolderMenu('Work');
    const items = within(menu).getAllByRole('menuitem').map((el) => el.textContent);
    expect(items).toEqual(['New chat in folder', 'Rename', 'Delete']);
    await typist.keyboard('{Escape}');

    await typist.click(await screen.findByRole('button', { name: 'Options for chat "Some chat"' }));
    const chatItems = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((el) => el.textContent);
    expect(chatItems).not.toContain('New chat in folder');
  });

  it('puts an "Unnamed chat" in the folder at once, before anything is sent', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    expect(inFolder('Work')).toEqual(['Unnamed chat']);
    expect(document.querySelector('.greeting')).not.toBeNull();
    expect(document.querySelector('.chat-row.active .chat-title')?.textContent).toBe('Unnamed chat');
  });

  it("is named after your first message, if you didn't name it, and stays in the folder", async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    await send('Hello there');
    await reply('Hi!');
    await waitFor(() => expect(inFolder('Work')).toEqual(['Hello there']));
    expect(savedChats()).toHaveLength(1);
    expect(savedChats()[0].folderId).toBe('f1');
  });

  it('can be named before you send anything, and keeps that name', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    await rename('Unnamed chat', 'Trip plans');
    expect(inFolder('Work')).toEqual(['Trip plans']);
    await send('Where should we go?');
    await reply('Lisbon.');
    await waitFor(() => expect(savedChats()[0].messages).toHaveLength(2));
    expect(inFolder('Work')).toEqual(['Trip plans']);
  });

  it('opens a collapsed folder, so you can see the new chat', async () => {
    seedFolders();
    start();
    const title = await screen.findByTitle('Play'); // the folder's own button (the ⋯ button has a longer name)
    expect(title.getAttribute('aria-expanded')).toBe('false');
    await chooseNewChatIn('Play');
    await waitFor(() => expect(screen.getByTitle('Play').getAttribute('aria-expanded')).toBe('true'));
    expect(inFolder('Play')).toEqual(['Unnamed chat']);
  });

  it('is thrown away if you leave it still empty and unnamed', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    expect(inFolder('Work')).toEqual(['Unnamed chat']);
    await typist.click(topbarButton('New chat'));
    await waitFor(() => expect(inFolder('Work')).toEqual([]));
    expect(savedChats()).toHaveLength(0);
  });

  it('is kept if you named it, even when you leave it empty, and is still there after a restart', async () => {
    seedFolders();
    const { unmount } = start();
    await chooseNewChatIn('Work');
    await rename('Unnamed chat', 'Later');
    await typist.click(topbarButton('New chat'));
    expect(inFolder('Work')).toEqual(['Later']);
    await waitFor(() => expect(savedChats().map((c: { title: string }) => c.title)).toEqual(['Later']));
    unmount();
    start();
    await waitFor(() => expect(inFolder('Work')).toEqual(['Later']));
  });

  it('a new chat after it, from the ordinary button, is saved outside any folder', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    await typist.click(topbarButton('New chat'));
    await send('Loose chat');
    await reply('ok');
    await waitFor(() => expect(savedChats()).toHaveLength(1));
    expect(savedChats()[0].folderId ?? null).toBeNull();
  });

  it('keeps the chat in its folder for the rest of the conversation', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    await send('first');
    await reply('one');
    await send('second');
    await reply('two', 2);
    await waitFor(() => expect(savedChats()[0].messages).toHaveLength(4));
    expect(savedChats()).toHaveLength(1);
    expect(savedChats()[0].folderId).toBe('f1');
  });

  it('goes to the main list if the folder is deleted before you send anything', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    const menu = await openFolderMenu('Work');
    await typist.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await typist.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByTitle('Work')).toBeNull());

    await send('after the folder went');
    await reply('ok');
    await waitFor(() => expect(savedChats()).toHaveLength(1));
    expect(savedChats()[0].folderId ?? null).toBeNull();
  });

  it('asks before leaving an incognito chat that has messages, and only then opens the folder chat', async () => {
    seedFolders();
    start();
    await typist.click(button('Incognito chat'));
    await send('secret');
    await reply('shh');

    await chooseNewChatIn('Work');
    const dialog = await screen.findByRole('alertdialog');
    expect(inFolder('Work')).toEqual([]); // nothing has changed yet
    await typist.click(within(dialog).getByRole('button', { name: 'Discard chat' }));
    await waitFor(() => expect(inFolder('Work')).toEqual(['Unnamed chat']));
    expect(document.documentElement.hasAttribute('data-incognito')).toBe(false);
  });
});

describe('looking at other chats while a reply is being written', () => {
  const alpha = chat('Alpha', [userMsg('q1'), bot('reply alpha')], { id: 'a', updatedAt: 2 });
  const beta = chat('Beta', [userMsg('q2'), bot('reply beta')], { id: 'b', updatedAt: 1 });
  const alt = (code: string) => fireEvent.keyDown(document.body, { code, key: code.replace('Key', '').toLowerCase(), altKey: true });
  const savedChats = () => JSON.parse(localStorage.getItem('homegpt-chats') ?? '[]');
  const open = async (title: string) => typist.click(await screen.findByText(title));

  /** Alpha is open, you've sent a question, and the first words of the reply are in. */
  async function writingInAlpha() {
    start({ chats: [alpha, beta] });
    await open('Alpha');
    await screen.findByText('reply alpha');
    await send('another question');
    await requestArrives(1);
    server.replies[0].say('part one');
    await screen.findByText('part one');
  }

  it('lets you open another chat, and the reply carries on in its own chat, not in the one you opened', async () => {
    await writingInAlpha();
    await open('Beta');
    expect(await screen.findByText('reply beta')).toBeTruthy();
    expect(screen.queryByText('part one')).toBeNull();

    server.replies[0].say(' part two');
    await new Promise((r) => setTimeout(r, 60));
    expect(screen.queryByText(/part two/)).toBeNull();
    expect(screen.getByText('reply beta')).toBeTruthy();

    server.replies[0].finish();
    await waitFor(() => expect(savedChats().find((c: { id: string }) => c.id === 'a').messages.at(-1).content).toBe('part one part two'));
    expect(screen.queryByText(/part two/)).toBeNull(); // still Beta on screen
  });

  it('shows the reply so far when you come back to its chat, and goes on streaming there', async () => {
    await writingInAlpha();
    await open('Beta');
    await screen.findByText('reply beta');
    server.replies[0].say(' part two');
    await open('Alpha');
    expect(await screen.findByText('part one part two')).toBeTruthy();
    expect(document.querySelector('.msg.streaming')).not.toBeNull();
    server.replies[0].say(' part three');
    expect(await screen.findByText('part one part two part three')).toBeTruthy();
    server.replies[0].finish();
    await waitFor(() => expect(document.querySelector('.msg.streaming')).toBeNull());
  });

  it('marks the chat being written in, and its Delete is off while the others stay on', async () => {
    await writingInAlpha();
    await open('Beta');
    expect(document.querySelector('.chat-row.writing .chat-title')?.textContent).toBe('Alpha');
    await typist.click(await screen.findByRole('button', { name: 'Options for chat "Alpha"' }));
    const deleteOf = (menu: HTMLElement) => (within(menu).getByRole('menuitem', { name: 'Delete' }) as HTMLButtonElement).disabled;
    expect(deleteOf(await screen.findByRole('menu'))).toBe(true);
    await typist.keyboard('{Escape}');
    await typist.click(await screen.findByRole('button', { name: 'Options for chat "Beta"' }));
    expect(deleteOf(await screen.findByRole('menu'))).toBe(false);
  });

  it('lets you rename the chat being written in, and the name stays when the reply finishes', async () => {
    await writingInAlpha();
    await typist.click(await screen.findByRole('button', { name: 'Options for chat "Alpha"' }));
    await typist.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Rename' }));
    await typist.keyboard('Renamed{Enter}');
    expect((await screen.findAllByText('Renamed')).length).toBeGreaterThan(0);
    server.replies[0].finish();
    await waitFor(() => expect(savedChats().find((c: { id: string }) => c.id === 'a').messages.at(-1).content).toBe('part one'));
    expect(savedChats().find((c: { id: string }) => c.id === 'a').title).toBe('Renamed');
  });

  it('does not send from another chat until the reply is done, and keeps what you typed', async () => {
    await writingInAlpha();
    await open('Beta');
    await screen.findByText('reply beta');
    expect(box().placeholder).toMatch(/another chat/);
    await typist.click(box());
    await typist.paste('my draft');
    await typist.keyboard('{Enter}');
    await new Promise((r) => setTimeout(r, 60));
    expect(server.replies).toHaveLength(1);
    expect(box().value).toBe('my draft');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    server.replies[0].finish();
    await waitFor(() => expect(box().placeholder).toBe('Message'));
    await typist.keyboard('{Enter}');
    await requestArrives(2);
    expect(lastUserText(server.replies[1])).toBe('my draft');
  });

  it('keeps queued messages with their chat: they wait while you are elsewhere, and go once you are back', async () => {
    await writingInAlpha();
    await send('queued one');
    await waitFor(() => expect(queued()).toEqual(['queued one']));
    await open('Beta');
    await screen.findByText('reply beta');
    expect(queued()).toEqual([]); // not shown in Beta

    server.replies[0].finish();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.replies).toHaveLength(1); // not sent into Beta, nor into Alpha behind your back

    await open('Alpha');
    await requestArrives(2);
    expect(lastUserText(server.replies[1])).toBe('queued one');
    expect(server.replies[1].body.messages.map((m) => m.content)).toContain('part one');
  });

  it('Esc stops the reply only in the chat it is being written in', async () => {
    await writingInAlpha();
    await open('Beta');
    await screen.findByText('reply beta');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 50));
    server.replies[0].say(' part two'); // not stopped: more still arrives
    server.replies[0].finish();
    await waitFor(() => expect(savedChats().find((c: { id: string }) => c.id === 'a').messages.at(-1).content).toBe('part one part two'));
  });

  it('Alt+N and the New chat button work meanwhile, but starting an incognito chat does not', async () => {
    await writingInAlpha();
    alt('KeyN');
    await waitFor(() => expect(document.querySelector('.greeting')).not.toBeNull());
    expect((topbarButton('Incognito chat') as HTMLButtonElement).disabled).toBe(true);
    alt('KeyI');
    await new Promise((r) => setTimeout(r, 50));
    expect(document.documentElement.hasAttribute('data-incognito')).toBe(false);
    await typist.click(topbarButton('New chat'));
    expect(document.querySelector('.greeting')).not.toBeNull();
  });

  it('an incognito chat being written cannot be left, since it would be lost', async () => {
    start({ chats: [alpha] });
    await typist.click(topbarButton('Incognito chat'));
    await send('secret');
    await requestArrives(1);
    server.replies[0].say('shh');
    await screen.findByText('shh');
    await open('Alpha').catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('shh')).toBeTruthy();
    expect(document.documentElement.hasAttribute('data-incognito')).toBe(true);
  });

  it('the Copy button on a queued message copies its text', async () => {
    start({ chats: [alpha] });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await open('Alpha');
    await screen.findByText('reply alpha');
    await send('first');
    await requestArrives(1);
    await send('please copy me');
    await waitFor(() => expect(queued()).toEqual(['please copy me']));
    const item = document.querySelector('.queue-item') as HTMLElement;
    await typist.click(within(item).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('please copy me');
    expect(queued()).toEqual(['please copy me']); // still queued
  });
});

describe('loading a model', () => {
  const pick = async () => {
    vi.mocked(lmstudio.listChatModels).mockResolvedValue([{ key: 'other', name: 'Other model', sizeBytes: 4e9, maxContext: 8192 }]);
    vi.mocked(lmstudio.swapModel).mockClear();
    start();
    await typist.click(await screen.findByTitle('Change model'));
    await typist.click(await screen.findByRole('option', { name: /Other model/ }));
  };
  const keep = () => screen.getByRole('checkbox', { name: /Keep model in memory/ }) as HTMLInputElement;

  it('has "Keep model in memory" off by default, and loads the model without it', async () => {
    await pick();
    expect(keep().checked).toBe(false);
    await typist.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(lmstudio.swapModel).toHaveBeenCalled());
    expect(vi.mocked(lmstudio.swapModel).mock.calls[0][1].keepInMemory).toBeFalsy();
  });

  it('loads it kept in memory when you tick the box, and remembers that for the model', async () => {
    await pick();
    await typist.click(keep());
    await typist.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(lmstudio.swapModel).toHaveBeenCalled());
    expect(vi.mocked(lmstudio.swapModel).mock.calls[0][1].keepInMemory).toBe(true);
    expect(JSON.parse(localStorage.getItem('homegpt-settings')!).models.other.keepInMemory).toBe(true);
  });
});

describe('scrolling while a reply is being written', () => {
  const alpha = chat('Alpha', [userMsg('q1'), bot('reply alpha')], { id: 'a', updatedAt: 1 });
  const VIEW = 500; // the height of the chat area

  /**
   * The test browser has no layout, so the chat area is given a height and a scroll position that the test controls.
   * Like a real browser, it reports a scroll after the page sets its position.
   */
  function fakeScroller() {
    const el = document.querySelector<HTMLElement>('main.scroll')!;
    const view = { height: 3000, top: 0 };
    Object.defineProperty(el, 'scrollHeight', { get: () => view.height, configurable: true });
    Object.defineProperty(el, 'clientHeight', { get: () => VIEW, configurable: true });
    Object.defineProperty(el, 'clientWidth', { get: () => 800, configurable: true });
    Object.defineProperty(el, 'scrollTop', {
      get: () => view.top,
      set: (value: number) => {
        view.top = Math.min(value, view.height - VIEW); // can't go below the end, as in a browser
        setTimeout(() => el.dispatchEvent(new Event('scroll')));
      },
      configurable: true,
    });
    const bottom = () => view.height - VIEW;
    /** You scroll to a position (a distance above the very bottom). */
    const scrollTo = (aboveBottom: number) => {
      view.top = bottom() - aboveBottom;
      fireEvent.scroll(el);
    };
    return { el, view, bottom, scrollTo };
  }

  /** A chat is open, you have sent a message, and the first piece of the reply has arrived. */
  async function streaming() {
    start({ chats: [alpha] });
    await typist.click(await screen.findByText('Alpha'));
    await screen.findByText('reply alpha');
    const scroller = fakeScroller();
    await send('another question');
    await requestArrives(1);
    server.replies[0].say('first');
    await waitFor(() => expect(document.querySelector('.msg.streaming .content')?.textContent).toContain('first'));
    await new Promise((r) => setTimeout(r, 20));
    // The next piece of the reply: the page grows by `grow` pixels.
    const nextPiece = async (word: string, grow = 100) => {
      scroller.view.height += grow;
      server.replies[0].say(` ${word}`);
      await waitFor(() => expect(document.querySelector('.msg.streaming .content')?.textContent).toContain(word));
      await new Promise((r) => setTimeout(r, 20));
    };
    return { ...scroller, nextPiece };
  }

  it('follows the reply down the page while you leave it alone', async () => {
    const s = await streaming();
    await s.nextPiece('second');
    expect(s.view.top).toBe(s.bottom());
    await s.nextPiece('third', 300);
    expect(s.view.top).toBe(s.bottom());
  });

  it('stops following as soon as you wheel up, even for a small scroll that is still near the bottom', async () => {
    const s = await streaming();
    s.view.top = s.bottom() - 30; // 30 pixels up: well inside the zone where it used to keep snapping back
    fireEvent.wheel(s.el, { deltaY: -100 });
    fireEvent.scroll(s.el);
    const where = s.view.top;
    await s.nextPiece('second');
    await s.nextPiece('third');
    expect(s.view.top).toBe(where); // not pulled down
    expect(await screen.findByRole('button', { name: 'Scroll to the newest message' })).toBeTruthy();
  });

  it('stops following when you press the Up key in the chat', async () => {
    const s = await streaming();
    fireEvent.keyDown(s.el, { key: 'ArrowUp' });
    s.scrollTo(25);
    const where = s.view.top;
    await s.nextPiece('second');
    expect(s.view.top).toBe(where);
  });

  it('stops following when you drag the scroll bar up', async () => {
    const s = await streaming();
    fireEvent(s.el, new MouseEvent('pointerdown', { bubbles: true, clientX: 810 })); // on the bar: past the 800 pixels it shows
    s.scrollTo(20);
    const where = s.view.top;
    await s.nextPiece('second');
    await s.nextPiece('third');
    expect(s.view.top).toBe(where);
    fireEvent(window, new MouseEvent('pointerup'));
  });

  it('stops following when you swipe up on a touch screen', async () => {
    const s = await streaming();
    fireEvent.touchStart(s.el);
    s.scrollTo(25);
    const where = s.view.top;
    await s.nextPiece('second');
    expect(s.view.top).toBe(where);
  });

  it('does not count a click on the text itself as scrolling', async () => {
    const s = await streaming();
    fireEvent(s.el.querySelector('.column')!, new MouseEvent('pointerdown', { bubbles: true, clientX: 300 }));
    await s.nextPiece('second');
    expect(s.view.top).toBe(s.bottom());
  });

  it('follows the reply again once you scroll back down to the bottom', async () => {
    const s = await streaming();
    fireEvent.wheel(s.el, { deltaY: -100 });
    s.scrollTo(200);
    await s.nextPiece('second');
    expect(s.view.top).toBeLessThan(s.bottom());

    // Back down near the end, by the scroll bar or a drag: nothing that says which way, so it goes by where the page moved.
    await new Promise((r) => setTimeout(r, 800)); // (a moment after the wheel, as when you scroll up, read, then come back)
    s.scrollTo(10);
    await s.nextPiece('third');
    expect(s.view.top).toBe(s.bottom());
  });

  it('follows the reply again when you press the scroll-to-newest button', async () => {
    const s = await streaming();
    fireEvent.wheel(s.el, { deltaY: -100 });
    s.scrollTo(300);
    await s.nextPiece('second');
    // (clicked straight after scrolling up, so the scroll the click causes arrives while that scroll still counts as recent)
    await typist.click(await screen.findByRole('button', { name: 'Scroll to the newest message' }));
    expect(s.view.top).toBe(s.bottom());
    await s.nextPiece('third');
    expect(s.view.top).toBe(s.bottom());
  });

  it('keeps following when the page moves up by itself (for example a block shrinks), since that is not you scrolling', async () => {
    const s = await streaming();
    s.view.height -= 200; // the page gets shorter, so the browser moves the position up
    s.view.top = s.bottom();
    fireEvent.scroll(s.el);
    await s.nextPiece('second');
    expect(s.view.top).toBe(s.bottom());
  });

  it('does not stop following when you wheel up but there is nothing above to scroll to', async () => {
    const s = await streaming();
    s.view.top = 0;
    fireEvent.wheel(s.el, { deltaY: -100 });
    await s.nextPiece('second');
    expect(s.view.top).toBe(s.bottom());
  });

  it('still stops following when the page grows in the very moment of your small scroll step', async () => {
    const s = await streaming();
    // In one moment the reply makes the page 100px taller and you scroll up a little. Where the page ends up is
    // lower than the last scroll report, so it can look like scrolling down; your wheel says it was up.
    s.view.height += 100;
    fireEvent.wheel(s.el, { deltaY: -30 });
    s.view.top = s.bottom() - 8;
    fireEvent.scroll(s.el);
    const where = s.view.top;
    await s.nextPiece('second');
    expect(s.view.top).toBe(where);
  });

  it('follows again when you wheel down to the bottom', async () => {
    const s = await streaming();
    fireEvent.wheel(s.el, { deltaY: -100 });
    s.scrollTo(200);
    await s.nextPiece('second');
    expect(s.view.top).toBeLessThan(s.bottom());

    fireEvent.wheel(s.el, { deltaY: 100 });
    s.scrollTo(10);
    await s.nextPiece('third');
    expect(s.view.top).toBe(s.bottom());
  });
});
