import { randomUUID } from 'node:crypto';
import type {
  WebResult,
  WebSearchResponse,
  Reference,
  HyperbrowserLink
} from '../../../shared/types.js';
import { config } from '../config/app.js';
import { withRetry } from '../utils/resilience.js';

type HyperbrowserFormat = 'markdown' | 'html' | 'links' | 'screenshot' | 'text';

interface HyperbrowserScrapeOptions {
  outputFormats?: HyperbrowserFormat[];
  sessionOptions?: Record<string, unknown>;
  enhanceCount?: number;
}

interface HyperbrowserExtractOptions {
  schema?: Record<string, any>;
  prompt?: string;
  sessionOptions?: Record<string, unknown>;
  enhanceCount?: number;
}

interface HyperbrowserOptions {
  scrape?: HyperbrowserScrapeOptions;
  extract?: HyperbrowserExtractOptions;
}

interface WebSearchArgs {
  query: string;
  count?: number;
  mode?: 'summary' | 'full' | 'hyperbrowser_scrape' | 'hyperbrowser_extract';
  hyperbrowser?: HyperbrowserOptions;
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

const SUPPORTED_HYPERBROWSER_FORMATS: ReadonlySet<HyperbrowserFormat> = new Set([
  'markdown',
  'html',
  'links',
  'screenshot',
  'text'
]) as ReadonlySet<HyperbrowserFormat>;

function parseHyperbrowserFormats(raw: unknown): HyperbrowserFormat[] {
  if (typeof raw !== 'string') {
    return ['markdown', 'links'];
  }

  const parsed = raw
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => SUPPORTED_HYPERBROWSER_FORMATS.has(token as HyperbrowserFormat)) as HyperbrowserFormat[];

  if (parsed.length === 0) {
    return ['markdown', 'links'];
  }

  // Preserve order but dedupe
  const seen = new Set<HyperbrowserFormat>();
  const unique: HyperbrowserFormat[] = [];
  for (const item of parsed) {
    if (!seen.has(item)) {
      seen.add(item);
      unique.push(item);
    }
  }

  return unique;
}

function normalizeHyperbrowserLinks(input: unknown): HyperbrowserLink[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const normalized: HyperbrowserLink[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const url = Reflect.get(entry, 'url');
    if (typeof url !== 'string' || !url.trim()) {
      continue;
    }

    const textCandidate = [Reflect.get(entry, 'text'), Reflect.get(entry, 'title'), Reflect.get(entry, 'label')]
      .map((candidate) => (typeof candidate === 'string' ? candidate.trim() : ''))
      .find((candidate) => candidate.length > 0);

    normalized.push({
      url,
      text: textCandidate && textCandidate.length ? textCandidate : undefined
    });
  }

  return normalized.length ? normalized : undefined;
}

function mergeHyperbrowserMetadata(
  original: WebResult,
  hyperMetadata?: Record<string, unknown>
): Record<string, unknown> | null {
  const base: Record<string, unknown> =
    original.metadata && typeof original.metadata === 'object' && original.metadata !== null
      ? { ...original.metadata }
      : {};

  if (hyperMetadata && Object.keys(hyperMetadata).length > 0) {
    const existingHyper =
      base.hyperbrowser && typeof base.hyperbrowser === 'object' && base.hyperbrowser !== null
        ? (base.hyperbrowser as Record<string, unknown>)
        : {};
    base.hyperbrowser = {
      ...existingHyper,
      ...hyperMetadata
    };
  }

  return Object.keys(base).length ? base : null;
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
  const { query, count, mode, hyperbrowser } = args;

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
    return await enhanceWithHyperbrowser(results, query, searchMode, hyperbrowser);
  }

  return { results };
}

/**
 * Enhances Google search results with Hyperbrowser scraping or extraction
 */
