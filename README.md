# BobGPT

A minimal chat interface for models running in LM Studio. LM Studio runs the models in the background; this is the front end.

## One-time setup in LM Studio

1. Open LM Studio and click **Model Server** in the left sidebar.
   (Older versions call this the **Developer** tab.)
2. In that page's server settings, turn on **Enable CORS**.
   (Browsers block a page on `localhost:5173` from talking to `localhost:1234` unless the server allows it.)
3. Turn the server on with the **Status** toggle. Keep the port at **1234**.
4. Load a model using the model selector at the top of the window.

## Running the app

Open a terminal in this folder (in VS Code: Terminal → New Terminal), then:

```
npm install
npm run dev
```

Open http://localhost:5173 in Edge or Chrome.

- `npm install` is only needed the first time, or after dependencies change.
- Leave the terminal open while you use the app; press `Ctrl+C` in it to stop.

## Everyday use: the built app

`npm run dev` is for working on the code. For everyday use, run the built version: it does the same thing with far less memory (about 85 MB instead of about 300 MB).

- **Double-click `start-bobgpt.bat`.** It builds the app first if the code has changed, starts the server in the background (no window) and opens http://localhost:5173.
- **`stop-bobgpt.bat`** stops that server (to free its memory, or to run `npm run dev`).
- **At login:** a shortcut called "BobGPT server" in your Windows Startup folder (press `Win+R`, type `shell:startup`) starts the server when you log in, without opening a browser. Delete the shortcut to turn that off.
- **Desktop shortcut:** a "BobGPT" shortcut with the app's icon is on your Desktop. Double-clicking it does what `start-bobgpt.bat` does, and opens BobGPT in Firefox. Each browser keeps its own saved chats, so the launcher opens the browser you already use for BobGPT: change the line `BOBGPT_BROWSER` near the top of `start-bobgpt.bat` to `edge` or `chrome` (these open an app-style window with no tabs or address bar) or `default` (whatever Windows uses for links). To make another shortcut, right-click `start-bobgpt.bat` → Show more options → Send to → Desktop (create shortcut), then Properties → Change Icon → `bobgpt.ico`.
- `npm run app` does the same from a terminal, with the server running in it.

The built app and `npm run dev` both use port 5173, and your saved chats belong to that address, so only one can run at a time. Before using `npm run dev`, run `stop-bobgpt.bat`; otherwise the dev server moves to another port and your chats won't appear there.

## Installing it as an app

Firefox can't install web apps on Windows, so with Firefox use the Desktop shortcut above. In Edge or Chrome:

With the built app running, open http://localhost:5173 and use the install button at the end of the address bar (or ⋯ → Apps → Install BobGPT). It then opens in its own window with the BobGPT icon, no address bar, and can be pinned to the taskbar.

The installed app keeps a copy of its own files, so its window opens even when the server isn't running; LM Studio still has to be running to chat. When the server is running, a rebuilt app arrives the next time you open it. The copy holds only the app's files, never your chats, which stay in the browser as before.

## Tests

```
npm test
```

runs the automated tests in a couple of seconds. They never contact LM Studio or load a model: a pretend LM Studio is used instead. `npm run check` runs the type check, the tests and a build together; run it before committing.

- `tests/*.test.ts` check the logic on its own: trimming a long chat, search, saved-data loading, settings, backups, Markdown export, stored images, LM Studio replies, themes and fonts, and the installable-app files (manifest, icons, and the service worker, which must leave LM Studio requests alone).
- `tests/app.test.tsx` runs the whole app against the pretend LM Studio (`tests/fakeLmStudio.ts`): the message queue sending one at a time, Stop and Resume, incognito chats never being saved, Stop at limit, Truncate middle, error messages, and search.

## Using it

