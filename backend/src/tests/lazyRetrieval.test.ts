import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../azure/directSearch.js', () => ({
  hybridSemanticSearch: vi.fn()
}));

vi.mock('../utils/resilience.js', () => ({
  withRetry: async (_label: string, action: () => Promise<any>) => action()
}));

const directSearch = await import('../azure/directSearch.js');
const { config } = await import('../config/app.js');
const { lazyHybridSearch, loadFullContent, identifyLoadCandidates } = await import('../azure/lazyRetrieval.js');
const { resetRerankerThresholdWarnings } = await import('../utils/reranker-threshold.js');

describe('lazy retrieval helpers', () => {
  const originalConfig = {
    reranker: config.RERANKER_THRESHOLD,
    fallback: config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD,
    minimum: config.RETRIEVAL_MIN_RERANKER_THRESHOLD,
    summaryMax: config.LAZY_SUMMARY_MAX_CHARS,
    ragTopK: config.RAG_TOP_K,
    prefetch: config.LAZY_PREFETCH_COUNT
  };

  beforeEach(() => {
    config.LAZY_SUMMARY_MAX_CHARS = 120;
    config.RAG_TOP_K = 3;
    config.LAZY_PREFETCH_COUNT = 5;
    config.RERANKER_THRESHOLD = 0;
    config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD = 0;
    config.RETRIEVAL_MIN_RERANKER_THRESHOLD = 0;
    (directSearch.hybridSemanticSearch as unknown as Mock).mockReset();
    resetRerankerThresholdWarnings();
  });

  afterEach(() => {
    config.RERANKER_THRESHOLD = originalConfig.reranker;
    config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD = originalConfig.fallback;
    config.RETRIEVAL_MIN_RERANKER_THRESHOLD = originalConfig.minimum;
    config.LAZY_SUMMARY_MAX_CHARS = originalConfig.summaryMax;
    config.RAG_TOP_K = originalConfig.ragTopK;
    config.LAZY_PREFETCH_COUNT = originalConfig.prefetch;
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

  it('filters references below the reranker threshold', async () => {
    // F-005: hybridSemanticSearch now applies threshold internally, so mock should return already-filtered results
    (directSearch.hybridSemanticSearch as unknown as Mock).mockResolvedValueOnce({
      references: [
        { id: 'doc-1', content: 'High score content', score: 2.9 }
        // doc-2 with score 1.1 is already filtered out by hybridSemanticSearch (threshold 2.5)
      ]
    });

    const result = await lazyHybridSearch({ query: 'threshold test', top: 3, rerankerThreshold: 2.5 });

    expect(result.references).toHaveLength(1);
    expect(result.references[0].id).toBe('doc-1');
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
