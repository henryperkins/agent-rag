import { generateEmbedding } from '../azure/directSearch.js';
import type { WebResult, Reference } from '../../../shared/types.js';
import { config } from '../config/app.js';

const TRUSTED_DOMAINS: Record<string, number> = {
  '.gov': 1.0,
  '.edu': 0.9,
  '.org': 0.7,
  'github.com': 0.8,
  'stackoverflow.com': 0.75,
  'arxiv.org': 0.95,
  'microsoft.com': 0.85,
  'azure.microsoft.com': 0.9,
  'openai.com': 0.85,
  'wikipedia.org': 0.85,
  'nytimes.com': 0.8,
  'reuters.com': 0.85
};

const SPAM_DOMAINS = new Set(['pinterest.com', 'quora.com', 'answers.com']);

function scoreAuthority(url: string): number {
  try {
    const domain = new URL(url).hostname.toLowerCase();
    if (SPAM_DOMAINS.has(domain)) return 0.1;
    for (const [pattern, score] of Object.entries(TRUSTED_DOMAINS)) {
      if (domain === pattern || domain.endsWith(pattern)) return score;
    }
    return 0.4;
  } catch {
    return 0.3;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magA * magB);
}

interface QualityScore {
  authority: number;
  redundancy: number;
  relevance: number;
  overall: number;
}

export async function filterWebResults(
  results: WebResult[],
  query: string,
  kbResults: Reference[]
): Promise<{
  filtered: WebResult[];
  removed: number;
  scores: Map<string, QualityScore>;
}> {
  const scores = new Map<string, QualityScore>();

  // Cache query embedding (computed once)
  let queryEmbedding: number[] | null = null;
  try {
    queryEmbedding = await generateEmbedding(query);
  } catch {
    // Continue without relevance scoring
  }

  // Cache KB embeddings (computed once per KB doc, max 5)
  const kbEmbeddings = new Map<string, number[]>();
  if (kbResults.length > 0) {
    await Promise.all(
      kbResults.slice(0, 5).map(async (ref) => {
        const content = ref.content?.slice(0, 500) ?? '';
        if (!content) return;
        try {
          const embedding = await generateEmbedding(content);
          kbEmbeddings.set(ref.id ?? '', embedding);
        } catch {
          // Skip this KB doc
        }
      })
    );
  }

  // Score all results with cached embeddings
  const scored = await Promise.all(
    results.map(async (result) => {
      const authority = scoreAuthority(result.url);

      // Compute snippet embedding once per result
      let snippetEmbedding: number[] | null = null;
      try {
        snippetEmbedding = await generateEmbedding(result.snippet);
      } catch {
        // Continue without embedding-based scores
      }

      // Calculate redundancy using cached KB embeddings
      let redundancy = 0;
      if (snippetEmbedding && kbEmbeddings.size > 0) {
        const similarities = Array.from(kbEmbeddings.values()).map((kbEmb) =>
          cosineSimilarity(snippetEmbedding!, kbEmb)
        );
        redundancy = Math.max(...similarities, 0);
      }

      // Calculate relevance using cached query embedding
      let relevance = 0.5;
      if (queryEmbedding && snippetEmbedding) {
        relevance = cosineSimilarity(queryEmbedding, snippetEmbedding);
      }

      const overall = authority * 0.3 + (1 - redundancy) * 0.3 + relevance * 0.4;
      const score: QualityScore = { authority, redundancy, relevance, overall };
      const resultId = result.id ?? result.url;
      scores.set(resultId, score);
      return { result, score };
    })
  );

  const minAuthority = config.WEB_MIN_AUTHORITY ?? 0.3;
  const maxRedundancy = config.WEB_MAX_REDUNDANCY ?? 0.9;
  const minRelevance = config.WEB_MIN_RELEVANCE ?? 0.3;

  const filtered = scored.filter(
    (s) => s.score.authority > minAuthority && s.score.redundancy < maxRedundancy && s.score.relevance > minRelevance
  );

  const sorted = filtered.sort((a, b) => b.score.overall - a.score.overall).map((s) => s.result);

  return {
    filtered: sorted,
    removed: results.length - sorted.length,
    scores
  };
}
