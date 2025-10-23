import { describe, expect, it } from 'vitest';
import { dedupeSummaryBullets } from '../orchestrator/summaries/dedupe.js';

describe('dedupeSummaryBullets', () => {
  it('trims and removes duplicate summary bullets', () => {
    const result = dedupeSummaryBullets([
      { text: 'Alpha ', embedding: [0.1, 0.2] },
      { text: 'Alpha', embedding: [0.3, 0.4] },
      { text: 'Beta', embedding: undefined },
      { text: '  ', embedding: [0.5] }
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Alpha');
    expect(result[1].text).toBe('Beta');
  });

  it('returns cloned embedding arrays', () => {
    const original = { text: 'Gamma', embedding: [1, 2, 3] as number[] };
    const result = dedupeSummaryBullets([original]);

    expect(result).toHaveLength(1);
    expect(result[0].embedding).toEqual([1, 2, 3]);
    expect(result[0].embedding).not.toBe(original.embedding);

    original.embedding?.push(4);
    expect(result[0].embedding).toEqual([1, 2, 3]);
  });
});
