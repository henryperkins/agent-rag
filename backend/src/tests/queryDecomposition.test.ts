import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../azure/openaiClient.js', () => ({
  createResponse: vi.fn()
}));

vi.mock('../utils/openai.js', () => ({
  extractOutputText: (response: any) => response.output_text ?? ''
}));

const { createResponse } = await import('../azure/openaiClient.js');

describe('queryDecomposition', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('assesses complexity using structured output', async () => {
    (createResponse as any).mockResolvedValueOnce({
      output_text: JSON.stringify({
        complexity: 0.8,
        needsDecomposition: true,
        reasoning: 'Multiple comparisons required'
      })
    });

    const { assessComplexity } = await import('../orchestrator/queryDecomposition.js');
    const result = await assessComplexity('Compare Azure AI Search and Elasticsearch features.');

    expect(result.needsDecomposition).toBe(true);
    expect(result.complexity).toBeGreaterThan(0.5);
    expect(result.reasoning).toContain('Multiple comparisons');
  });

  it('decomposes query into sub-queries', async () => {
    (createResponse as any).mockResolvedValueOnce({
      output_text: JSON.stringify({
        subQueries: [
          { id: 0, query: 'Gather Azure AI Search pricing', dependencies: [], reasoning: 'Baseline pricing info' },
          { id: 1, query: 'Gather Elasticsearch pricing', dependencies: [], reasoning: 'Baseline pricing info' },
          { id: 2, query: 'Compare pricing models', dependencies: [0, 1], reasoning: 'Uses gathered pricing' }
        ],
        synthesisPrompt: 'Summarize similarities and differences.'
      })
    });

    const { decomposeQuery } = await import('../orchestrator/queryDecomposition.js');
    const result = await decomposeQuery('How do Azure AI Search and Elasticsearch pricing compare?');

    expect(result.subQueries).toHaveLength(3);
    expect(result.subQueries[2].dependencies).toContain(0);
    expect(result.synthesisPrompt).toContain('Summarize');
  });

  it('executes sub-queries respecting dependencies', async () => {
    const retrieve = vi.fn().mockImplementation(async ({ query }: { query: string }) => ({
      references: [
        {
          id: `ref-${query}`,
          content: `Content for ${query}`
        }
      ],
      activity: []
    }));

    const webSearch = vi.fn().mockResolvedValue({ results: [] });

    const { executeSubQueries } = await import('../orchestrator/queryDecomposition.js');
    const results = await executeSubQueries(
      [
        { id: 0, query: 'First', dependencies: [], reasoning: 'Base' },
        { id: 1, query: 'Second', dependencies: [0], reasoning: 'Depends on first' }
      ],
      { retrieve, webSearch }
    );

    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(results.get(1)?.references[0].id).toBe('ref-Second');
  });
});
