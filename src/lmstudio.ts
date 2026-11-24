// Model loading and token counting through LM Studio's SDK (a WebSocket on the same port as the chat server).
// Chat messages themselves still go through the OpenAI-compatible endpoint in api.ts.
import { LMStudioClient, type LLM } from '@lmstudio/sdk';

let client: LMStudioClient | null = null;

function getClient(): LMStudioClient {
  client ??= new LMStudioClient({ baseUrl: 'ws://127.0.0.1:1234' });
  return client;
}

/** Runs an SDK call; if it fails, the next call starts with a fresh connection. */
async function sdk<T>(run: (c: LMStudioClient) => Promise<T>): Promise<T> {
  try {
    return await run(getClient());
  } catch (e) {
    client = null;
    throw e;
  }
}

export type ModelOption = {
  key: string;
  name: string;
  sizeBytes: number;
  maxContext: number;
};

export type LoadedModel = {
  identifier: string; // the name the chat endpoint uses
  key: string;
  contextLength: number;
  vision: boolean; // it can see images
};

/** What to load a model with. Anything left out uses LM Studio's own default. */
export type LoadOptions = {
  contextLength?: number;
  gpuOffload?: number; // 0 to 1
  keepInMemory?: boolean; // off unless true (LM Studio's own default is on)
};

/** Downloaded chat models (embedding models are not included). */
export function listChatModels(): Promise<ModelOption[]> {
  return sdk(async (c) => {
    const models = await c.system.listDownloadedModels('llm');
    return models.map((m) => ({
      key: m.modelKey,
      name: m.displayName,
      sizeBytes: m.sizeBytes,
      maxContext: m.maxContextLength,
    }));
  });
}

export function listLoaded(): Promise<LoadedModel[]> {
  return sdk(async (c) => {
    const loaded = await c.llm.listLoaded();
    return Promise.all(
      loaded.map(async (m) => ({
        identifier: m.identifier,
        key: m.modelKey,
        contextLength: await m.getContextLength(),
        vision: m.vision,
      })),
    );
  });
}

/** Unloads whatever is loaded, then loads `key`. `onProgress` gets 0 to 1. Aborting `signal` stops the load. */
export function swapModel(
  key: string,
  options: LoadOptions,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return sdk(async (c) => {
    for (const model of await c.llm.listLoaded()) await model.unload();
    const config: { contextLength?: number; gpu?: { ratio: number }; keepModelInMemory: boolean } = {
      keepModelInMemory: options.keepInMemory === true,
    };
    if (options.contextLength) config.contextLength = options.contextLength;
    if (options.gpuOffload !== undefined) config.gpu = { ratio: options.gpuOffload };
    await c.llm.load(key, { config, onProgress, signal });
  });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Makes sure no model is left loaded or half-loaded, e.g. after a cancelled or failed load.
 * LM Studio takes a few seconds to wind a cancelled load down, so this keeps unloading whatever
 * it still lists until the list is empty. Returns false if that didn't happen in time.
 */
export async function ensureNothingLoaded(timeoutMs = 45000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const loaded = await sdk((c) => c.llm.listLoaded());
      if (loaded.length === 0) return true;
      // An unload can hang on a model that is mid-wind-down, so don't wait on one for long.
      await Promise.all(loaded.map((m) => Promise.race([m.unload().catch(() => {}), pause(5000)])));
    } catch {
      // LM Studio didn't answer; try again.
    }
    await pause(500);
  }
  return false;
}

/**
 * Returns a function that counts tokens the way the loaded model does.
 * Counts are remembered. If the model isn't loaded, or LM Studio can't be asked, it gives a rough estimate
 * (not remembered, so the real count is tried again next time).
 *
 * This never uses `client.llm.model(identifier)`: that loads the model when it isn't loaded, which could
 * load a second model (for example while another one is being switched to). It counts with the handle of
 * the model that is loaded right now; once that model is unloaded the handle just fails.
 */
export function tokenCounter(identifier: string): (text: string) => Promise<number> {
  const cache = new Map<string, number>();
  let handle: Promise<LLM | undefined> | null = null; // shared by counts made at the same time
  return async (text) => {
    const known = cache.get(text);
    if (known !== undefined) return known;
    handle ??= sdk(async (c) => (await c.llm.listLoaded()).find((m) => m.identifier === identifier));
    try {
      const model = await handle;
      if (model) {
        const count = await model.countTokens(text);
        cache.set(text, count);
        return count;
      }
    } catch {
      // LM Studio didn't answer, or the model was unloaded.
    }
    handle = null; // look for the model again next time
    return Math.ceil(text.length / 3);
  };
}
