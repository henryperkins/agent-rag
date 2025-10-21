import { withRetry } from './resilience.js';
import { createEmbeddings } from '../azure/openaiClient.js';

const DEFAULT_BATCH_SIZE = 32;
const MAX_CACHE_ENTRIES = 2000;
const CACHE = new Map<string, number[]>();

function cacheKey(text: string): string {
  // Limit cache key length to avoid extremely large keys; text is trimmed to 2048 chars.
  return text.slice(0, 2048);
}

function pruneCache() {
  if (CACHE.size <= MAX_CACHE_ENTRIES) {
    return;
  }

  const keys = Array.from(CACHE.keys());
  const keep = Math.floor(MAX_CACHE_ENTRIES * 0.8);
  for (let index = keep; index < keys.length; index += 1) {
    CACHE.delete(keys[index]);
  }
}

export async function embedTexts(texts: string[], batchSize: number = DEFAULT_BATCH_SIZE): Promise<number[][]> {
  const embeddings: number[][] = new Array(texts.length);
  const pending: Array<{ index: number; text: string }> = [];

  texts.forEach((text, index) => {
    const key = cacheKey(text);
    const hit = CACHE.get(key);
    if (hit) {
      embeddings[index] = hit;
    } else {
      pending.push({ index, text });
    }
  });

  if (pending.length === 0) {
    return embeddings;
  }

  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const slice = pending.slice(offset, offset + batchSize);
    const batch = slice.map((item) => item.text);
    const response = await withRetry('embeddings.batch', async (_signal) => {
      const result = await createEmbeddings(batch);
      // `createEmbeddings` does not currently accept an AbortSignal; ignore `_signal` for now.
      return result.data.map((item: { embedding: number[] }) => item.embedding);
    });

    if (response.length !== slice.length) {
      throw new Error(`Embedding mismatch: expected ${slice.length}, received ${response.length}`);
    }

    response.forEach((vector, index) => {
      const { text, index: originalIndex } = slice[index];
      embeddings[originalIndex] = vector;
      CACHE.set(cacheKey(text), vector);
    });

    pruneCache();
  }

  return embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  return (await embedTexts([text]))[0];
}
