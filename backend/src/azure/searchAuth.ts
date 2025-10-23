import { DefaultAzureCredential } from '@azure/identity';
import {
  type ManagedIdentityToken,
  apiKeyOrManagedIdentityHeaders,
  TOKEN_EXPIRY_SLOP_MS,
} from '../auth/tokenManager.js';
import { config } from '../config/app.js';

const credential = new DefaultAzureCredential();
const SEARCH_SCOPE = 'https://search.azure.com/.default';
const SEARCH_CACHE_KEY = 'azure-search';

async function refreshSearchToken(): Promise<ManagedIdentityToken> {
  const tokenResponse = await credential.getToken(SEARCH_SCOPE);

  if (!tokenResponse?.token) {
    throw new Error('Failed to obtain Azure Search token for managed identity authentication');
  }

  const fallbackExpiry = Date.now() + 15 * 60 * 1000;

  return {
    token: tokenResponse.token,
    expiresOnTimestamp: tokenResponse.expiresOnTimestamp ?? fallbackExpiry,
  };
}

export async function getSearchAuthHeaders(): Promise<Record<string, string>> {
  return apiKeyOrManagedIdentityHeaders({
    apiKey: config.AZURE_SEARCH_API_KEY,
    refresher: refreshSearchToken,
    cacheKey: SEARCH_CACHE_KEY,
    expirySkewMs: TOKEN_EXPIRY_SLOP_MS,
  });
}

export async function getSearchJsonHeaders(): Promise<Record<string, string>> {
  const authHeaders = await getSearchAuthHeaders();
  return {
    'Content-Type': 'application/json',
    ...authHeaders
  };
}
