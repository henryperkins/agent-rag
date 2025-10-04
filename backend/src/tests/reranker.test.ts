import { describe, expect, it } from 'vitest';
import { reciprocalRankFusion, applySemanticBoost } from '../orchestrator/reranker.js';

const references = [
  { id: 'doc-1', title: 'Doc 1', content: 'Azure AI Search overview', score: 0.9 },
  { id: 'doc-2', title: 'Doc 2', content: 'Elasticsearch pricing tiers', score: 0.8 }
];

const webResults = [
  {
    id: 'web-1',
    title: 'Azure AI Search blog',
    snippet: 'Latest news about Azure AI Search',
    url: 'https://example.com/azure',
    rank: 1,
    fetchedAt: new Date().toISOString()
  },
  {
    id: 'doc-1',
    title: 'External doc',
    snippet: 'Duplicate of doc-1 on the web',
    url: 'https://example.com/doc-1',
    rank: 2,
    fetchedAt: new Date().toISOString()
  }
];

describe('reranker', () => {
  it('applies reciprocal rank fusion across sources', () => {
    const reranked = reciprocalRankFusion(references as any, webResults as any, 60);
    expect(reranked[0].id).toBe('doc-1');
    expect(reranked[0].source).toBe('azure');
    expect(reranked[0].rrfScore).toBeGreaterThan(0);
    expect(reranked[0].rank).toBe(1);
  });

  it('boosts semantic similarity when embeddings available', () => {
    const base = reciprocalRankFusion(references as any, webResults as any, 60);
    const docEmbeddings = new Map<string, number[]>([
      ['doc-1', [1, 0, 0]],
      ['doc-2', [0, 1, 0]]
    ]);
    const boosted = applySemanticBoost(base, [1, 0, 0], docEmbeddings, 0.5);
    expect(boosted[0].id).toBe('doc-1');
    expect(boosted[0].rrfScore).toBeGreaterThan(boosted[1].rrfScore);
  });
});