async function enhanceWithHyperbrowser(
  googleResults: WebResult[],
  query: string,
  mode: 'hyperbrowser_scrape' | 'hyperbrowser_extract',
  options?: HyperbrowserOptions
): Promise<WebSearchResponse> {
  let mcp__hyperbrowser__scrape_webpage: any;
  let mcp__hyperbrowser__extract_structured_data: any;
  let mergeSessionOptionsFn: ((overrides?: Record<string, unknown>) => Record<string, unknown>) | undefined;

  try {
    // @ts-expect-error MCP tools are optional and may not be available
    const mcpTools = await import('../../../mcp-tools.js');
    mcp__hyperbrowser__scrape_webpage = mcpTools.mcp__hyperbrowser__scrape_webpage;
    mcp__hyperbrowser__extract_structured_data = mcpTools.mcp__hyperbrowser__extract_structured_data;
    mergeSessionOptionsFn = mcpTools.mergeSessionOptions ?? mcpTools.normalizeSessionOptions;
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
      const scrapeOptions = options?.scrape ?? {};
      const requestedFormatsRaw = Array.isArray(scrapeOptions.outputFormats) && scrapeOptions.outputFormats.length
        ? Array.from(
            new Set(
              scrapeOptions.outputFormats
                .map((format) => (typeof format === 'string' ? format.toLowerCase().trim() : ''))
                .filter((format) => SUPPORTED_HYPERBROWSER_FORMATS.has(format as HyperbrowserFormat))
            )
          ) as HyperbrowserFormat[]
        : parseHyperbrowserFormats(config.HYPERBROWSER_SCRAPE_FORMATS);

      const requestedFormats = requestedFormatsRaw.slice();
      const includesTextualFormat = requestedFormats.some((format) =>
        format === 'markdown' || format === 'html' || format === 'text'
      );
      if (!includesTextualFormat) {
        requestedFormats.unshift('markdown');
      }

      const sessionOverrides =
        scrapeOptions.sessionOptions && typeof scrapeOptions.sessionOptions === 'object'
          ? scrapeOptions.sessionOptions
          : undefined;
      const sessionOptions = mergeSessionOptionsFn
        ? mergeSessionOptionsFn(sessionOverrides ?? {})
        : sessionOverrides;
      const enhanceCount = Math.min(scrapeOptions.enhanceCount ?? 3, googleResults.length);
      const sliceCount = Math.max(0, enhanceCount);

      if (sliceCount === 0) {
        return { results: googleResults };
      }

      const scrapedResults = await Promise.all(
        googleResults.slice(0, sliceCount).map(async (result) => {
          try {
            const scraped = await mcp__hyperbrowser__scrape_webpage!({
              url: result.url,
              outputFormat: requestedFormats,
              sessionOptions
            });

            const markdown =
              typeof scraped.markdown === 'string' && scraped.markdown.trim().length ? scraped.markdown : undefined;
            const text = typeof scraped.text === 'string' && scraped.text.trim().length ? scraped.text : undefined;
            const html = typeof scraped.html === 'string' && scraped.html.trim().length ? scraped.html : undefined;
            const links = normalizeHyperbrowserLinks(scraped.links);
            const screenshot =
              typeof scraped.screenshot === 'string' && scraped.screenshot.trim().length
                ? scraped.screenshot
                : undefined;
            const scrapedMetadata =
              scraped.metadata && typeof scraped.metadata === 'object' ? (scraped.metadata as Record<string, unknown>) : undefined;
            const candidateScrapedAt = scrapedMetadata?.['scrapedAt'];
            const resolvedScrapedAt =
              typeof candidateScrapedAt === 'string' && candidateScrapedAt.length ? candidateScrapedAt : undefined;

            const hyperMetadata: Record<string, unknown> = {
              ...(scrapedMetadata ?? {}),
              formats: requestedFormats
            };

            if (sessionOptions && Object.keys(sessionOptions).length) {
              hyperMetadata.sessionOptions = sessionOptions;
            }

            const metadata = mergeHyperbrowserMetadata(result, hyperMetadata);

            return {
              ...result,
              body: markdown ?? text ?? html ?? result.body ?? result.snippet,
              html: html ?? result.html,
              links: links ?? result.links,
              screenshot: screenshot ?? result.screenshot,
              metadata,
              scrapedAt: resolvedScrapedAt ?? result.scrapedAt ?? new Date().toISOString()
            } satisfies WebResult;
          } catch (error) {
            console.warn(
              `Failed to scrape ${result.url}:`,
              error instanceof Error ? error.message : String(error)
            );
            return result; // Fallback to original snippet
          }
        })
      );

      return {
        results: [...scrapedResults, ...googleResults.slice(sliceCount)]
      };
    }

    const extractOptions = options?.extract ?? {};
    const enhanceCount = Math.min(extractOptions.enhanceCount ?? 3, googleResults.length);
    const sliceCount = Math.max(0, enhanceCount);

    if (sliceCount === 0) {
      return { results: googleResults };
    }

    const extractSchema =
      extractOptions.schema ?? {
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

    const extractPrompt =
      extractOptions.prompt ?? `Extract the main content, key points, and factual information related to: ${query}`;

    const extracted = await mcp__hyperbrowser__extract_structured_data!({
      urls: googleResults.slice(0, sliceCount).map((r) => r.url),
      prompt: extractPrompt,
      schema: extractSchema,
      sessionOptions: mergeSessionOptionsFn
        ? mergeSessionOptionsFn(extractOptions.sessionOptions ?? {})
        : extractOptions.sessionOptions
    });

    const enhancedResults = googleResults.slice(0, sliceCount).map((result, index) => {
      const payload = extracted?.[index] ?? {};
      const mainContent = typeof payload?.mainContent === 'string' ? payload.mainContent : undefined;
      const keyPoints = Array.isArray(payload?.keyPoints) ? payload.keyPoints : undefined;
      const facts = Array.isArray(payload?.facts) ? payload.facts : undefined;
      const metadataFromPayload =
        payload && typeof payload.metadata === 'object' && payload.metadata !== null
          ? (payload.metadata as Record<string, unknown>)
          : undefined;

      const hyperMetadata: Record<string, unknown> = {
        ...(metadataFromPayload ?? {}),
        prompt: extractPrompt,
        schema: extractOptions.schema ?? extractSchema,
        enhanceCount: sliceCount
      };

      if (mergeSessionOptionsFn) {
        const mergedSession = mergeSessionOptionsFn(extractOptions.sessionOptions ?? {});
        if (Object.keys(mergedSession).length) {
          hyperMetadata.sessionOptions = mergedSession;
        }
      } else if (extractOptions.sessionOptions && Object.keys(extractOptions.sessionOptions).length) {
        hyperMetadata.sessionOptions = extractOptions.sessionOptions;
      }

      const metadata = mergeHyperbrowserMetadata(result, hyperMetadata);

      return {
        ...result,
        body: mainContent ?? result.body ?? result.snippet,
        keyPoints,
        facts,
        metadata,
        extractedAt: new Date().toISOString()
      } satisfies WebResult;
    });

    return {
      results: [...enhancedResults, ...googleResults.slice(sliceCount)]
    };
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
  return webResults.map((result) => {
    const metadata: Record<string, unknown> = {
      source: 'web_search',
      fetchedAt: result.fetchedAt,
      scrapedAt: result.scrapedAt,
      extractedAt: result.extractedAt,
      rank: result.rank
    };

    if (result.metadata && typeof result.metadata === 'object') {
      const meta = result.metadata as Record<string, unknown>;
      const hyperbrowserMeta =
        meta.hyperbrowser && typeof meta.hyperbrowser === 'object' ? (meta.hyperbrowser as Record<string, unknown>) : null;

      if (hyperbrowserMeta) {
        metadata.hyperbrowser = hyperbrowserMeta;
        const { hyperbrowser: _hyperbrowser, ...rest } = meta;
        for (const [key, value] of Object.entries(rest)) {
          if (value !== undefined && value !== null) {
            metadata[key] = value;
          }
        }
      } else {
        metadata.hyperbrowser = meta;
      }
    }

    if (Array.isArray(result.links) && result.links.length) {
      metadata.links = result.links;
    }

    if (typeof result.html === 'string' && result.html.length) {
      metadata.html = result.html;
    }

    if (typeof result.screenshot === 'string' && result.screenshot.length) {
      metadata.screenshot = result.screenshot;
    }

    if (Array.isArray(result.keyPoints) && result.keyPoints.length) {
      metadata.keyPoints = result.keyPoints;
    }

    if (Array.isArray(result.facts) && result.facts.length) {
      metadata.facts = result.facts;
    }

    const sanitizedMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null)
    );

    return {
      id: result.id,
      title: result.title,
      content: result.body || result.html || result.snippet,
      url: result.url,
      score: result.relevance,
      page_number: undefined,
      metadata: sanitizedMetadata
    };
  });
}
