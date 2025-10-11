/**
 * Integration scenarios aligned with docs/unified-orchestrator-context-pipeline.md (Phase 4 hardening).
 * 1. High-confidence vector path (no escalation, citations mandatory).
 * 2. Low-confidence escalation to dual retrieval.
 * 3. Knowledge agent failure cascading to fallback vector search.
 * 4. Planner 'both' step combining knowledge + web at high confidence.
 *
 * Tests exercise the Fastify `/chat` route so sanitization, telemetry, and orchestrator wiring are covered end-to-end.
 */

import Fastify from 'fastify';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { clearSessionTelemetry, getSessionTelemetry } from '../orchestrator/sessionTelemetryStore.js';
import { sessionStore } from '../services/sessionStore.js';

const toolMocks = {
  retrieve: vi.fn(),
  webSearch: vi.fn(),
  answer: vi.fn(),
  critic: vi.fn()
};

const plannerMock = vi.fn();

vi.mock('../tools/index.js', () => ({
  retrieveTool: (args: any) => toolMocks.retrieve(args),
  lazyRetrieveTool: (args: any) => toolMocks.retrieve(args),
  webSearchTool: (args: any) => toolMocks.webSearch(args),
  answerTool: (args: any) => toolMocks.answer(args)
}));

vi.mock('../orchestrator/critique.js', () => ({
  evaluateAnswer: (args: any) => toolMocks.critic(args)
}));

vi.mock('../orchestrator/plan.js', () => ({
  getPlan: (...params: any[]) => plannerMock(...params)
}));

vi.mock('../azure/openaiClient.js', () => ({
  createResponseStream: vi.fn(),
  createEmbeddings: vi.fn()
}));

vi.mock('../orchestrator/semanticMemoryStore.js', () => ({
  semanticMemoryStore: {
    recallMemories: vi.fn().mockResolvedValue([]),
    addMemory: vi.fn().mockResolvedValue(1)
  }
}));

const openaiClient = await import('../azure/openaiClient.js');

let registerRoutes: typeof import('../routes/index.js').registerRoutes;

beforeAll(async () => {
  ({ registerRoutes } = await import('../routes/index.js'));
});

beforeEach(() => {
  plannerMock.mockReset();
  toolMocks.retrieve.mockReset();
  toolMocks.webSearch.mockReset();
  toolMocks.answer.mockReset();
  toolMocks.critic.mockReset();
  (openaiClient.createResponseStream as unknown as Mock).mockReset();
  (openaiClient.createEmbeddings as unknown as Mock).mockReset();
  clearSessionTelemetry();
  sessionStore.clearAll();
});

