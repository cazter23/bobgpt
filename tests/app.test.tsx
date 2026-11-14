// The app as a whole, against a pretend LM Studio. These check behaviour that is easy to break and hard to notice:
// the queue sending one message at a time, Stop, incognito never saving, Stop at limit, and search.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
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

  it('is ignored while a reply is being written (the buttons are off then too), but "/" still works', async () => {
    start({ chats: [alpha] });
    await typist.click(await screen.findByText('Alpha'));
    await screen.findByText('reply alpha');
    await send('another question');
    await requestArrives(1);

    alt('KeyN');
    alt('ArrowDown');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText('another question')).toBeTruthy(); // still in this chat

    (document.activeElement as HTMLElement | null)?.blur();
    press({ key: '/', code: 'Slash' });
    await waitFor(() => expect(document.activeElement).toBe(messageBox())); // so you can queue another message
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
  const note = () => document.querySelector('.folder-note')?.textContent ?? null;

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

  it('opens an empty chat that says where it will be saved, and saves it in that folder once you send something', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    expect(note()).toBe('This chat will be saved in “Work”.');
    expect(document.querySelector('.greeting')).not.toBeNull();

    await send('Hello there');
    await requestArrives(1);
    server.replies[0].say('Hi!');
    server.replies[0].finish();
    await screen.findByText('Hi!');

    await waitFor(() => expect(savedChats()[0].folderId).toBe('f1'));
    const inFolder = document.querySelector('.folder-chats') as HTMLElement;
    expect(within(inFolder).getByText('Hello there')).toBeTruthy();
  });

  it('opens a collapsed folder, so you can see where the chat will go', async () => {
    seedFolders();
    start();
    const title = await screen.findByTitle('Play'); // the folder's own button (the ⋯ button has a longer name)
    expect(title.getAttribute('aria-expanded')).toBe('false');
    await chooseNewChatIn('Play');
    await waitFor(() => expect(screen.getByTitle('Play').getAttribute('aria-expanded')).toBe('true'));
  });

  it('only applies to that one new chat: starting an ordinary new chat afterwards saves it outside any folder', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    expect(note()).not.toBeNull();
    await typist.click(topbarButton('New chat'));
    await waitFor(() => expect(note()).toBeNull());

    await send('Loose chat');
    await requestArrives(1);
    server.replies[0].say('ok');
    server.replies[0].finish();
    await screen.findByText('ok');
    await waitFor(() => expect(savedChats()).toHaveLength(1));
    expect(savedChats()[0].folderId ?? null).toBeNull();
  });

  it('keeps the chat in its folder for the rest of the conversation', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    await send('first');
    await requestArrives(1);
    server.replies[0].say('one');
    server.replies[0].finish();
    await screen.findByText('one');
    await send('second');
    await requestArrives(2);
    server.replies[1].say('two');
    server.replies[1].finish();
    await screen.findByText('two');
    await waitFor(() => expect(savedChats()[0].messages).toHaveLength(4));
    expect(savedChats()).toHaveLength(1);
    expect(savedChats()[0].folderId).toBe('f1');
  });

  it('saves the chat outside any folder if the folder is deleted before you send anything', async () => {
    seedFolders();
    start();
    await chooseNewChatIn('Work');
    const menu = await openFolderMenu('Work');
    await typist.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await typist.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(note()).toBeNull());

    await send('after the folder went');
    await requestArrives(1);
    server.replies[0].say('ok');
    server.replies[0].finish();
    await screen.findByText('ok');
    await waitFor(() => expect(savedChats()).toHaveLength(1));
    expect(savedChats()[0].folderId ?? null).toBeNull();
  });

  it('is switched off while a reply is being written, like the New chat button', async () => {
    seedFolders();
    start();
    await send('question');
    await requestArrives(1);
    const menu = await openFolderMenu('Work');
    expect((within(menu).getByRole('menuitem', { name: 'New chat in folder' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks before leaving an incognito chat that has messages, and only then opens the folder chat', async () => {
    seedFolders();
    start();
    await typist.click(button('Incognito chat'));
    await send('secret');
    await requestArrives(1);
    server.replies[0].say('shh');
    server.replies[0].finish();
    await screen.findByText('shh');

    await chooseNewChatIn('Work');
    const dialog = await screen.findByRole('alertdialog');
    expect(note()).toBeNull(); // nothing has changed yet
    await typist.click(within(dialog).getByRole('button', { name: 'Discard chat' }));
    await waitFor(() => expect(note()).toBe('This chat will be saved in “Work”.'));
    expect(document.documentElement.hasAttribute('data-incognito')).toBe(false);
  });
});
