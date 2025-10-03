import { beforeEach, describe, expect, it, vi } from 'vitest';

import { selectSummaryBullets } from '../orchestrator/summarySelector.js';
import { config } from '../config/app.js';
import type { SummaryBullet } from '../orchestrator/memoryStore.js';

vi.mock('../azure/openaiClient.js', () => ({
  createEmbeddings: vi.fn()
}));

const openaiClient = await import('../azure/openaiClient.js');

describe('selectSummaryBullets', () => {
  beforeEach(() => {
    (openaiClient.createEmbeddings as unknown as vi.Mock).mockReset();
    config.ENABLE_SEMANTIC_SUMMARY = false;
  });

  it('falls back to recency when feature flag disabled', async () => {
    const candidates: SummaryBullet[] = [{ text: 'one' }, { text: 'two' }, { text: 'three' }];
    const result = await selectSummaryBullets('query', candidates, 2);
    expect(result.selected.map((item) => item.text)).toEqual(['two', 'three']);
    expect(result.candidates.map((item) => item.text)).toEqual(['one', 'two', 'three']);
    expect(openaiClient.createEmbeddings).not.toHaveBeenCalled();
  });

  it('uses embeddings when enabled and returns highest scoring items', async () => {
    config.ENABLE_SEMANTIC_SUMMARY = true;
    (openaiClient.createEmbeddings as unknown as vi.Mock)
      .mockResolvedValueOnce({
        data: [
          { embedding: [1, 0] },
          { embedding: [0, 1] },
          { embedding: [0.5, 0.5] }
        ]
      }) // missing embeddings
      .mockResolvedValueOnce({
        data: [{ embedding: [1, 0] }]
      }); // query embedding

    const candidates: SummaryBullet[] = [{ text: 'summary1' }, { text: 'summary2' }, { text: 'summary3' }];
    const result = await selectSummaryBullets('query', candidates, 2);
    expect(result.selected.map((item) => item.text)).toEqual(['summary1', 'summary3']);
    expect(openaiClient.createEmbeddings).toHaveBeenCalledTimes(2);
    expect(result.candidates[0].embedding).toBeDefined();
  });

  it('falls back to recency when embeddings throw', async () => {
    config.ENABLE_SEMANTIC_SUMMARY = true;
    (openaiClient.createEmbeddings as unknown as vi.Mock).mockRejectedValue(new Error('embedding failure'));

    const candidates: SummaryBullet[] = [{ text: 'a' }, { text: 'b' }, { text: 'c' }];
    const result = await selectSummaryBullets('query', candidates, 2);
    expect(result.selected.map((item) => item.text)).toEqual(['b', 'c']);
  });
});
