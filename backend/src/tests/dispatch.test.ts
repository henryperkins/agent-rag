import { describe, expect, it, vi } from 'vitest';

import { dispatchTools } from '../orchestrator/dispatch.js';
import type { AgentMessage, PlanSummary } from '../../../shared/types.js';

describe('dispatchTools confidence escalation', () => {
  const messages: AgentMessage[] = [{ role: 'user', content: 'Tell me about Azure AI Search.' }];

  it('forces dual retrieval when confidence drops below threshold', async () => {
    const plan: PlanSummary = {
      confidence: 0.2,
      steps: []
    };

    const retrieve = vi.fn().mockResolvedValue({
      response: 'Knowledge agent snippet',
      references: [],
      activity: []
    });

    const webSearch = vi.fn().mockResolvedValue({
      results: [
        {
          id: 'web-1',
          title: 'Azure Search update',
          snippet: 'Azure Search overview',
          url: 'https://example.com',
          body: 'Azure Search overview',
          rank: 1,
          fetchedAt: new Date().toISOString()
        }
      ],
      contextText: 'Azure Search overview',
      tokens: 120,
      trimmed: false
    });

    const events: Array<{ event: string; data: unknown }> = [];
    const result = await dispatchTools({
      plan,
      messages,
      salience: [],
      emit: (event, data) => {
        events.push({ event, data });
      },
      tools: { retrieve, webSearch }
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(webSearch).toHaveBeenCalledTimes(1);
    expect(result.escalated).toBe(true);
    expect(events.some((entry) => entry.event === 'status' && (entry.data as any)?.stage === 'confidence_escalation')).toBe(true);
    expect(result.activity.some((step) => step.type === 'confidence_escalation')).toBe(true);
    expect(result.webContextText).toContain('Azure Search overview');
  });

  it('respects plan instructions when confidence is high', async () => {
    const plan: PlanSummary = {
      confidence: 0.9,
      steps: [{ action: 'vector_search' }]
    };

    const retrieve = vi.fn().mockResolvedValue({
      response: 'Knowledge snippet',
      references: [
        {
          id: '1',
          title: 'Doc',
          content: 'Azure Search doc'
        }
      ],
      activity: []
    });

    const webSearch = vi.fn();
    const events: Array<{ event: string; data: unknown }> = [];

    const result = await dispatchTools({
      plan,
      messages,
      salience: [],
      emit: (event, data) => {
        events.push({ event, data });
      },
      tools: { retrieve, webSearch }
    });

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(webSearch).not.toHaveBeenCalled();
    expect(result.escalated).toBe(false);
    expect(events.every((entry) => (entry.data as any)?.stage !== 'confidence_escalation')).toBe(true);
    expect(result.activity.some((step) => step.type === 'confidence_escalation')).toBe(false);
  });
});
