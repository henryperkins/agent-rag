import { semanticMemoryStore } from './semanticMemoryStore.js';
import { config } from '../config/app.js';
import type { Reference } from '../../../shared/types.js';

function extractCitationIds(answer: string): number[] {
  const pattern = /\[(\d+)\]/g;
  const matches = [...answer.matchAll(pattern)];
  const ids = matches.map((m) => parseInt(m[1], 10));
  return [...new Set(ids)];
}

export async function trackCitationUsage(
  answer: string,
  references: Reference[],
  query: string,
  sessionId: string
): Promise<void> {
  const citedIds = extractCitationIds(answer);

  references.forEach((ref, idx) => {
    (ref as any).wasActuallyCited = citedIds.includes(idx + 1);
    (ref as any).citationDensity = citedIds.filter((id) => id === idx + 1).length / (citedIds.length || 1);
  });

  const usedRefs = references.filter((r) => (r as any).wasActuallyCited);
  const unusedRefs = references.filter((r) => !(r as any).wasActuallyCited);

  console.log(`Citation usage: ${usedRefs.length}/${references.length} references cited`);

  if (usedRefs.length && config.ENABLE_SEMANTIC_MEMORY) {
    const chunkIds = usedRefs.map((r) => r.id ?? 'unknown').join(', ');
    const avgScore = usedRefs.reduce((sum, r) => sum + (r.score ?? 0), 0) / usedRefs.length;

    await semanticMemoryStore.addMemory(
      `Query "${query}" successfully answered using chunks: ${chunkIds}`,
      'procedural',
      {
        citationRate: usedRefs.length / references.length,
        avgRerankerScore: avgScore,
        totalCitations: citedIds.length
      },
      { sessionId }
    );

    if (unusedRefs.length >= references.length / 2) {
      await semanticMemoryStore.addMemory(
        `Query "${query}" had low citation rate (${usedRefs.length}/${references.length}). Consider query reformulation.`,
        'episodic',
        { citationRate: usedRefs.length / references.length },
        { sessionId }
      );
    }
  }
}

export async function recallSimilarSuccessfulQueries(
  query: string,
  k = 2
): Promise<Array<{ query: string; metadata: any }>> {
  if (!config.ENABLE_SEMANTIC_MEMORY) return [];

  const memories = await semanticMemoryStore.recallMemories(query, {
    k,
    type: 'procedural',
    minSimilarity: 0.7
  });

  return memories.map((m) => ({
    query: m.text,
    metadata: m.metadata
  }));
}
