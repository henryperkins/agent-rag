import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';

const credential = new DefaultAzureCredential();

interface CachedToken {
  token: string;
  expiresOnTimestamp: number;
}

let cachedSearchToken: CachedToken | null = null;
let tokenRefreshPromise: Promise<CachedToken> | null = null;

function isExpiringSoon(cached: CachedToken): boolean {
  const now = Date.now();
  return cached.expiresOnTimestamp - now <= 120000;
}

async function refreshSearchToken(): Promise<CachedToken> {
  const scope = 'https://search.azure.com/.default';
  const tokenResponse = await credential.getToken(scope);

  if (!tokenResponse?.token) {
    throw new Error('Failed to obtain Azure Search token for managed identity authentication');
  }

  const newToken: CachedToken = {
    token: tokenResponse.token,
    expiresOnTimestamp: tokenResponse.expiresOnTimestamp
  };

  cachedSearchToken = newToken;
  return newToken;
}

export async function getSearchAuthHeaders(): Promise<Record<string, string>> {
  if (config.AZURE_SEARCH_API_KEY) {
    return { 'api-key': config.AZURE_SEARCH_API_KEY };
  }

  // Check if we have a valid cached token
  if (cachedSearchToken && !isExpiringSoon(cachedSearchToken)) {
    return { Authorization: `Bearer ${cachedSearchToken.token}` };
  }

  // If a refresh is already in progress, wait for it
  if (tokenRefreshPromise) {
    const token = await tokenRefreshPromise;
    return { Authorization: `Bearer ${token.token}` };
  }

  // Start a new refresh and cache the promise
  tokenRefreshPromise = refreshSearchToken().finally(() => {
    tokenRefreshPromise = null;
  });

  const token = await tokenRefreshPromise;
  return { Authorization: `Bearer ${token.token}` };
}

export async function getSearchJsonHeaders(): Promise<Record<string, string>> {
  const authHeaders = await getSearchAuthHeaders();
  return {
    'Content-Type': 'application/json',
    ...authHeaders
  };
}
