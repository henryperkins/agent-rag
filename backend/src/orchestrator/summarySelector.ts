import { config } from '../config/app.js';
import { createEmbeddings } from '../azure/openaiClient.js';
import type { SummaryBullet } from './memoryStore.js';

export interface SummarySelection {
  selected: SummaryBullet[];
  candidates: SummaryBullet[];
}

function cosineSimilarity(vectorA: number[], vectorB: number[]) {
  if (!vectorA.length || !vectorB.length || vectorA.length !== vectorB.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vectorA.length; i += 1) {
    const a = vectorA[i];
    const b = vectorB[i];
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (!normA || !normB) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function fallbackRecency(candidates: SummaryBullet[], maxItems: number): SummaryBullet[] {
  if (maxItems <= 0) {
    return [];
  }
  return candidates.slice(-maxItems).map((entry) => ({
    text: entry.text,
    embedding: entry.embedding ? [...entry.embedding] : undefined
  }));
}

function dedupeCandidates(candidates: SummaryBullet[]): SummaryBullet[] {
  const deduped: SummaryBullet[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const text = candidate.text?.trim();
    if (!text) {
      continue;
    }
    if (seen.has(text)) {
      continue;
    }
    seen.add(text);
    deduped.push({ text, embedding: candidate.embedding ? [...candidate.embedding] : undefined });
  }
  return deduped;
}

export async function selectSummaryBullets(
  query: string,
  candidates: SummaryBullet[],
  maxItems: number
): Promise<SummarySelection> {
  const normalizedCandidates = dedupeCandidates(candidates);

  if (!normalizedCandidates.length || maxItems <= 0) {
    return { selected: [], candidates: normalizedCandidates };
  }

  if (!config.ENABLE_SEMANTIC_SUMMARY || !query?.trim()) {
    return {
      selected: fallbackRecency(normalizedCandidates, maxItems),
      candidates: normalizedCandidates
    };
  }

  try {
    const missingEmbeddings = normalizedCandidates.filter(
      (candidate) => !candidate.embedding || !candidate.embedding.length
    );

    if (missingEmbeddings.length) {
      const embeddingResponse = await createEmbeddings(missingEmbeddings.map((candidate) => candidate.text));
      missingEmbeddings.forEach((candidate, index) => {
        candidate.embedding = embeddingResponse.data[index]?.embedding
          ? [...embeddingResponse.data[index].embedding]
          : undefined;
      });
    }

    const queryEmbeddingResponse = await createEmbeddings([query]);
    const queryEmbedding = queryEmbeddingResponse.data[0]?.embedding ?? [];

    const scored = normalizedCandidates.map((candidate, index) => ({
      candidate,
      index,
      score: cosineSimilarity(queryEmbedding, candidate.embedding ?? [])
    }));

    scored.sort((a, b) => {
      if (b.score === a.score) {
        return a.index - b.index;
      }
      return b.score - a.score;
    });

    const selected = scored.slice(0, maxItems).map((item) => ({
      text: item.candidate.text,
      embedding: item.candidate.embedding ? [...item.candidate.embedding] : undefined
    }));

    return {
      selected,
      candidates: normalizedCandidates
    };
  } catch (error) {
    console.warn('Semantic summary selection failed; falling back to recency.', error);
    return {
      selected: fallbackRecency(normalizedCandidates, maxItems),
      candidates: normalizedCandidates
    };
  }
}
