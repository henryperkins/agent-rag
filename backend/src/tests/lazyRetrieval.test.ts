import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../azure/directSearch.js', () => ({
  hybridSemanticSearch: vi.fn()
}));

vi.mock('../utils/resilience.js', () => ({
  withRetry: async (_label: string, action: (signal?: AbortSignal) => Promise<any>) => action(undefined)
}));

const directSearch = await import('../azure/directSearch.js');
const { config } = await import('../config/app.js');
const { lazyHybridSearch, loadFullContent, identifyLoadCandidates } = await import('../azure/lazyRetrieval.js');

describe('lazy retrieval helpers', () => {
  beforeEach(() => {
    config.LAZY_SUMMARY_MAX_CHARS = 120;
    config.RAG_TOP_K = 3;
    config.LAZY_PREFETCH_COUNT = 5;
    (directSearch.hybridSemanticSearch as unknown as Mock).mockReset();
  });

  it('returns summaries with loadFull callbacks', async () => {
    (directSearch.hybridSemanticSearch as unknown as Mock)
      .mockResolvedValueOnce({
        references: [
          { id: 'doc-1', content: 'Full content 1', page_number: 1, score: 0.9 },
          { id: 'doc-2', content: 'Full content 2', page_number: 2, score: 0.8 }
        ]
      });

    const result = await lazyHybridSearch({ query: 'azure search', top: 2 });

    expect(result.references).toHaveLength(2);
    expect(result.references[0].summary).toContain('Full content 1');
    expect(typeof result.references[0].loadFull).toBe('function');
  });

  it('loads full content for selected references', async () => {
    (directSearch.hybridSemanticSearch as unknown as Mock)
      .mockResolvedValueOnce({
        references: [
          { id: 'doc-1', content: 'Full content 1', page_number: 1, score: 0.9 }
        ]
      })
      .mockResolvedValueOnce({
        references: [
          { id: 'doc-1', content: 'Expanded document content', page_number: 1, score: 0.95 }
        ]
      });

    const { references } = await lazyHybridSearch({ query: 'azure search', top: 1 });
    const map = await loadFullContent(references, [0]);
    expect(map.get(0)).toContain('Expanded document content');
  });

  it('identifies load candidates based on critic feedback', () => {
    const candidates = identifyLoadCandidates(
      [
        { id: 'doc-1', content: 'summary', isSummary: true },
        { id: 'doc-2', content: 'summary', isSummary: true }
      ],
      ['Answer lacks detail']
    );
    expect(candidates).toEqual([0, 1]);
  });
});
