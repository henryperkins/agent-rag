import { DefaultAzureCredential } from '@azure/identity';
import { config } from '../config/app.js';

const credential = new DefaultAzureCredential();

interface CachedToken {
  token: string;
  expiresOnTimestamp: number;
}

let cachedSearchToken: CachedToken | null = null;

export async function getSearchAuthHeaders(): Promise<Record<string, string>> {
  if (config.AZURE_SEARCH_API_KEY) {
    return { 'api-key': config.AZURE_SEARCH_API_KEY };
  }

  const now = Date.now();
  if (cachedSearchToken && cachedSearchToken.expiresOnTimestamp - now > 120000) {
    return { Authorization: `Bearer ${cachedSearchToken.token}` };
  }

  const scope = 'https://search.azure.com/.default';
  const tokenResponse = await credential.getToken(scope);

  if (!tokenResponse?.token) {
    throw new Error('Failed to obtain Azure Search token for managed identity authentication');
  }

  cachedSearchToken = {
    token: tokenResponse.token,
    expiresOnTimestamp: tokenResponse.expiresOnTimestamp
  };

  return { Authorization: `Bearer ${tokenResponse.token}` };
}

export async function getSearchJsonHeaders(): Promise<Record<string, string>> {
  const authHeaders = await getSearchAuthHeaders();
  return {
    'Content-Type': 'application/json',
    ...authHeaders
  };
}
