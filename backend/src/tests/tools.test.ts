import { describe, expect, it, vi, beforeEach } from 'vitest';
import { retrieveTool } from '../tools/index.js';
import * as directSearch from '../azure/directSearch.js';
import * as knowledgeAgent from '../azure/knowledgeAgent.js';
import { config } from '../config/app.js';
import { resetRerankerThresholdWarnings } from '../utils/reranker-threshold.js';

// Mock the azure modules
vi.mock('../azure/directSearch.js', () => ({
  hybridSemanticSearch: vi.fn(),
  vectorSearch: vi.fn(),
  isRestrictiveFilter: vi.fn(() => false)
}));

vi.mock('../azure/knowledgeAgent.js', () => ({
  invokeKnowledgeAgent: vi.fn()
}));

vi.mock('../azure/multiIndexSearch.js', () => ({
  federatedSearch: vi.fn()
}));

vi.mock('../utils/resilience.js', () => ({
  withRetry: vi.fn((_, fn) => fn())
}));

describe('retrieveTool coverage threshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRerankerThresholdWarnings();
  });

  it('emits low_coverage activity when Azure coverage is below threshold (0-100 scale)', async () => {
    // Azure returns coverage as 0-100 (e.g., 75 = 75%)
    // Config SEARCH_MIN_COVERAGE is 0-1 scale (e.g., 0.8 = 80%)
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 75 // 75% coverage from Azure (0-100 scale)
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: {
        ENABLE_MULTI_INDEX_FEDERATION: false,
        ENABLE_ADAPTIVE_RETRIEVAL: false
      }
    });

    // Should have low_coverage activity since 75% < 80% threshold
    expect(result.activity).toBeDefined();
    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeDefined();
    expect(lowCoverageActivity?.description).toContain('75%');
    expect(lowCoverageActivity?.description).toContain('80%');
    expect(lowCoverageActivity?.description).not.toContain('7500%'); // Should not have scale error
  });

  it('does not emit low_coverage activity when Azure coverage meets threshold', async () => {
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 85 // 85% coverage from Azure (above 80% threshold)
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: {
        ENABLE_MULTI_INDEX_FEDERATION: false,
        ENABLE_ADAPTIVE_RETRIEVAL: false
      }
    });

    expect(result.activity).toBeDefined();
    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeUndefined();
  });

  it('handles coverage exactly at threshold (boundary case)', async () => {
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 80 // Exactly at 80% threshold
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: {
        ENABLE_MULTI_INDEX_FEDERATION: false,
        ENABLE_ADAPTIVE_RETRIEVAL: false
      }
    });

    expect(result.activity).toBeDefined();
    // Should not emit low_coverage since 80% == 80% (not below)
    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeUndefined();
  });

  it('handles missing coverage value gracefully', async () => {
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ]
      // No coverage field
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: {
        ENABLE_MULTI_INDEX_FEDERATION: false,
        ENABLE_ADAPTIVE_RETRIEVAL: false
      }
    });

    expect(result.activity).toBeDefined();
    // Should not emit low_coverage when coverage is undefined
    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeUndefined();
  });

  it('correctly formats coverage percentage in activity message', async () => {
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 65.7 // Test decimal handling
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: {
        ENABLE_MULTI_INDEX_FEDERATION: false,
        ENABLE_ADAPTIVE_RETRIEVAL: false
      }
    });

    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeDefined();
    // Should show "66%" (rounded) not "6570%"
    expect(lowCoverageActivity?.description).toMatch(/66%.*below.*80%/);
  });

  it('uses config.SEARCH_MIN_COVERAGE for threshold comparison', async () => {
    // Verify that we're comparing against the right config value
    expect(config.SEARCH_MIN_COVERAGE).toBe(0.8); // Should be 0-1 scale

    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 79 // Just below 80%
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: {
        ENABLE_MULTI_INDEX_FEDERATION: false,
        ENABLE_ADAPTIVE_RETRIEVAL: false
      }
    });

    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeDefined();
  });

  it('uses knowledge agent when strategy is enabled', async () => {
    const originalStrategy = config.RETRIEVAL_STRATEGY;

    try {
      config.RETRIEVAL_STRATEGY = 'knowledge_agent';

      vi.mocked(knowledgeAgent.invokeKnowledgeAgent).mockResolvedValue({
        references: [
          { id: 'ka-1', title: 'Knowledge Agent Doc', content: 'Agent content.' },
          { id: 'ka-2', title: 'Knowledge Agent Doc 2', content: 'Agent content 2.' },
          { id: 'ka-3', title: 'Knowledge Agent Doc 3', content: 'Agent content 3.' }
        ],
        activity: [
          {
            type: 'knowledge_agent_search',
            description: 'Knowledge agent returned 3 result(s).',
            timestamp: new Date().toISOString()
          }
        ],
        answer: 'Knowledge agent answer'
      });

      const result = await retrieveTool({
        query: 'azure knowledge',
        messages: [{ role: 'user', content: 'Explain Azure Search' }],
        features: {
          ENABLE_MULTI_INDEX_FEDERATION: false,
          ENABLE_ADAPTIVE_RETRIEVAL: false
        }
      });

      expect(knowledgeAgent.invokeKnowledgeAgent).toHaveBeenCalledTimes(1);
      expect(directSearch.hybridSemanticSearch).not.toHaveBeenCalled();
      expect(result.mode).toBe('knowledge_agent');
      expect(result.strategy).toBe('knowledge_agent');
      expect(result.references).toHaveLength(3);
      expect(result.activity.some((step) => step.type.includes('knowledge_agent'))).toBe(true);
      expect(result.response).toBe('Knowledge agent answer');
    } finally {
      config.RETRIEVAL_STRATEGY = originalStrategy;
      vi.mocked(knowledgeAgent.invokeKnowledgeAgent).mockReset();
    }
  });

  it('falls back to direct search when knowledge agent fails', async () => {
    const originalStrategy = config.RETRIEVAL_STRATEGY;

    try {
      config.RETRIEVAL_STRATEGY = 'knowledge_agent';

      vi.mocked(knowledgeAgent.invokeKnowledgeAgent).mockRejectedValue(new Error('agent failure'));

      vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue({
        references: [
          { id: 'dir-1', title: 'Direct Doc 1', content: 'Direct content 1' },
          { id: 'dir-2', title: 'Direct Doc 2', content: 'Direct content 2' },
          { id: 'dir-3', title: 'Direct Doc 3', content: 'Direct content 3' }
        ],
        coverage: 95
      });

      vi.mocked(directSearch.vectorSearch).mockResolvedValue({ references: [] });

      const result = await retrieveTool({
        query: 'fallback query',
        messages: [{ role: 'user', content: 'Tell me more' }],
        features: {
          ENABLE_MULTI_INDEX_FEDERATION: false,
          ENABLE_ADAPTIVE_RETRIEVAL: false
        }
      });

      expect(knowledgeAgent.invokeKnowledgeAgent).toHaveBeenCalledTimes(1);
      expect(directSearch.hybridSemanticSearch).toHaveBeenCalledTimes(1);
      expect(result.strategy).toBe('knowledge_agent');
      expect(result.references.length).toBeGreaterThan(0);
      expect(result.activity.some((step) => step.type === 'knowledge_agent_error')).toBe(true);
    } finally {
      config.RETRIEVAL_STRATEGY = originalStrategy;
      vi.mocked(knowledgeAgent.invokeKnowledgeAgent).mockReset();
    }
  });

  it('propagates correlation diagnostics when knowledge agent invocation fails', async () => {
    const originalStrategy = config.RETRIEVAL_STRATEGY;
    const originalMinDocs = config.RETRIEVAL_MIN_DOCS;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      config.RETRIEVAL_STRATEGY = 'knowledge_agent';
      config.RETRIEVAL_MIN_DOCS = 1;

      const agentError = new Error('Bad request from knowledge agent');
      (agentError as { status?: number }).status = 400;
      (agentError as { correlationId?: string }).correlationId = 'corr-test';
      (agentError as { requestId?: string }).requestId = 'req-test';

      vi.mocked(knowledgeAgent.invokeKnowledgeAgent).mockRejectedValue(agentError);
      vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue({
        references: [
          { id: 'dir-1', title: 'Direct Doc', content: 'Direct fallback content', score: 3.1 }
        ],
        coverage: 96
      });
      vi.mocked(directSearch.vectorSearch).mockResolvedValue({ references: [] });

      const result = await retrieveTool({
        query: 'diagnostic fallback',
        messages: [{ role: 'user', content: 'Trigger fallback' }],
        features: {
          ENABLE_MULTI_INDEX_FEDERATION: false,
          ENABLE_ADAPTIVE_RETRIEVAL: false
        }
      });

      expect(result.references).toHaveLength(1);
      expect(result.diagnostics?.correlationId).toBeDefined();
      expect(result.diagnostics?.knowledgeAgent?.attempted).toBe(true);
      expect(result.diagnostics?.knowledgeAgent?.failurePhase).toBe('invocation');
      expect(result.diagnostics?.knowledgeAgent?.statusCode).toBe(400);
      expect(result.diagnostics?.knowledgeAgent?.requestId).toBe('req-test');
      expect(result.diagnostics?.knowledgeAgent?.fallbackTriggered).toBe(true);
      const errorActivity = result.activity.find((step) => step.type === 'knowledge_agent_error');
      expect(errorActivity?.description).toContain('correlation=');
      const errorCall = errorSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('knowledge_agent.failure')
      );
      expect(errorCall).toBeDefined();
      const parsed = JSON.parse(errorCall![0] as string);
      expect(parsed.correlationId).toBe(result.diagnostics?.knowledgeAgent?.correlationId);
      expect(parsed.statusCode).toBe(400);
    } finally {
      config.RETRIEVAL_STRATEGY = originalStrategy;
      config.RETRIEVAL_MIN_DOCS = originalMinDocs;
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      vi.mocked(knowledgeAgent.invokeKnowledgeAgent).mockReset();
      vi.mocked(directSearch.hybridSemanticSearch).mockReset();
      vi.mocked(directSearch.vectorSearch).mockReset();
    }
  });

  it('filters knowledge agent references below reranker threshold', async () => {
    const originalStrategy = config.RETRIEVAL_STRATEGY;
    const originalMinDocs = config.RETRIEVAL_MIN_DOCS;

    try {
      config.RETRIEVAL_STRATEGY = 'knowledge_agent';
      config.RETRIEVAL_MIN_DOCS = 1;

      vi.mocked(knowledgeAgent.invokeKnowledgeAgent).mockResolvedValue({
        references: [
          { id: 'ka-1', title: 'High score doc', content: 'High score', score: 3.0 },
          { id: 'ka-2', title: 'Low score doc', content: 'Low score', score: 1.2 }
        ],
        activity: [],
        answer: 'Grounded answer [1]',
        requestId: 'req-k'
      });

      const result = await retrieveTool({
        query: 'threshold enforcement',
        messages: [{ role: 'user', content: 'Check threshold' }],
        features: {
          ENABLE_MULTI_INDEX_FEDERATION: false,
          ENABLE_ADAPTIVE_RETRIEVAL: false
        }
      });

      expect(knowledgeAgent.invokeKnowledgeAgent).toHaveBeenCalledTimes(1);
      expect(directSearch.hybridSemanticSearch).not.toHaveBeenCalled();
      expect(result.mode).toBe('knowledge_agent');
      expect(result.references).toHaveLength(1);
      expect(result.references[0].id).toBe('ka-1');
      expect(result.diagnostics?.knowledgeAgent?.fallbackTriggered).toBe(false);
    } finally {
      config.RETRIEVAL_STRATEGY = originalStrategy;
      config.RETRIEVAL_MIN_DOCS = originalMinDocs;
      vi.mocked(knowledgeAgent.invokeKnowledgeAgent).mockReset();
    }
  });
});
