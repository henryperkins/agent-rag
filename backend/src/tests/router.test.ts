import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../azure/openaiClient.js', () => ({
  createResponse: vi.fn()
}));

const openaiClient = await import('../azure/openaiClient.js');
const { config } = await import('../config/app.js');
const { classifyIntent, getRouteConfig } = await import('../orchestrator/router.js');

describe('intent router', () => {
  beforeEach(() => {
    config.ENABLE_INTENT_ROUTING = true;
    config.INTENT_CLASSIFIER_MODEL = 'test-model';
    (openaiClient.createResponse as unknown as Mock).mockReset();
  });

  it('classifies faq intent using Azure OpenAI', async () => {
    (openaiClient.createResponse as unknown as Mock).mockResolvedValueOnce({
      output_text: JSON.stringify({
        intent: 'faq',
        confidence: 0.91,
        reasoning: 'Direct question answered by docs'
      })
    });

    const result = await classifyIntent('What does Azure AI Search do?');

    expect(result.intent).toBe('faq');
    expect(result.confidence).toBeCloseTo(0.91);
  });

  it('falls back to research intent when classification fails', async () => {
    (openaiClient.createResponse as unknown as Mock).mockRejectedValueOnce(new Error('network error'));

    const result = await classifyIntent('Explain the architecture.');

    expect(result.intent).toBe('research');
    expect(result.confidence).toBeLessThan(1);
  });

  it('returns route configuration for conversational fallback', () => {
    const configEntry = getRouteConfig('conversational');
    expect(configEntry.intent).toBe('conversational');
    expect(configEntry.model).toBeTruthy();
  });
});
