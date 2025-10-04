import { randomUUID } from 'node:crypto';
import type { WebResult, WebSearchResponse } from '../../../shared/types.js';
import { config } from '../config/app.js';

interface WebSearchArgs {
  query: string;
  count?: number;
  mode?: 'summary' | 'full';
}

function buildResultId(item: any) {
  if (typeof item.cacheId === 'string' && item.cacheId.length) {
    return `google_${item.cacheId}`;
  }
  if (typeof item.link === 'string' && item.link.length) {
    return `web_${Buffer.from(item.link).toString('base64url')}`;
  }
  return randomUUID();
}

interface GoogleSearchResponse {
  kind: string;
  items?: Array<{
    kind: string;
    title: string;
    htmlTitle: string;
    link: string;
    displayLink: string;
    snippet: string;
    htmlSnippet: string;
    cacheId?: string;
    formattedUrl: string;
    htmlFormattedUrl: string;
    pagemap?: Record<string, any>;
  }>;
  searchInformation?: {
    searchTime: number;
    formattedSearchTime: string;
    totalResults: string;
    formattedTotalResults: string;
  };
  error?: {
    code: number;
    message: string;
    errors: Array<{ domain: string; reason: string; message: string }>;
  };
}

export async function webSearchTool(args: WebSearchArgs): Promise<WebSearchResponse> {
  const { query, count, mode } = args;

  if (!config.GOOGLE_SEARCH_API_KEY) {
    throw new Error('Google Search API key not configured. Set GOOGLE_SEARCH_API_KEY.');
  }

  if (!config.GOOGLE_SEARCH_ENGINE_ID) {
    throw new Error('Google Search Engine ID not configured. Set GOOGLE_SEARCH_ENGINE_ID.');
  }

  const effectiveCount = Math.min(count ?? config.WEB_RESULTS_MAX, config.WEB_RESULTS_MAX);
  const searchMode = mode ?? config.WEB_SEARCH_MODE;

  const url = new URL(config.GOOGLE_SEARCH_ENDPOINT);
  url.searchParams.set('key', config.GOOGLE_SEARCH_API_KEY);
  url.searchParams.set('cx', config.GOOGLE_SEARCH_ENGINE_ID);
  url.searchParams.set('q', query);
  url.searchParams.set('num', Math.min(effectiveCount, 10).toString()); // Google max is 10 per request
  url.searchParams.set('safe', 'off');

  // Date restriction: last week
  url.searchParams.set('dateRestrict', 'd7');

  let retries = 0;
  const maxRetries = 3;

  while (retries <= maxRetries) {
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(10000)
      });

      if (response.status === 429 && retries < maxRetries) {
        retries++;
        const wait = Math.min(1000 * Math.pow(2, retries), 8000);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as GoogleSearchResponse;
        const errorMsg = errorData.error?.message || `${response.status} ${response.statusText}`;
        throw new Error(`Google Search API error: ${errorMsg}`);
      }

      const data = (await response.json()) as GoogleSearchResponse;
      const fetchedAt = new Date().toISOString();

      const results: WebResult[] =
        data.items?.map((item, index) => ({
          id: buildResultId(item),
          title: item.title,
          snippet: item.snippet ?? '',
          url: item.link,
          body: searchMode === 'full' ? item.snippet ?? '' : undefined,
          rank: index + 1,
          relevance: undefined, // Google doesn't provide explicit relevance scores in this API
          fetchedAt
        })) ?? [];

      return { results };
    } catch (error: any) {
      if (retries < maxRetries && (error.name === 'AbortError' || error.message.includes('ECONN'))) {
        retries++;
        const wait = Math.min(1000 * Math.pow(2, retries), 8000);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      throw error;
    }
  }

  return { results: [] };
}
