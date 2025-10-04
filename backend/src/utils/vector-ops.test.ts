import { describe, expect, it } from 'vitest';
import { cosineSimilarity } from './vector-ops.js';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const result = cosineSimilarity([1, 2, 3], [1, 2, 3]);
    expect(result).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    const result = cosineSimilarity([1, 0], [0, 1]);
    expect(result).toBeCloseTo(0);
  });

  it('returns 0 when vector lengths differ', () => {
    const result = cosineSimilarity([1, 2], [1, 2, 3]);
    expect(result).toBe(0);
  });

  it('returns 0 when either vector has zero magnitude', () => {
    const result = cosineSimilarity([0, 0, 0], [1, 2, 3]);
    expect(result).toBe(0);
  });
});