describe('orchestrator integration via /chat route', () => {
  it('serves high-confidence vector retrieval with citations and no web search', async () => {
    plannerMock.mockResolvedValueOnce({
      confidence: 0.82,
      steps: [{ action: 'vector_search' }]
    });

    toolMocks.retrieve.mockResolvedValueOnce({
      response: 'Azure AI Search enables full-text and vector retrieval.',
      references: [
        {
          id: 'doc-azure-search',
          title: 'Azure AI Search Overview',
          url: 'https://contoso.com/azure-search',
          content: 'Azure AI Search provides indexing and retrieval capabilities.'
        }
      ],
      activity: []
    });

    toolMocks.answer.mockResolvedValueOnce({
      answer: 'Azure AI Search indexes data and makes it discoverable. [1]'
    });

    toolMocks.critic.mockResolvedValueOnce({
      grounded: true,
      coverage: 0.92,
      action: 'accept',
      issues: []
    });

    const app = Fastify({ logger: false });
    await registerRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        messages: [{ role: 'user', content: 'What does Azure AI Search do?' }]
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.answer).toContain('Azure AI Search');
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0].id).toBe('doc-azure-search');
    expect(body.metadata?.plan?.confidence).toBeCloseTo(0.82);
    expect(body.metadata?.web_context).toBeUndefined();
    expect(body.metadata?.evaluation?.summary.status).toBeDefined();
    expect(body.metadata?.evaluation?.agent?.intentResolution?.metric).toBe('intent_resolution');
    expect(toolMocks.webSearch).not.toHaveBeenCalled();
    expect(toolMocks.retrieve).toHaveBeenCalledTimes(1);
  });

  it('escalates to dual retrieval when planner confidence is low', async () => {
    plannerMock.mockResolvedValueOnce({
      confidence: 0.2,
      steps: []
    });

    toolMocks.retrieve.mockResolvedValueOnce({
      response: 'Vector snippet',
      references: [
        {
          id: 'doc-low-confidence',
          title: 'Knowledge doc',
          content: 'Knowledge content'
        }
      ],
      activity: []
    });

    toolMocks.webSearch.mockResolvedValueOnce({
      results: [
        {
          id: 'web-1',
          title: 'Latest update',
          snippet: 'Fresh info about Azure AI Search',
          url: 'https://example.com/latest',
          body: 'Fresh info about Azure AI Search',
          rank: 1,
          fetchedAt: new Date().toISOString()
        }
      ],
      contextText: 'Fresh info about Azure AI Search',
      tokens: 120,
      trimmed: false
    });

    toolMocks.answer.mockResolvedValueOnce({ answer: 'Combining sources. [1]' });
    toolMocks.critic.mockResolvedValueOnce({ grounded: true, coverage: 0.9, action: 'accept', issues: [] });

    const app = Fastify({ logger: false });
    await registerRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        messages: [{ role: 'user', content: 'Give me the latest Azure AI Search updates.' }]
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.metadata?.plan?.confidence).toBeCloseTo(0.2);
    expect(body.metadata?.web_context?.tokens).toBe(120);
    expect(toolMocks.retrieve).toHaveBeenCalledTimes(1);
    expect(toolMocks.webSearch).toHaveBeenCalledTimes(1);
    expect(body.activity.some((step: any) => step.type === 'confidence_escalation')).toBe(true);
  });

  it('falls back to vector search when knowledge agent indicates fallback', async () => {
    plannerMock.mockResolvedValueOnce({
      confidence: 0.75,
      steps: [{ action: 'vector_search' }]
    });

    toolMocks.retrieve.mockResolvedValueOnce({
      response: 'Fallback snippet',
      references: [
        {
          id: 'doc-fallback',
          title: 'Fallback doc',
          content: 'Fallback content'
        }
      ],
      activity: [{ type: 'fallback_search', description: 'Fallback: knowledge agent unavailable' }]
    });

    toolMocks.answer.mockResolvedValueOnce({ answer: 'Fallback response. [1]' });
    toolMocks.critic.mockResolvedValueOnce({ grounded: true, coverage: 0.88, action: 'accept', issues: [] });

    const app = Fastify({ logger: false });
    await registerRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        messages: [{ role: 'user', content: 'Why did fallback trigger?' }]
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.citations[0].id).toBe('doc-fallback');
    const telemetry = getSessionTelemetry();
    expect(telemetry[0]?.retrieval?.fallbackReason ?? telemetry[0]?.retrieval?.fallback_reason).toBe(
      'direct_search_fallback'
    );
    expect(toolMocks.webSearch).not.toHaveBeenCalled();
  });

  it('executes combined retrieval when planner requests both', async () => {
    plannerMock.mockResolvedValueOnce({
      confidence: 0.7,
      steps: [{ action: 'both', query: 'Azure AI Search roadmap', k: 2 }]
    });

    toolMocks.retrieve.mockResolvedValueOnce({
      response: 'Knowledge snippet',
      references: [
        {
          id: 'doc-combined',
          title: 'Combined doc',
          content: 'Combined content'
        }
      ],
      activity: []
    });

    toolMocks.webSearch.mockResolvedValueOnce({
      results: [
        {
          id: 'web-2',
          title: 'Roadmap post',
          snippet: 'Roadmap details',
          url: 'https://example.com/roadmap',
          body: 'Roadmap details',
          rank: 1,
          fetchedAt: new Date().toISOString()
        }
      ],
      contextText: 'Roadmap details',
      tokens: 90,
      trimmed: false
    });

    toolMocks.answer.mockResolvedValueOnce({ answer: 'Here is the summary. [1]' });
    toolMocks.critic.mockResolvedValueOnce({ grounded: true, coverage: 0.9, action: 'accept', issues: [] });

    const app = Fastify({ logger: false });
    await registerRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        messages: [{ role: 'user', content: 'Summarize the Azure AI Search roadmap' }]
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(toolMocks.retrieve).toHaveBeenCalledTimes(1);
    expect(toolMocks.webSearch).toHaveBeenCalledTimes(1);
    expect(body.metadata?.web_context?.tokens).toBe(90);
    expect(body.citations[0].id).toBe('doc-combined');
  });

  it('streams events with low-confidence escalation and token emission', async () => {
    plannerMock.mockResolvedValueOnce({
      confidence: 0.2,
      steps: []
    });

    toolMocks.retrieve.mockResolvedValueOnce({
      response: 'Vector snippet',
      references: [
        {
          id: 'doc-stream',
          title: 'Stream doc',
          content: 'Stream content'
        }
      ],
      activity: []
    });

    toolMocks.webSearch.mockResolvedValueOnce({
      results: [
        {
          id: 'web-stream',
          title: 'Stream web',
          snippet: 'Stream snippet',
          url: 'https://example.com/stream',
          body: 'Stream snippet',
          rank: 1,
          fetchedAt: new Date().toISOString()
        }
      ],
      contextText: 'Stream snippet',
      tokens: 60,
      trimmed: false
    });

    toolMocks.critic.mockResolvedValueOnce({ grounded: true, coverage: 0.95, action: 'accept', issues: [] });

    const encoder = new TextEncoder();
    const chunks = [
      'data: {"type":"response.output_text.delta","delta":"Final answer [1]"}\n\n',
      'data: {"type":"response.completed","response":{"output_text":"Final answer [1]"}}\n\n'
    ];
    (openaiClient.createResponseStream as unknown as Mock).mockResolvedValue({
      read: vi.fn().mockImplementation(async () => {
        if (!chunks.length) {
          return { value: undefined, done: true };
        }
        const value = encoder.encode(chunks.shift() as string);
        return { value, done: false };
      })
    });

    const app = Fastify({ logger: false });
    await registerRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/chat/stream',
      payload: {
        messages: [{ role: 'user', content: 'Stream the latest Azure AI Search updates.' }]
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.body as string;
    const events = body
      .trim()
      .split(/\n\n/)
      .filter(Boolean)
      .map((block) => {
        const lines = block.split('\n');
        const eventLine = lines.find((line) => line.startsWith('event:')) ?? '';
        const dataLine = lines.find((line) => line.startsWith('data:')) ?? '';
        const event = eventLine.replace('event: ', '').trim();
        const data = dataLine ? JSON.parse(dataLine.replace('data: ', '').trim()) : undefined;
        return { event, data };
      });

    expect(events.some((entry) => entry.event === 'features')).toBe(true);
    const statusStages = events.filter((entry) => entry.event === 'status').map((entry) => entry.data.stage);
    expect(statusStages[0]).toBe('intent_classification');
    expect(statusStages).toContain('context');
    expect(statusStages).toContain('confidence_escalation');
    expect(statusStages).toContain('retrieval');
    expect(statusStages).toContain('web_search');

    const tokenIndex = events.findIndex((entry) => entry.event === 'token');
    const completeIndex = events.findIndex((entry) => entry.event === 'complete');
    expect(tokenIndex).toBeGreaterThan(-1);
    expect(completeIndex).toBeGreaterThan(tokenIndex);

    const completeEvent = events.find((entry) => entry.event === 'complete');
    expect(completeEvent?.data.answer).toBe('Final answer [1]');
    expect(events.some((entry) => entry.event === 'done')).toBe(true);
  });

  it('applies feature overrides and persists resolved selections per session', async () => {
    plannerMock.mockResolvedValueOnce({
      confidence: 0.82,
      steps: [{ action: 'vector_search' }]
    });

    toolMocks.retrieve.mockResolvedValueOnce({
      response: 'Federated search snippet',
      references: [
        {
          id: 'doc-federated',
          title: 'Federated result',
          content: 'Federated body'
        }
      ],
      activity: []
    });

    toolMocks.answer.mockResolvedValueOnce({
      answer: 'Federated answer. [1]'
    });

    toolMocks.critic.mockResolvedValueOnce({
      grounded: true,
      coverage: 0.9,
      action: 'accept',
      issues: []
    });

    const app = Fastify({ logger: false });
    await registerRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      payload: {
        sessionId: 'feature-session',
        messages: [{ role: 'user', content: 'Demonstrate feature toggles.' }],
        feature_overrides: {
          ENABLE_MULTI_INDEX_FEDERATION: true,
          ENABLE_LAZY_RETRIEVAL: true,
          ENABLE_RESPONSE_STORAGE: true,
          ENABLE_INTENT_ROUTING: true
        }
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);

    expect(toolMocks.answer).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.objectContaining({
          ENABLE_RESPONSE_STORAGE: true
        })
      })
    );

    const body = response.json();
    expect(body.metadata?.features?.resolved.ENABLE_MULTI_INDEX_FEDERATION).toBe(true);
    expect(body.metadata?.features?.overrides?.ENABLE_LAZY_RETRIEVAL).toBe(true);
    expect(body.metadata?.features?.sources?.ENABLE_LAZY_RETRIEVAL).toBe('override');
    expect(body.metadata?.features?.sources?.ENABLE_MULTI_INDEX_FEDERATION).toBe('override');

    const stored = sessionStore.loadFeatures('feature-session');
    expect(stored?.features.ENABLE_MULTI_INDEX_FEDERATION).toBe(true);
    expect(stored?.features.ENABLE_LAZY_RETRIEVAL).toBe(true);
    expect(stored?.features.ENABLE_RESPONSE_STORAGE).toBe(true);
  });
});
