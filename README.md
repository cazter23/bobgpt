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
- **Stop** appears while a reply is being written.
- Click the model name in the top bar to switch models. The current one is unloaded and the new one loaded, with its progress shown. Choosing a model needs LM Studio's server running; you no longer have to load models in LM Studio itself.
- The gear icon opens settings: system prompt, temperature, max response length, what to do when a chat is too long for the model's context, and (for the loaded model) context length and GPU offload. Changing the last two reloads the model. Those two are remembered separately for each model.
- The top bar shows the loaded model. If you load a different model in LM Studio, switch back to this tab and it picks it up.
- Chats are saved automatically in this browser and listed in the sidebar. Use the folder button to make folders, and drag chats onto them (drag back to the empty list to take one out). Drag the sidebar's edge to make it large, medium or hidden. Clearing the browser's site data, or opening the app in a different browser, loses them.
- The ghost icon in the top bar starts an incognito chat: it is never saved and never appears in the sidebar, and it disappears when you leave it or refresh the page. This only keeps it out of BobGPT's saved chats; LM Studio's own logs are separate.
- The sliders icon at the bottom of the sidebar (bottom-left of the window when the sidebar is hidden) opens **Preferences**, separate from the gear: **Appearance** (light, dark or follow your system; colour: the default purple-blue, six other gradients, plain, graphite grey, or one colour of your own; text size; whether a reasoning model's thinking is collapsed, open or hidden), **Behaviour** (Ctrl+Enter to send; letting the model name chats; tokens per second under replies) and **Your data** (back up chats to a file, restore from one, delete everything).
- With **Let the model name chats** on, the loaded model writes a short name for each new chat after its first reply, which takes a few seconds of the model's time. Chats you rename yourself keep your name. Turn it off to name chats from your first message instead.
- A backup file holds your chats and folders. Restoring adds the chats that aren't already here and never overwrites existing ones.
