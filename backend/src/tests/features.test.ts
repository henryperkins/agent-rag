import { describe, expect, it } from 'vitest';
import { config } from '../config/app.js';
import { resolveFeatureToggles, sanitizeFeatureOverrides } from '../config/features.js';

describe('feature toggle resolution', () => {
  it('defaults to config values when no overrides are provided', () => {
    const result = resolveFeatureToggles();

    expect(result.resolved.ENABLE_MULTI_INDEX_FEDERATION).toBe(config.ENABLE_MULTI_INDEX_FEDERATION);
    expect(result.resolved.ENABLE_LAZY_RETRIEVAL).toBe(config.ENABLE_LAZY_RETRIEVAL);
    expect(result.resolved.ENABLE_RESPONSE_STORAGE).toBe(config.ENABLE_RESPONSE_STORAGE);
    expect(result.sources.ENABLE_MULTI_INDEX_FEDERATION).toBe('config');
    expect(result.sources.ENABLE_LAZY_RETRIEVAL).toBe('config');
    expect(result.sources.ENABLE_RESPONSE_STORAGE).toBe('config');
    expect(result.gates.lazyRetrieval).toBe(config.ENABLE_LAZY_RETRIEVAL);
    expect(result.gates.multiIndexFederation).toBe(config.ENABLE_MULTI_INDEX_FEDERATION);
  });

  it('prefers overrides over persisted values and persisted over defaults', () => {
    const persisted = {
      ENABLE_MULTI_INDEX_FEDERATION: true,
      ENABLE_SEMANTIC_MEMORY: true
    } as const;
    const overrides = {
      ENABLE_MULTI_INDEX_FEDERATION: false,
      ENABLE_LAZY_RETRIEVAL: true
    } as const;

    const result = resolveFeatureToggles({
      persisted,
      overrides
    });

    expect(result.resolved.ENABLE_LAZY_RETRIEVAL).toBe(true);
    expect(result.sources.ENABLE_LAZY_RETRIEVAL).toBe('override');
    expect(result.gates.lazyRetrieval).toBe(true);

    expect(result.resolved.ENABLE_MULTI_INDEX_FEDERATION).toBe(false);
    expect(result.sources.ENABLE_MULTI_INDEX_FEDERATION).toBe('override');

    expect(result.resolved.ENABLE_SEMANTIC_MEMORY).toBe(true);
    expect(result.sources.ENABLE_SEMANTIC_MEMORY).toBe('persisted');
    expect(result.gates.semanticMemory).toBe(true);
  });

  it('sanitizes invalid override payloads', () => {
    const payload = sanitizeFeatureOverrides({
      ENABLE_LAZY_RETRIEVAL: true,
      ENABLE_SEMANTIC_MEMORY: 'yes' as unknown as boolean,
      UNKNOWN_FLAG: true
    } as any);

    expect(payload).toEqual({
      ENABLE_LAZY_RETRIEVAL: true
    });
  });
});
