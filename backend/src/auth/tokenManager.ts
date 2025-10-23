export interface ManagedIdentityToken {
  token: string;
  expiresOnTimestamp: number;
}

export type TokenRefresher = () => Promise<ManagedIdentityToken>;

interface TokenCacheEntry {
  token: ManagedIdentityToken | null;
  refreshPromise: Promise<ManagedIdentityToken> | null;
}

const cache = new Map<string, TokenCacheEntry>();

export const TOKEN_EXPIRY_SLOP_MS = 120_000;

function getCacheEntry(cacheKey: string): TokenCacheEntry {
  const existing = cache.get(cacheKey);
  if (existing) {
    return existing;
  }
  const created: TokenCacheEntry = {
    token: null,
    refreshPromise: null,
  };
  cache.set(cacheKey, created);
  return created;
}

function isExpiringSoon(token: ManagedIdentityToken, expirySkewMs: number): boolean {
  return token.expiresOnTimestamp - Date.now() <= expirySkewMs;
}

export interface ApiKeyOrManagedIdentityOptions {
  apiKey?: string;
  apiKeyHeaderName?: string;
  refresher: TokenRefresher;
  cacheKey: string;
  expirySkewMs?: number;
}

export async function apiKeyOrManagedIdentityHeaders({
  apiKey,
  apiKeyHeaderName = 'api-key',
  refresher,
  cacheKey,
  expirySkewMs = TOKEN_EXPIRY_SLOP_MS,
}: ApiKeyOrManagedIdentityOptions): Promise<Record<string, string>> {
  if (apiKey) {
    return { [apiKeyHeaderName]: apiKey };
  }

  const entry = getCacheEntry(cacheKey);
  if (entry.token && !isExpiringSoon(entry.token, expirySkewMs)) {
    return { Authorization: `Bearer ${entry.token.token}` };
  }

  if (!entry.refreshPromise) {
    entry.refreshPromise = refresher()
      .then((newToken) => {
        entry.token = newToken;
        return newToken;
      })
      .finally(() => {
        entry.refreshPromise = null;
      });
  }

  const token = await entry.refreshPromise;
  return { Authorization: `Bearer ${token.token}` };
}

export function invalidateTokenCache(cacheKey?: string): void {
  if (!cacheKey) {
    cache.clear();
    return;
  }
  cache.delete(cacheKey);
}
