import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterWebResults } from '../tools/webQualityFilter.js';
import type { WebResult, Reference } from '../../../shared/types.js';

vi.mock('../azure/directSearch.js', () => ({
  generateEmbedding: vi.fn((text: string) => {
    const hash = text.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return Promise.resolve(Array(10).fill(0).map((_, i) => (hash + i) / 1000));
  })
}));

vi.mock('../config/app.js', () => ({
  config: {
    WEB_MIN_AUTHORITY: 0.3,
    WEB_MAX_REDUNDANCY: 0.9,
    WEB_MIN_RELEVANCE: 0.3
  }
}));

describe('Web Quality Filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('filterWebResults', () => {
    it('filters spam domains', async () => {
      const results: WebResult[] = [
        { id: '1', title: 'Good', snippet: 'content', url: 'https://github.com/test', fetchedAt: new Date().toISOString() },
        { id: '2', title: 'Spam', snippet: 'content', url: 'https://pinterest.com/test', fetchedAt: new Date().toISOString() }
      ];

      const { filtered, removed } = await filterWebResults(results, 'test query', []);

      expect(filtered.length).toBe(1);
      expect(removed).toBe(1);
      expect(filtered[0].url).toContain('github.com');
    });

    it('prioritizes high-authority domains', async () => {
      const results: WebResult[] = [
        { id: '1', title: 'Low', snippet: 'content', url: 'https://example.com/test', fetchedAt: new Date().toISOString() },
        { id: '2', title: 'High', snippet: 'content', url: 'https://microsoft.com/test', fetchedAt: new Date().toISOString() }
      ];

      const { filtered, scores } = await filterWebResults(results, 'test query', []);

      expect(filtered.length).toBeGreaterThan(0);
      const score1 = scores.get('1');
      const score2 = scores.get('2');
      expect(score2?.authority).toBeGreaterThan(score1?.authority ?? 0);
    });

    it('detects redundancy with KB results', async () => {
      const kbResults: Reference[] = [
        { id: 'kb1', content: 'Azure AI Search is a cloud search service', score: 2.5 }
      ];

      const results: WebResult[] = [
        { id: '1', title: 'Similar', snippet: 'Azure AI Search is a cloud search service', url: 'https://example.com/1', fetchedAt: new Date().toISOString() },
        { id: '2', title: 'Different', snippet: 'Completely unrelated topic about cooking', url: 'https://example.com/2', fetchedAt: new Date().toISOString() }
      ];

      const { scores } = await filterWebResults(results, 'Azure AI Search', kbResults);

      const score1 = scores.get('1');
      const score2 = scores.get('2');
      expect(score1?.redundancy).toBeGreaterThan(score2?.redundancy ?? 0);
    });

    it('returns all results when all pass thresholds', async () => {
      const results: WebResult[] = [
        { id: '1', title: 'Good1', snippet: 'relevant content', url: 'https://github.com/1', fetchedAt: new Date().toISOString() },
        { id: '2', title: 'Good2', snippet: 'relevant content', url: 'https://stackoverflow.com/2', fetchedAt: new Date().toISOString() }
      ];

      const { filtered, removed } = await filterWebResults(results, 'test query', []);

      expect(filtered.length).toBe(2);
      expect(removed).toBe(0);
    });

    it('handles empty results gracefully', async () => {
      const { filtered, removed, scores } = await filterWebResults([], 'test query', []);

      expect(filtered).toEqual([]);
      expect(removed).toBe(0);
      expect(scores.size).toBe(0);
    });
  });
});
