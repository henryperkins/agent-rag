import type { Reference, WebResult } from '../../../shared/types.js';

export interface RerankedResult {
  id: string;
  title: string;
  content: string;
  url?: string;
  page_number?: number;
  originalScore?: number;
  rrfScore: number;
  source: 'azure' | 'web';
  rank: number;
}

export function reciprocalRankFusion(
  azureResults: Reference[],
  webResults: WebResult[],
  k: number = 60
): RerankedResult[] {
  const scoreMap = new Map<string, RerankedResult & { ranks: number[] }>();

  azureResults.forEach((result, index) => {
    const id = result.id ?? `azure-${index}`;
    const entry = scoreMap.get(id) ?? {
      id,
      title: result.title ?? `Azure Result ${index + 1}`,
      content: result.content ?? result.chunk ?? '',
      url: result.url,
      page_number: result.page_number,
      originalScore: result.score,
      rrfScore: 0,
      source: 'azure' as const,
      rank: 0,
      ranks: []
    };

    entry.ranks.push(index + 1);
    scoreMap.set(id, entry);
  });

  webResults.forEach((result, index) => {
    const id = result.id ?? result.url ?? `web-${index}`;
    const entry = scoreMap.get(id) ?? {
      id,
      title: result.title,
      content: [result.snippet, result.body].filter(Boolean).join('\n'),
      url: result.url,
      page_number: undefined,
      originalScore: undefined,
      rrfScore: 0,
      source: 'web' as const,
      rank: 0,
      ranks: []
    };

    entry.ranks.push(index + 1);
    scoreMap.set(id, entry);
  });

  const reranked = Array.from(scoreMap.values()).map((entry) => {
    const rrfScore = entry.ranks.reduce((sum, rank) => sum + 1 / (k + rank), 0);
    return { ...entry, rrfScore } as RerankedResult & { ranks: number[] };
  });

  reranked.sort((a, b) => b.rrfScore - a.rrfScore);
  reranked.forEach((entry, index) => {
    entry.rank = index + 1;
    delete (entry as any).ranks;
  });

  return reranked as RerankedResult[];
}

export function applySemanticBoost(
  results: RerankedResult[],
  queryEmbedding: number[],
  documentEmbeddings: Map<string, number[]>,
  boostWeight: number = 0.3
): RerankedResult[] {
  const adjusted = results.map((result) => {
    const embedding = documentEmbeddings.get(result.id);
    if (!embedding) {
      return result;
    }

    const similarity = cosineSimilarity(queryEmbedding, embedding);
    return {
      ...result,
      rrfScore: result.rrfScore * (1 - boostWeight) + similarity * boostWeight
    };
  });

  adjusted.sort((a, b) => b.rrfScore - a.rrfScore);
  adjusted.forEach((item, index) => {
    item.rank = index + 1;
  });

  return adjusted;
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
