import { config } from '../config/app.js';

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
  displayUrl?: string;
}

export async function webSearchTool(args: { query: string; count?: number }) {
  const { query, count = 5 } = args;

  if (!config.AZURE_BING_SUBSCRIPTION_KEY) {
    throw new Error('Bing Search API key not configured. Set AZURE_BING_SUBSCRIPTION_KEY.');
  }

  const url = new URL(config.AZURE_BING_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('count', count.toString());
  url.searchParams.set('responseFilter', 'Webpages');

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

      const data = await response.json();
      const results: WebSearchResult[] =
        data.webPages?.value?.map((item: any) => ({
          title: item.name,
          snippet: item.snippet,
          url: item.url,
          displayUrl: item.displayUrl
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
