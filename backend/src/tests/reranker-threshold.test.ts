import { afterEach, describe, expect, it, vi } from 'vitest';
import { enforceRerankerThreshold, resetRerankerThresholdWarnings } from '../utils/reranker-threshold.js';

describe('enforceRerankerThreshold', () => {
  afterEach(() => {
    resetRerankerThresholdWarnings();
    vi.restoreAllMocks();
  });

  it('returns original references when threshold is not positive', () => {
    const references = [{ score: 0.2 }, { score: 0.1 }];
    const result = enforceRerankerThreshold(references, 0, { source: 'test' });
    expect(result.references).toBe(references);
    expect(result.removed).toBe(0);
    expect(result.exhausted).toBe(false);
  });

  it('filters out low-scoring references', () => {
    const references = [{ score: 0.2 }, { score: 0.9 }];
    const result = enforceRerankerThreshold(references, 0.5, { source: 'test-filter' });
    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.score).toBe(0.9);
    expect(result.removed).toBe(1);
    expect(result.exhausted).toBe(false);
  });

  it('fails closed when no references meet the threshold', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const references = [{ score: 0.2 }, { score: 0.3 }];

    const result = enforceRerankerThreshold(references, 0.8, {
      sessionId: 'session-123',
      correlationId: 'corr-456',
      source: 'test-exhausted'
    });

    expect(result.references).toHaveLength(0);
    expect(result.removed).toBe(2);
    expect(result.exhausted).toBe(true);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0]?.[0]).toContain('"event":"reranker.threshold.exhausted"');
  });
});