- **Enter** sends, **Shift+Enter** adds a new line.
- **Reading while a reply is written:** the chat follows the newest text as it arrives. Scroll up (mouse wheel, touchpad, scroll bar, touch, or the Up, Page Up or Home keys) and it stays exactly where you put it while the reply carries on below; a "scroll to the newest message" button appears. Scroll back to the bottom, or click that button, and it follows again.
- **Other chats while a reply is written:** the reply carries on in its own chat while you open other chats, rename chats (including that one) or start a new one; a pulsing dot in the sidebar marks the chat being written in, and coming back shows the reply so far. You can't delete that chat, send from another chat, or start an incognito chat until it's done. Queued messages stay with their chat: they wait while you're elsewhere and are sent when you return to it.
- **Keyboard shortcuts:** **Ctrl+K** search chats, **Alt+N** new chat, **Alt+I** start or leave an incognito chat (leaving one with messages still asks first), **Alt+↑ / Alt+↓** the chat above or below the open one in the sidebar, **Alt+C** copy the newest reply, **/** jump to the message box (when you're not typing in a field), **Esc** stop a reply. They are Alt keys because browsers keep most Ctrl+Shift combinations for themselves. Alt+I and Alt+C are off while a reply is being written (as the incognito button is), and all are off while Settings, Preferences or a confirmation is open. Hovering a button shows its key.
- While a reply is being written, the input's button is **Stop** when the box is empty, and a send button once you've typed something. **Esc** also stops it (unless a panel, menu or another text box is using Esc). Sending then adds your message to a **queue** above the input: queued messages go to the model one at a time, each after the previous reply has finished. Copy one's text with its copy button, or remove it with its ×. Stopping a reply, or an error, pauses the queue (choose **Resume** or **Clear**). While it's paused, a message you send joins the end of the queue, and the queue stays paused until you choose Resume; regenerating or editing a message doesn't restart it either. Once the reply has finished, opening a different chat clears the queue.
- **Images**: with a vision model loaded, attach images with the **+** button in the input box, by pasting (**Ctrl+V**), or by dragging them onto the chat. They show as small thumbnails (remove one with its ×) and then in your message. With a model that can't see images the **+** is greyed out; earlier images in a chat are then left out of what is sent, but stay in the chat.
  - Each image is shrunk when attached (at most 1000 px on the long side, saved as a JPEG of about 100–200 KB) and sent to LM Studio inside the message, in the OpenAI-compatible format.
  - The images of saved chats are kept in this browser's IndexedDB, not with the chats in localStorage (which only holds about 5 MB). Deleting a chat or message deletes its images too. Incognito images are only ever kept in memory.
  - The context dial and context overflow count each image as about 1,000 tokens. The real number depends on the model (Gemma 3 uses 256, Qwen2.5-VL about 950), so it's a rough guess.
  - Queued messages keep their images, and backups include them.
- Click the model name in the top bar to switch models. The current one is unloaded and the new one loaded, with its progress shown. Choosing a model needs LM Studio's server running; you no longer have to load models in LM Studio itself.
- The gear icon opens settings: system prompt, temperature, max response length, context overflow (Truncate middle, Rolling window or Stop at limit, as in LM Studio), and (for the loaded model) context length, GPU offload and **Keep model in memory**. Changing those three reloads the model. They are remembered separately for each model. Keep model in memory is off unless you tick it, here or in the box that appears when you pick a model to load (LM Studio itself has it on by default).
- The top bar shows the loaded model. If you load a different model in LM Studio, switch back to this tab and it picks it up.
- Chats are saved automatically in this browser and listed in the sidebar. Use the folder button to make folders, and drag chats onto them (drag back to the empty list to take one out). A folder's ⋯ menu has **New chat in folder**, which puts an "Unnamed chat" in that folder straight away, so you can rename it (⋯ → Rename) before sending anything. Sending a first message names it after that message, unless you named it yourself. Leave it still empty and unnamed and it disappears; once you've named it, it stays. Drag the sidebar's edge to make it large, medium or hidden. Clearing the browser's site data, or opening the app in a different browser, loses them.
- **Search chats** with the field at the top of the sidebar (or press **Ctrl+K**, which opens the sidebar if it's hidden). It looks in chat titles and in every message you and the model wrote; a chat matches when it contains all the words you typed, in any order. Results show a snippet with the matches highlighted, and opening one scrolls to the first matching message. **Esc** clears the search. Incognito chats are never saved, so they can't be searched, and a reasoning model's hidden thinking isn't searched.
- The ghost icon in the top bar starts an incognito chat: it is never saved and never appears in the sidebar, and it disappears when you leave it or refresh the page. It uses a darker version of your chosen colour in dark mode, and a dimmer, greyer one in light mode. This only keeps it out of BobGPT's saved chats; LM Studio's own logs are separate.
- The sliders icon at the bottom of the sidebar (bottom-left of the window when the sidebar is hidden) opens **Preferences**, separate from the gear: **Appearance** (light, dark or follow your system; colour: Twilight (the purple-blue default), six other gradients, plain, graphite grey, or one colour of your own; text font and code font (several bundled fonts, including Comic Sans); text size; line spacing (compact, normal or relaxed, which changes the height of lines in chat messages); whether a reasoning model's thinking is collapsed, open or hidden), **Behaviour** (Ctrl+Enter to send; letting the model name chats; tokens per second under replies; a context dial in the top bar showing how full the model's memory is) and **Your data** (back up chats to a file, restore from one, delete everything).
- With **Let the model name chats** on, the loaded model writes a short name for each new chat after its first reply, which takes a few seconds of the model's time. Chats you rename yourself keep your name. Turn it off to name chats from your first message instead.
- Each chat and folder in the sidebar has a **⋯** menu (it shows when you hover the row, and always on the open chat) with **Rename** and **Delete**, which asks first in a panel in the middle of the window. For a chat it also has **Export as Markdown**, which saves it as a .md file you can read or share. It holds the chat's title and messages (images are noted but not included; hidden thinking is left out).
- **Reduced motion:** if you've turned animations off in Windows (Settings → Accessibility → Visual effects → Animation effects), BobGPT stops sliding, fading and bouncing. It keeps three things that are feedback rather than decoration: the loading spinner, the "waiting for the first word" dots (which fade in turn instead of bouncing) and a steady highlight on the message a search result points to.
- A backup file holds your chats, folders and their images. Restoring adds the chats that aren't already here and never overwrites existing ones.
