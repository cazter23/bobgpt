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

## Using it

- **Enter** sends, **Shift+Enter** adds a new line.
- While a reply is being written, the input's button is **Stop** when the box is empty, and a send button once you've typed something. **Esc** also stops it (unless a panel, menu or another text box is using Esc). Sending then adds your message to a **queue** above the input: queued messages go to the model one at a time, each after the previous reply has finished. Remove one with its ×. Stopping a reply, or an error, pauses the queue (choose **Resume** or **Clear**). While it's paused, a message you send joins the end of the queue, and the queue stays paused until you choose Resume; regenerating or editing a message doesn't restart it either. Starting a different chat clears it.
- **Images**: with a vision model loaded, attach images with the **+** button in the input box, by pasting (**Ctrl+V**), or by dragging them onto the chat. They show as small thumbnails (remove one with its ×) and then in your message. With a model that can't see images the **+** is greyed out; earlier images in a chat are then left out of what is sent, but stay in the chat.
  - Each image is shrunk when attached (at most 1000 px on the long side, saved as a JPEG of about 100–200 KB) and sent to LM Studio inside the message, in the OpenAI-compatible format.
  - The images of saved chats are kept in this browser's IndexedDB, not with the chats in localStorage (which only holds about 5 MB). Deleting a chat or message deletes its images too. Incognito images are only ever kept in memory.
  - The context dial and context overflow count each image as about 1,000 tokens. The real number depends on the model (Gemma 3 uses 256, Qwen2.5-VL about 950), so it's a rough guess.
  - Queued messages keep their images, and backups include them.
- Click the model name in the top bar to switch models. The current one is unloaded and the new one loaded, with its progress shown. Choosing a model needs LM Studio's server running; you no longer have to load models in LM Studio itself.
- The gear icon opens settings: system prompt, temperature, max response length, context overflow (Truncate middle, Rolling window or Stop at limit, as in LM Studio), and (for the loaded model) context length and GPU offload. Changing the last two reloads the model. Those two are remembered separately for each model.
- The top bar shows the loaded model. If you load a different model in LM Studio, switch back to this tab and it picks it up.
- Chats are saved automatically in this browser and listed in the sidebar. Use the folder button to make folders, and drag chats onto them (drag back to the empty list to take one out). Drag the sidebar's edge to make it large, medium or hidden. Clearing the browser's site data, or opening the app in a different browser, loses them.
- **Search chats** with the field at the top of the sidebar (or press **Ctrl+K**, which opens the sidebar if it's hidden). It looks in chat titles and in every message you and the model wrote; a chat matches when it contains all the words you typed, in any order. Results show a snippet with the matches highlighted, and opening one scrolls to the first matching message. **Esc** clears the search. Incognito chats are never saved, so they can't be searched, and a reasoning model's hidden thinking isn't searched.
- The ghost icon in the top bar starts an incognito chat: it is never saved and never appears in the sidebar, and it disappears when you leave it or refresh the page. It uses a darker version of your chosen colour in dark mode, and a dimmer, greyer one in light mode. This only keeps it out of BobGPT's saved chats; LM Studio's own logs are separate.
- The sliders icon at the bottom of the sidebar (bottom-left of the window when the sidebar is hidden) opens **Preferences**, separate from the gear: **Appearance** (light, dark or follow your system; colour: Twilight (the purple-blue default), six other gradients, plain, graphite grey, or one colour of your own; text font and code font (several bundled fonts, including Comic Sans); text size; whether a reasoning model's thinking is collapsed, open or hidden), **Behaviour** (Ctrl+Enter to send; letting the model name chats; tokens per second under replies; a context dial in the top bar showing how full the model's memory is) and **Your data** (back up chats to a file, restore from one, delete everything).
- With **Let the model name chats** on, the loaded model writes a short name for each new chat after its first reply, which takes a few seconds of the model's time. Chats you rename yourself keep your name. Turn it off to name chats from your first message instead.
- Each chat and folder in the sidebar has a **⋯** menu (it shows when you hover the row, and always on the open chat) with **Rename** and **Delete**, which asks first in a panel in the middle of the window. For a chat it also has **Export as Markdown**, which saves it as a .md file you can read or share. It holds the chat's title and messages (images are noted but not included; hidden thinking is left out).
- A backup file holds your chats, folders and their images. Restoring adds the chats that aren't already here and never overwrites existing ones.
