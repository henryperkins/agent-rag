import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchTools } from '../orchestrator/dispatch.js';
import type { PlanSummary } from '../../../shared/types.js';

vi.mock('../azure/adaptiveRetrieval.js', async () => {
  return {
    retrieveWithAdaptiveRefinement: vi.fn(async (query: string) => {
      // Simulate 2-attempt flow with one reformulation
      const initial = { coverage: 0.2, diversity: 0.25, authority: 0.3, freshness: 0.5 };
      const final = { coverage: 0.88, diversity: 0.6, authority: 0.8, freshness: 0.5 };
      const attempts = [
        { attempt: 1, query, quality: initial, latency_ms: 25 },
        { attempt: 2, query: `${query} site:nasa.gov`, quality: final, latency_ms: 30 }
      ];
      return {
        references: [
          { id: 'doc1', title: 'Doc1', content: 'a', score: 2.0 },
          { id: 'doc2', title: 'Doc2', content: 'b', score: 2.2 }
        ],
        quality: final,
        reformulations: ['site:nasa.gov'],
        attempts,
        initialQuality: initial
      };
    })
  };
});

describe('Adaptive Retrieval Telemetry', () => {
  beforeEach(() => {
    process.env.ENABLE_ADAPTIVE_RETRIEVAL = 'true';
    process.env.ADAPTIVE_MIN_COVERAGE = '0.4';
    process.env.ADAPTIVE_MIN_DIVERSITY = '0.3';
    process.env.RETRIEVAL_STRATEGY = 'direct'; // Prevent knowledge agent calls

    // Mock fetch to prevent real network calls and return proper search results
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      // Handle embedding API calls
      if (url.includes('/embeddings')) {
        return {
          ok: true,
          headers: { get: vi.fn().mockReturnValue(null) },
          json: async () => ({
            data: [{ embedding: new Array(1536).fill(0.1) }]
          })
        };
      }
      // Handle search API calls - return documents
      return {
        ok: true,
        headers: { get: vi.fn().mockReturnValue(null) },
        json: async () => ({
          value: [
            {
              chunk_id: 'doc1',
              page_chunk: 'Moon landing content',
              '@search.score': 2.5,
              '@search.rerankerScore': 3.0
            },
            {
              chunk_id: 'doc2',
              page_chunk: 'Apollo mission details',
              '@search.score': 2.3,
              '@search.rerankerScore': 2.8
            }
          ]
        })
      };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('emits telemetry and returns adaptive stats when enabled', { timeout: 30000 }, async () => {
    const events: Array<{ event: string; data: any }> = [];
    const emit = (event: string, data: unknown) => events.push({ event, data });

    const plan: PlanSummary = {
      confidence: 0.9,
      steps: [{ action: 'vector_search', query: 'moon landing photos', k: 5 }]
    };

    const result = await dispatchTools({
      plan,
      messages: [{ role: 'user', content: 'Show me moon landing photos' }],
      salience: [],
      emit,
      features: {
        queryDecomposition: false,
        webReranking: false,
        semanticBoost: false,
        responseStorage: false,
        adaptiveRetrieval: true,
        lazyRetrieval: false
      } as any,
      featureStates: { ENABLE_ADAPTIVE_RETRIEVAL: true }
    });

    // Verify activity and references
    expect(result.activity.some((s) => s.type === 'adaptive_search')).toBe(true);
    expect(result.references.length).toBeGreaterThan(0);

    // Verify telemetry event emitted
    const teleEvt = events.find((e) => e.event === 'telemetry');
    expect(teleEvt).toBeDefined();
    expect((teleEvt!.data as any).adaptive_retrieval).toBeDefined();
    const stats = (teleEvt!.data as any).adaptive_retrieval;
    expect(stats.triggered).toBe(true);
    expect(stats.attempts).toBe(2);
    expect(stats.trigger_reason).toBe('both');

    // Verify dispatch carries stats up to orchestrator layer
    expect((result as any).adaptiveStats).toBeDefined();
  });
});

