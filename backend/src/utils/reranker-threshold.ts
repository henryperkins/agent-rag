import { trace } from '@opentelemetry/api';

interface RerankerContext {
  sessionId?: string;
  correlationId?: string;
  source?: string;
}

const warningCache = new Set<string>();

function contextKey(context: RerankerContext): string {
  return context.sessionId ?? context.correlationId ?? 'default';
}

export function enforceRerankerThreshold<T extends { score?: number | null }>(
  references: T[],
  threshold: number | undefined,
  context: RerankerContext = {}
): { references: T[]; removed: number; exhausted: boolean } {
  if (threshold === undefined || threshold === null || Number.isNaN(threshold) || threshold <= 0) {
    return { references, removed: 0, exhausted: false };
  }

  if (!Array.isArray(references) || references.length === 0) {
    return { references: [], removed: 0, exhausted: false };
  }

  const filtered = references.filter((ref) => {
    const score = typeof ref.score === 'number' ? ref.score : 0;
    return score >= threshold;
  });

  if (filtered.length === 0) {
    const scores = references.map((ref) => (typeof ref.score === 'number' ? ref.score : 0));
    const maxScore = Math.max(...scores);
    const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    const cacheKey = contextKey(context);
    const eventAttributes: Record<string, string | number> = {
      threshold,
      count: references.length
    };
    if (Number.isFinite(maxScore)) {
      eventAttributes.maxScore = Number(maxScore.toFixed(3));
    }
    if (Number.isFinite(average)) {
      eventAttributes.avgScore = Number(average.toFixed(3));
    }
    if (context.sessionId) {
      eventAttributes.sessionId = context.sessionId;
    }
    if (context.correlationId) {
      eventAttributes.correlationId = context.correlationId;
    }
    if (context.source) {
      eventAttributes.source = context.source;
    }

    trace.getActiveSpan()?.addEvent('reranker.threshold.exhausted', eventAttributes);

    if (!warningCache.has(cacheKey)) {
      warningCache.add(cacheKey);
      console.error(
        JSON.stringify({
          event: 'reranker.threshold.exhausted',
          threshold,
          maxScore: Number.isFinite(maxScore) ? Number(maxScore.toFixed(3)) : undefined,
          avgScore: Number.isFinite(average) ? Number(average.toFixed(3)) : undefined,
          count: references.length,
          sessionId: context.sessionId,
          correlationId: context.correlationId,
          source: context.source
        })
      );
    }
    return { references: [], removed: references.length, exhausted: true };
  }

  if (filtered.length < references.length) {
    console.info(
      JSON.stringify({
        event: 'reranker.threshold.filtered',
        threshold,
        removed: references.length - filtered.length,
        remaining: filtered.length,
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        source: context.source
      })
    );
  }

  return { references: filtered, removed: references.length - filtered.length, exhausted: false };
}

export function resetRerankerThresholdWarnings() {
  warningCache.clear();
}
