import { describe, it, expect, beforeEach, vi } from 'vitest';
import { trackCitationUsage, recallSimilarSuccessfulQueries } from '../orchestrator/citationTracker.js';
import type { Reference } from '../../../shared/types.js';

vi.mock('../orchestrator/semanticMemoryStore.js', () => ({
  semanticMemoryStore: {
    addMemory: vi.fn(),
    recallMemories: vi.fn()
  }
}));

vi.mock('../config/app.js', () => ({
  config: {
    ENABLE_SEMANTIC_MEMORY: true
  }
}));

describe('Citation Tracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('trackCitationUsage', () => {
    it('identifies cited references', async () => {
      const references: Reference[] = [
        { id: 'doc-1', content: 'Content 1', score: 2.5 },
        { id: 'doc-2', content: 'Content 2', score: 2.8 },
        { id: 'doc-3', content: 'Content 3', score: 2.2 }
      ];
      const answer = 'According to [1] and [2], this is true. See [1] again.';

      await trackCitationUsage(answer, references, 'test query', 'session-1');

      expect((references[0] as any).wasActuallyCited).toBe(true);
      expect((references[1] as any).wasActuallyCited).toBe(true);
      expect((references[2] as any).wasActuallyCited).toBe(false);
    });

    it('calculates citation density', async () => {
      const references: Reference[] = [
        { id: 'doc-1', content: 'Content 1', score: 2.5 },
        { id: 'doc-2', content: 'Content 2', score: 2.8 }
      ];
      const answer = 'According to [1] and [2], this is true.';

      await trackCitationUsage(answer, references, 'test query', 'session-1');

      expect((references[0] as any).citationDensity).toBeCloseTo(0.5);
      expect((references[1] as any).citationDensity).toBeCloseTo(0.5);
    });

    it('handles answers with no citations', async () => {
      const references: Reference[] = [
        { id: 'doc-1', content: 'Content 1', score: 2.5 }
      ];
      const answer = 'I do not know.';

      await trackCitationUsage(answer, references, 'test query', 'session-1');

      expect((references[0] as any).wasActuallyCited).toBe(false);
    });
  });

  describe('recallSimilarSuccessfulQueries', () => {
    it('returns empty array when semantic memory disabled', async () => {
      const { semanticMemoryStore } = await import('../orchestrator/semanticMemoryStore.js');
      vi.spyOn(semanticMemoryStore, 'recallMemories').mockResolvedValue([]);

      const result = await recallSimilarSuccessfulQueries('test query');
      expect(result).toEqual([]);
    });
  });
});
