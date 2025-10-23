import { randomUUID } from 'node:crypto';
import type { WebResult, WebSearchResponse, Reference } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { withRetry } from '../utils/resilience.js';

interface WebSearchArgs {
  query: string;
  count?: number;
  mode?: 'summary' | 'full' | 'hyperbrowser_scrape' | 'hyperbrowser_extract';
  hyperbrowserMode?: 'scrape' | 'extract';
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
  const safeMode = (config as Record<string, unknown>).WEB_SAFE_MODE ?? 'off';
  url.searchParams.set('safe', String(safeMode));
  const defaultRecency = (config as Record<string, unknown>).WEB_DEFAULT_RECENCY;
  if (typeof defaultRecency === 'string' && defaultRecency.length > 0) {
    url.searchParams.set('dateRestrict', defaultRecency);
  }

  const data = await withRetry('google-search', async (signal) => {
    const response = await fetch(url.toString(), {
      method: 'GET',
      signal
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as GoogleSearchResponse;
      const status = response.status;
      const statusText = response.statusText;
      const errorMsg = errorData.error?.message || `${status} ${statusText}`;
      const error = new Error(`Google Search API error ${status}: ${errorMsg}`) as Error & {
        status?: number;
        code?: string;
      };
      if (typeof errorData.error?.code === 'number') {
        error.code = String(errorData.error.code);
      }
      error.status = status;
      throw error;
    }

    return (await response.json()) as GoogleSearchResponse;
  }, { maxRetries: 3, timeoutMs: 10000, retryableErrors: ['429', '503', 'AbortError', 'ECONN'] });

  const fetchedAt = new Date().toISOString();

  const results: WebResult[] =
    data.items?.map((item, index) => ({
      id: buildResultId(item),
      title: item.title,
      snippet: item.snippet ?? '',
      url: item.link,
      body: searchMode === 'full' ? item.snippet ?? '' : undefined,
      rank: index + 1,
      relevance: undefined,
      fetchedAt
    })) ?? [];

  // If Hyperbrowser mode is requested, enhance results
  if (searchMode === 'hyperbrowser_scrape' || searchMode === 'hyperbrowser_extract') {
    return await enhanceWithHyperbrowser(results, query, searchMode);
  }

  return { results };
}

/**
 * Enhances Google search results with Hyperbrowser scraping or extraction
 */
async function enhanceWithHyperbrowser(
  googleResults: WebResult[],
  query: string,
  mode: 'hyperbrowser_scrape' | 'hyperbrowser_extract'
): Promise<WebSearchResponse> {
  let mcp__hyperbrowser__scrape_webpage: any;
  let mcp__hyperbrowser__extract_structured_data: any;

  try {
    // @ts-expect-error MCP tools are optional and may not be available
    const mcpTools = await import('../../../mcp-tools.js');
    mcp__hyperbrowser__scrape_webpage = mcpTools.mcp__hyperbrowser__scrape_webpage;
    mcp__hyperbrowser__extract_structured_data = mcpTools.mcp__hyperbrowser__extract_structured_data;
  } catch {
    // MCP tools not available
  }

  // Check if Hyperbrowser MCP is available
  if (!mcp__hyperbrowser__scrape_webpage && mode === 'hyperbrowser_scrape') {
    console.warn('Hyperbrowser MCP not available, falling back to Google snippets');
    return { results: googleResults };
  }

  if (!mcp__hyperbrowser__extract_structured_data && mode === 'hyperbrowser_extract') {
    console.warn('Hyperbrowser MCP not available, falling back to Google snippets');
    return { results: googleResults };
  }

  try {
    if (mode === 'hyperbrowser_scrape') {
      // Scrape top 3 results for full content
      const scrapedResults = await Promise.all(
        googleResults.slice(0, 3).map(async (result) => {
          try {
            const scraped = await mcp__hyperbrowser__scrape_webpage!({
              url: result.url,
              outputFormat: ['markdown']
            });

            return {
              ...result,
              body: scraped.markdown || result.snippet,
              metadata: scraped.metadata,
              scrapedAt: new Date().toISOString()
            };
          } catch (error) {
            console.warn(
              `Failed to scrape ${result.url}:`,
              error instanceof Error ? error.message : String(error)
            );
            return result; // Fallback to original snippet
          }
        })
      );

      // Keep remaining results as-is
      return {
        results: [...scrapedResults, ...googleResults.slice(3)]
      };
    } else {
      // Extract structured data from top results
      const extractSchema = {
        type: 'object',
        properties: {
          mainContent: { type: 'string', description: 'The main content of the page' },
          keyPoints: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key points or takeaways from the content'
          },
          facts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string' },
                context: { type: 'string' }
              }
            },
            description: 'Factual claims found in the content'
          },
          metadata: {
            type: 'object',
            properties: {
              author: { type: 'string' },
              publishDate: { type: 'string' },
              lastUpdated: { type: 'string' }
            }
          }
        },
        required: ['mainContent']
      };

      const extracted = await mcp__hyperbrowser__extract_structured_data!({
        urls: googleResults.slice(0, 3).map((r) => r.url),
        prompt: `Extract the main content, key points, and factual information related to: ${query}`,
        schema: extractSchema
      });

      // Convert extracted data back to WebResult format
      const enhancedResults = googleResults.slice(0, 3).map((result, index) => ({
        ...result,
        body: extracted[index]?.mainContent || result.snippet,
        keyPoints: extracted[index]?.keyPoints,
        facts: extracted[index]?.facts,
        metadata: extracted[index]?.metadata,
        extractedAt: new Date().toISOString()
      }));

      return {
        results: [...enhancedResults, ...googleResults.slice(3)]
      };
    }
  } catch (error) {
    console.error(
      'Hyperbrowser enhancement failed:',
      error instanceof Error ? error.message : String(error)
    );
    return { results: googleResults }; // Fallback to original results
  }
}

/**
 * Converts Hyperbrowser scraped content to Reference format for RAG pipeline
 */
export function convertWebResultsToReferences(webResults: WebResult[]): Reference[] {
  return webResults.map((result) => ({
    id: result.id,
    title: result.title,
    content: result.body || result.snippet,
    url: result.url,
    score: result.relevance,
    page_number: undefined,
    metadata: {
      source: 'web_search',
      fetchedAt: result.fetchedAt,
      scrapedAt: (result as any).scrapedAt,
      extractedAt: (result as any).extractedAt,
      rank: result.rank
    }
  }));
}
