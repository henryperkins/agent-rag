import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from '../services/sessionStore.js';
import { FEATURE_FLAG_KEYS, resolveFeatureToggles } from '../config/features.js';

describe('SessionStore feature persistence', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(':memory:');
  });

  it('backfills missing feature flags with config defaults when loading legacy sessions', () => {
    const defaults = resolveFeatureToggles().resolved;
    const updatedAt = new Date().toISOString();
    const fallback = (store as any).fallback;

    if (fallback) {
      fallback.features.set('legacy-session', {
        sessionId: 'legacy-session',
        features: { ENABLE_LAZY_RETRIEVAL: false },
        updatedAt
      });
    } else {
      const db = (store as any).db;
      db.prepare(
        `INSERT INTO session_features (session_id, features, updated_at)
         VALUES (@session_id, @features, @updated_at)`
      ).run({
        session_id: 'legacy-session',
        features: JSON.stringify({ ENABLE_LAZY_RETRIEVAL: false }),
        updated_at: updatedAt
      });
    }

    const snapshot = store.loadFeatures('legacy-session');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.updatedAt).toBe(updatedAt);
    expect(snapshot?.features.ENABLE_LAZY_RETRIEVAL).toBe(false);

    for (const flag of FEATURE_FLAG_KEYS) {
      expect(typeof snapshot?.features[flag]).toBe('boolean');
      if (flag !== 'ENABLE_LAZY_RETRIEVAL') {
        expect(snapshot?.features[flag]).toBe(defaults[flag]);
      }
    }
  });

  it('persists complete flag set even when partial overrides are provided', () => {
    store.saveFeatures('partial-session', { ENABLE_WEB_RERANKING: true });
    const snapshot = store.loadFeatures('partial-session');
    const defaults = resolveFeatureToggles().resolved;

    expect(snapshot).not.toBeNull();
    expect(snapshot?.features.ENABLE_WEB_RERANKING).toBe(true);
    for (const flag of FEATURE_FLAG_KEYS) {
      expect(typeof snapshot?.features[flag]).toBe('boolean');
      if (flag !== 'ENABLE_WEB_RERANKING') {
        expect(snapshot?.features[flag]).toBe(defaults[flag]);
      }
    }
  });
});
