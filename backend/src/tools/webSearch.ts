import { randomUUID } from 'node:crypto';
import type { WebResult, WebSearchResponse } from '../../../shared/types.js';
import { config } from '../config/app.js';

interface WebSearchArgs {
  query: string;
  count?: number;
  mode?: 'summary' | 'full';
}

function buildResultId(item: any) {
  if (typeof item.id === 'string' && item.id.length) {
    return item.id;
  }
  if (typeof item.url === 'string' && item.url.length) {
    return `web_${Buffer.from(item.url).toString('base64url')}`;
  }
  return randomUUID();
}

interface BingWebResponse {
  webPages?: {
    value?: Array<Record<string, any>>;
  };
}

export async function webSearchTool(args: WebSearchArgs): Promise<WebSearchResponse> {
  const { query, count, mode } = args;

  if (!config.AZURE_BING_SUBSCRIPTION_KEY) {
    throw new Error('Bing Search API key not configured. Set AZURE_BING_SUBSCRIPTION_KEY.');
  }

  const effectiveCount = Math.min(count ?? config.WEB_RESULTS_MAX, config.WEB_RESULTS_MAX);
  const searchMode = mode ?? config.WEB_SEARCH_MODE;

  const url = new URL(config.AZURE_BING_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', effectiveCount.toString());
  url.searchParams.set('responseFilter', 'Webpages');
  url.searchParams.set('safeSearch', 'Off');
  url.searchParams.set('freshness', 'Week');

  if (searchMode === 'full') {
    url.searchParams.set('textFormat', 'Raw');
    url.searchParams.set('textDecorations', 'false');
  }

  let retries = 0;
  const maxRetries = 3;

  while (retries <= maxRetries) {
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'Ocp-Apim-Subscription-Key': config.AZURE_BING_SUBSCRIPTION_KEY
        },
        signal: AbortSignal.timeout(10000)
      });

      if (response.status === 429 && retries < maxRetries) {
        retries++;
        const wait = Math.min(1000 * Math.pow(2, retries), 8000);
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bing API error: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as BingWebResponse;
      const fetchedAt = new Date().toISOString();
      const results: WebResult[] =
        data.webPages?.value?.map((item: any, index: number) => ({
          id: buildResultId(item),
          title: item.name,
          snippet: item.snippet ?? item.description ?? '',
          url: item.url,
          body: searchMode === 'full' ? item.snippet ?? item.description ?? '' : undefined,
          rank: index + 1,
          relevance: item?.rankingProfile || item?.confidence,
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
