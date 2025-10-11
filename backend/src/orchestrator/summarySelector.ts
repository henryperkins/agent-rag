import { config } from '../config/app.js';
import { createEmbeddings } from '../azure/openaiClient.js';
import type { SummaryBullet } from './memoryStore.js';
import type { SummarySelectionStats } from '../../../shared/types.js';
import { cosineSimilarity } from '../utils/vector-ops.js';

export interface SummarySelection {
  selected: SummaryBullet[];
  candidates: SummaryBullet[];
  stats: SummarySelectionStats;
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

function buildStats(options: {
  mode: 'semantic' | 'recency';
  candidates: SummaryBullet[];
  selected: SummaryBullet[];
  scores?: number[];
  selectedScores?: number[];
  usedFallback: boolean;
  error?: string;
}): SummarySelectionStats {
  const { mode, candidates, selected, scores, selectedScores, usedFallback, error } = options;
  const totalCandidates = candidates.length;
  const discardedCount = Math.max(0, totalCandidates - selected.length);

  const stats: SummarySelectionStats = {
    mode,
    totalCandidates,
    selectedCount: selected.length,
    discardedCount,
    usedFallback
  };

  if (scores && scores.length) {
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const meanScore = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    stats.maxScore = maxScore;
    stats.minScore = minScore;
    stats.meanScore = meanScore;
  }

  if (selectedScores && selectedScores.length) {
    stats.maxSelectedScore = Math.max(...selectedScores);
    stats.minSelectedScore = Math.min(...selectedScores);
  }

  if (error) {
    stats.error = error;
  }

  return stats;
}

export async function selectSummaryBullets(
  query: string,
  candidates: SummaryBullet[],
  maxItems: number,
  options: { semanticEnabled?: boolean } = {}
): Promise<SummarySelection> {
  const normalizedCandidates = dedupeCandidates(candidates);
  const useSemantic = options.semanticEnabled ?? config.ENABLE_SEMANTIC_SUMMARY;

  if (!normalizedCandidates.length || maxItems <= 0) {
    return {
      selected: [],
      candidates: normalizedCandidates,
      stats: buildStats({
        mode: 'recency',
        candidates: normalizedCandidates,
        selected: [],
        usedFallback: true
      })
    };
  }

  if (!useSemantic || !query?.trim()) {
    const fallback = fallbackRecency(normalizedCandidates, maxItems);
    return {
      selected: fallback,
      candidates: normalizedCandidates,
      stats: buildStats({
        mode: 'recency',
        candidates: normalizedCandidates,
        selected: fallback,
        usedFallback: true
      })
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

    const selectedEntries = scored.slice(0, maxItems);
    const selected = selectedEntries.map((item) => ({
      text: item.candidate.text,
      embedding: item.candidate.embedding ? [...item.candidate.embedding] : undefined
    }));

    return {
      selected,
      candidates: normalizedCandidates,
      stats: buildStats({
        mode: 'semantic',
        candidates: normalizedCandidates,
        selected,
        scores: scored.map((item) => item.score),
        selectedScores: selectedEntries.map((item) => item.score),
        usedFallback: false
      })
    };
  } catch (error) {
    console.warn('Semantic summary selection failed; falling back to recency.', error);
    const fallback = fallbackRecency(normalizedCandidates, maxItems);
    return {
      selected: fallback,
      candidates: normalizedCandidates,
      stats: buildStats({
        mode: 'recency',
        candidates: normalizedCandidates,
        selected: fallback,
        usedFallback: true,
        error: (error as Error).message
      })
    };
  }
}
