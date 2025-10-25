import { describe, it, expect, vi, afterEach } from 'vitest';
import { dispatchTools } from '../orchestrator/dispatch.js';
import type { PlanSummary, Reference, ActivityStep, AdaptiveRetrievalStats } from '../../../shared/types.js';

// Mock adaptive retrieval results
const mockAdaptiveRetrievalResult = () => {
  const initial = { coverage: 0.2, diversity: 0.25, authority: 0.3, freshness: 0.5 };
  const final = { coverage: 0.88, diversity: 0.6, authority: 0.8, freshness: 0.5 };
  const attempts = [
    { attempt: 1, query: 'moon landing photos', quality: initial, latency_ms: 25 },
    { attempt: 2, query: 'moon landing photos site:nasa.gov', quality: final, latency_ms: 30 }
  ];

  const adaptiveStats: AdaptiveRetrievalStats = {
    enabled: true,
    attempts: 2,
    triggered: true,
    trigger_reason: 'both',
    thresholds: { coverage: 0.4, diversity: 0.3 },
    initial_quality: initial,
    final_quality: final,
    reformulations_count: 1,
    reformulations_sample: ['site:nasa.gov'],
    latency_ms_total: 55,
    per_attempt: attempts
  };

  const references: Reference[] = [
    { id: 'doc1', title: 'Doc1', content: 'a', score: 2.0 },
    { id: 'doc2', title: 'Doc2', content: 'b', score: 2.2 },
    { id: 'doc3', title: 'Doc3', content: 'c', score: 2.1 }
  ];

  const activity: ActivityStep[] = [
    {
      type: 'adaptive_search',
      description: 'Adaptive retrieval returned 3 result(s) (coverage=0.88, diversity=0.60).',
      timestamp: new Date().toISOString()
    }
  ];

  return { references, activity, adaptiveStats };
};

describe('Adaptive Retrieval Telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits telemetry and returns adaptive stats when enabled', { timeout: 30000 }, async () => {
    const events: Array<{ event: string; data: any }> = [];
    const emit = (event: string, data: unknown) => events.push({ event, data });

    const plan: PlanSummary = {
      confidence: 0.9,
      steps: [{ action: 'vector_search', query: 'moon landing photos', k: 5 }]
    };

    // Mock the retrieve tool to return adaptive retrieval results
    const mockResult = mockAdaptiveRetrievalResult();
    const mockRetrieve = vi.fn().mockResolvedValue({
      response: 'Mock response',
      references: mockResult.references,
      activity: mockResult.activity,
      adaptiveStats: mockResult.adaptiveStats
    });

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
      featureStates: { ENABLE_ADAPTIVE_RETRIEVAL: true },
      tools: {
        retrieve: mockRetrieve
      }
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

