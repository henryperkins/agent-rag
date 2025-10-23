import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiKeyOrManagedIdentityHeaders,
  invalidateTokenCache,
  TOKEN_EXPIRY_SLOP_MS
} from '../auth/tokenManager.js';

const CACHE_KEY = 'test-cache-key';

afterEach(() => {
  invalidateTokenCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('apiKeyOrManagedIdentityHeaders', () => {
  it('returns API key headers when key is provided', async () => {
    const headers = await apiKeyOrManagedIdentityHeaders({
      apiKey: 'secret-key',
      refresher: vi.fn(),
      cacheKey: CACHE_KEY
    });

    expect(headers).toEqual({ 'api-key': 'secret-key' });
  });

  it('reuses cached bearer tokens while they are fresh', async () => {
    const refresher = vi.fn().mockResolvedValue({
      token: 'fresh-token',
      expiresOnTimestamp: Date.now() + TOKEN_EXPIRY_SLOP_MS * 5
    });

    const first = await apiKeyOrManagedIdentityHeaders({
      refresher,
      cacheKey: CACHE_KEY
    });
    const second = await apiKeyOrManagedIdentityHeaders({
      refresher,
      cacheKey: CACHE_KEY
    });

    expect(refresher).toHaveBeenCalledTimes(1);
    expect(first.Authorization).toBe('Bearer fresh-token');
    expect(second.Authorization).toBe('Bearer fresh-token');
  });

  it('shares an in-flight refresh across concurrent callers', async () => {
    const resolver: { resolve?: (value: { token: string; expiresOnTimestamp: number }) => void } = {};
    const refresher = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<{ token: string; expiresOnTimestamp: number }>((resolve) => {
            resolver.resolve = resolve;
          })
      );

    const pendingA = apiKeyOrManagedIdentityHeaders({
      refresher,
      cacheKey: CACHE_KEY
    });
    const pendingB = apiKeyOrManagedIdentityHeaders({
      refresher,
      cacheKey: CACHE_KEY
    });

    expect(refresher).toHaveBeenCalledTimes(1);

    resolver.resolve?.({
      token: 'concurrent-token',
      expiresOnTimestamp: Date.now() + TOKEN_EXPIRY_SLOP_MS * 5
    });

    const [headersA, headersB] = await Promise.all([pendingA, pendingB]);
    expect(headersA.Authorization).toBe('Bearer concurrent-token');
    expect(headersB.Authorization).toBe('Bearer concurrent-token');
  });

  it('refreshes when cached token is close to expiring', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const now = Date.now();

    const refresher = vi
      .fn()
      .mockResolvedValueOnce({
        token: 'stale-token',
        expiresOnTimestamp: now + TOKEN_EXPIRY_SLOP_MS - 1_000
      })
      .mockResolvedValueOnce({
        token: 'renewed-token',
        expiresOnTimestamp: now + TOKEN_EXPIRY_SLOP_MS * 5
      });

    const first = await apiKeyOrManagedIdentityHeaders({
      refresher,
      cacheKey: CACHE_KEY
    });
    const second = await apiKeyOrManagedIdentityHeaders({
      refresher,
      cacheKey: CACHE_KEY
    });

    expect(refresher).toHaveBeenCalledTimes(2);
    expect(first.Authorization).toBe('Bearer stale-token');
    expect(second.Authorization).toBe('Bearer renewed-token');
  });
});
