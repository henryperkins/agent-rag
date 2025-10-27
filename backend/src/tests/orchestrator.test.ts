import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../orchestrator/semanticMemoryStore.js', () => ({
  semanticMemoryStore: {
    recallMemories: vi.fn().mockResolvedValue([]),
    addMemory: vi.fn().mockResolvedValue(1)
  }
}));

import { runSession } from '../orchestrator/index.js';
import * as planModule from '../orchestrator/plan.js';
import { clearMemory } from '../orchestrator/memoryStore.js';
import type { CriticReport, PlanSummary } from '../../../shared/types.js';
import { config } from '../config/app.js';

const acceptCritic: CriticReport = {
  grounded: true,
  coverage: 0.9,
  action: 'accept',
  issues: []
};

describe('runSession orchestrator', () => {
  const originalThresholds = {
    reranker: config.RERANKER_THRESHOLD,
    fallback: config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD,
    minimum: config.RETRIEVAL_MIN_RERANKER_THRESHOLD
  };
  const originalFlags = {
    enableCrag: config.ENABLE_CRAG
  };

  beforeEach(() => {
    clearMemory();
    config.RERANKER_THRESHOLD = 0;
    config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD = 0;
    config.RETRIEVAL_MIN_RERANKER_THRESHOLD = 0;
    config.ENABLE_CRAG = false;
    // Disable web quality filter to avoid filtering out mocked results
    config.ENABLE_WEB_QUALITY_FILTER = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    config.RERANKER_THRESHOLD = originalThresholds.reranker;
    config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD = originalThresholds.fallback;
    config.RETRIEVAL_MIN_RERANKER_THRESHOLD = originalThresholds.minimum;
    config.ENABLE_CRAG = originalFlags.enableCrag;
  });

  it('returns citations and respects planner vector search path at high confidence', { timeout: 30000 }, async () => {
    vi.spyOn(planModule, 'getPlan').mockResolvedValue({
      confidence: 0.9,
      steps: [{ action: 'vector_search' }]
    } satisfies PlanSummary);

    const references = [
      {
        id: 'doc-1',
        title: 'Azure AI Search',
        content: 'Azure AI Search provides indexing and querying capabilities.'
      }
    ];

    const retrieve = vi.fn().mockResolvedValue({
      response: 'Azure AI Search provides indexing and querying capabilities.',
      references,
      activity: []
    });

    const lazyRetrieve = vi.fn().mockResolvedValue({
      response: 'Azure AI Search provides indexing and querying capabilities.',
      references,
      activity: []
    });

    const answer = vi.fn().mockResolvedValue({
      answer: 'Azure AI Search indexes content for discovery. [1]',
      citations: [],
      responseId: 'test-response-id-1'
    });

    const critic = vi.fn().mockResolvedValue(acceptCritic);
    const webSearch = vi.fn();

    const result = await runSession({
      sessionId: 'session-high-confidence',
      mode: 'sync',
      messages: [{ role: 'user', content: 'What does Azure AI Search do?' }],
      tools: { retrieve, lazyRetrieve, answer, critic, webSearch }
    });

    // Either retrieve or lazyRetrieve should be called, depending on ENABLE_LAZY_RETRIEVAL config
    expect(retrieve.mock.calls.length + lazyRetrieve.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(webSearch).not.toHaveBeenCalled();
    expect(result.answer).toContain('Azure AI Search');
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].id).toBe('doc-1');
    expect(result.metadata?.plan?.confidence).toBeCloseTo(0.9);
    expect(result.metadata?.context_budget?.history_tokens).toBeGreaterThan(0);
    expect(result.activity.some((step) => step.type === 'confidence_escalation')).toBe(false);
    expect(result.metadata?.web_context).toBeUndefined();
  });

  it('escalates to dual retrieval when planner confidence is low', { timeout: 60000 }, async () => {
    // Disable query decomposition to test pure confidence escalation behavior
    vi.stubEnv('ENABLE_QUERY_DECOMPOSITION', 'false');

    vi.spyOn(planModule, 'getPlan').mockResolvedValue({
      confidence: 0.2,
      steps: []
    } satisfies PlanSummary);

    const references = [
      {
        id: 'doc-2',
        title: 'Azure AI Search Overview',
        content: 'Overview content'
      }
    ];

    const retrieve = vi.fn().mockResolvedValue({
      response: 'Overview content snippet',
      references,
      activity: []
    });

    const lazyRetrieve = vi.fn().mockResolvedValue({
      response: 'Overview content snippet',
      references,
      activity: []
    });

    const webSearchResults = {
      results: [
        {
          id: 'web-1',
          title: 'Latest Azure AI Search blog',
          snippet: 'Recent changes to Azure AI Search.',
          url: 'https://example.com/azure-search',
          body: 'Recent changes to Azure AI Search.',
          rank: 1,
          fetchedAt: new Date().toISOString()
        }
      ],
      contextText: 'Recent changes to Azure AI Search.',
      tokens: 80,
      trimmed: false
    } as const;

    const webSearch = vi.fn().mockResolvedValue(webSearchResults);
    const answer = vi.fn().mockResolvedValue({
      answer: 'Here is what I found. [1][2]',
      citations: [],
      responseId: 'test-response-id-2'
    });
    const critic = vi.fn().mockResolvedValue(acceptCritic);

    const events: Array<{ event: string; data: unknown }> = [];
    const result = await runSession({
      sessionId: 'session-low-confidence',
      mode: 'sync',
      messages: [{ role: 'user', content: 'Give me the latest Azure AI Search updates.' }],
      emit: (event, data) => events.push({ event, data }),
      tools: { retrieve, lazyRetrieve, webSearch, answer, critic }
    });

    // Either retrieve or lazyRetrieve should be called, depending on ENABLE_LAZY_RETRIEVAL config
    expect(retrieve.mock.calls.length + lazyRetrieve.mock.calls.length).toBeGreaterThanOrEqual(1);
    // WebSearch may be called multiple times depending on configuration (CRAG, retry logic, etc.)
    expect(webSearch).toHaveBeenCalled();
    // System combines retrieval result (doc-2) and web result (web-1)
    // Note: With adaptive retrieval/CRAG enabled, additional queries may generate more citations
    expect(result.citations.length).toBeGreaterThanOrEqual(2);
    expect(result.citations.some(c => c.id === 'doc-2')).toBe(true);
    // Token count is recalculated by buildWebContext, not from mock
    expect(result.metadata?.web_context?.tokens).toBeGreaterThan(0);
    expect(result.metadata?.plan?.confidence).toBeCloseTo(0.2);
    // Debug: log activities to diagnose missing confidence_escalation
    console.log('Activity types:', result.activity.map(s => s.type));
    console.log('Event stages:', events.filter(e => e.event === 'status').map(e => (e.data as any)?.stage));
    expect(result.activity.some((step) => step.type === 'confidence_escalation')).toBe(true);
    expect(events.some((entry) => entry.event === 'status' && (entry.data as any)?.stage === 'confidence_escalation')).toBe(true);
  });

  it('retries synthesis when critic requests revision', { timeout: 60000 }, async () => {
    vi.spyOn(planModule, 'getPlan').mockResolvedValue({
      confidence: 0.8,
      steps: [{ action: 'vector_search' }]
    } satisfies PlanSummary);

    const references = [
      {
        id: 'doc-crit-1',
        title: 'Critic doc',
        content: 'Critic content'
      }
    ];

    const retrieve = vi.fn().mockResolvedValue({
      response: 'Critic content snippet',
      references,
      activity: []
    });

    const answer = vi
      .fn()
      .mockResolvedValueOnce({
        answer: 'Draft answer without citation.',
        citations: [],
        responseId: 'test-response-id-3a'
      })
      .mockResolvedValueOnce({
        answer: 'Final answer with citation. [1]',
        citations: [],
        responseId: 'test-response-id-3b'
      });

    const critic = vi
      .fn()
      .mockResolvedValueOnce({ grounded: false, coverage: 0.4, action: 'revise', issues: ['Add grounding'] })
      .mockResolvedValueOnce(acceptCritic);

    const webSearch = vi.fn();
    const events: Array<{ event: string; data: any }> = [];
    const originalRetries = config.CRITIC_MAX_RETRIES;
    const originalLazy = config.ENABLE_LAZY_RETRIEVAL;
    config.CRITIC_MAX_RETRIES = 1;
    config.ENABLE_LAZY_RETRIEVAL = false;

    try {
      const result = await runSession({
        sessionId: 'session-critic-retry',
        mode: 'sync',
        messages: [{ role: 'user', content: 'Provide grounded summary.' }],
        emit: (event, data) => events.push({ event, data }),
        tools: { retrieve, answer, critic, webSearch }
      });

      expect(answer).toHaveBeenCalledTimes(2);
      expect(answer.mock.calls[1][0].revisionNotes).toEqual(['Add grounding']);
      expect(critic).toHaveBeenCalledTimes(2);
      expect(result.metadata?.critic_iterations).toBe(2);
      expect(result.metadata?.critique_history).toHaveLength(2);

      const statusStages = events.filter((entry) => entry.event === 'status').map((entry) => entry.data.stage);
      expect(statusStages).toContain('revising');
    } finally {
      config.CRITIC_MAX_RETRIES = originalRetries;
      config.ENABLE_LAZY_RETRIEVAL = originalLazy;
    }
  });
});
