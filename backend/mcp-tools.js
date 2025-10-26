/**
 * MCP Tools Bridge for HyperBrowser Integration
 *
 * This module provides MCP-compatible tool functions for HyperBrowser web scraping.
 * It uses the @hyperbrowser/sdk package to interact with HyperBrowser API.
 */

import { Hyperbrowser } from '@hyperbrowser/sdk';
import { config } from 'dotenv';

// Load environment variables
config();

const parseBooleanEnv = (value, defaultValue) => {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = value.toString().trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return defaultValue;
};

const getDefaultSessionOptions = () => ({
  useStealth: parseBooleanEnv(process.env.HYPERBROWSER_USE_STEALTH, true),
  useProxy: parseBooleanEnv(process.env.HYPERBROWSER_USE_PROXY, false),
  solveCaptchas: parseBooleanEnv(process.env.HYPERBROWSER_SOLVE_CAPTCHAS, false),
  acceptCookies: parseBooleanEnv(process.env.HYPERBROWSER_ACCEPT_COOKIES, true)
});

export const mergeSessionOptions = (overrides = {}) => {
  const defaults = getDefaultSessionOptions();
  const merged = {
    ...defaults,
    ...(overrides && typeof overrides === 'object' ? overrides : {})
  };

  if (overrides?.profile) {
    merged.profile = {
      ...(defaults.profile ?? {}),
      ...(typeof overrides.profile === 'object' ? overrides.profile : {})
    };
  }

  // Remove undefined values to keep payload lean
  const removeUndefined = (obj) =>
    Object.fromEntries(
      Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
    );

  if (merged.profile) {
    merged.profile = removeUndefined(merged.profile);
  }

  return removeUndefined(merged);
};

const SUPPORTED_SCRAPE_FORMATS = new Set(['markdown', 'html', 'links', 'screenshot']);

const normalizeOutputFormats = (outputFormat) => {
  const requested = Array.isArray(outputFormat) ? outputFormat : ['markdown'];
  const includeTextAlias = requested.some(
    (format) => typeof format === 'string' && format.toLowerCase() === 'text'
  );

  const normalized = requested
    .map((format) =>
      typeof format === 'string' ? format.trim().toLowerCase() : ''
    )
    .map((format) => (format === 'text' ? 'markdown' : format))
    .filter((format) => SUPPORTED_SCRAPE_FORMATS.has(format));

  if (normalized.length === 0) {
    normalized.push('markdown');
  }

  return {
    formats: Array.from(new Set(normalized)),
    includeTextAlias
  };
};

const BING_SEARCH_SCHEMA = {
  type: 'object',
  properties: {
    allSearchResults: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          snippet: { type: 'string' }
        },
        required: ['title', 'url']
      }
    }
  },
  required: ['allSearchResults']
};

// Initialize HyperBrowser client
const getHyperbrowserClient = () => {
  const apiKey = process.env.HYPERBROWSER_API_KEY;

  if (!apiKey) {
    throw new Error('HYPERBROWSER_API_KEY not configured in environment variables');
  }

  return new Hyperbrowser({ apiKey });
};

/**
 * MCP Tool: Scrape webpage content
 *
 * Scrapes a webpage and returns the content in specified formats (markdown, html, text).
 * Handles JavaScript-heavy sites by rendering them fully.
 *
 * @param {Object} args - Scraping arguments
 * @param {string} args.url - The URL to scrape
 * @param {string[]} args.outputFormat - Desired output formats: ['markdown', 'html', 'links', 'screenshot']
 * @param {Object} args.sessionOptions - Session configuration options
 * @returns {Promise<Object>} Scraped content with metadata
 */
export async function mcp__hyperbrowser__scrape_webpage(args) {
  const {
    url,
    outputFormat = ['markdown'],
    sessionOptions: sessionOverrides = {}
  } = args ?? {};

  if (!url) {
    throw new Error('URL is required for webpage scraping');
  }

  try {
    const client = getHyperbrowserClient();
    const { formats, includeTextAlias } = normalizeOutputFormats(outputFormat);
    const sessionOptions = mergeSessionOptions(sessionOverrides);

    const result = await client.scrape.startAndWait({
      url,
      sessionOptions,
      scrapeOptions: { formats }
    });

    if (result.status === 'failed') {
      throw new Error(`Scraping failed: ${result.error || 'Unknown error'}`);
    }

    if (result.status !== 'completed') {
      throw new Error(`Scraping incomplete: status ${result.status}`);
    }

    const data = result.data ?? {};
    const response = {
      url,
      status: 'success',
      metadata: {
        ...(data.metadata ?? {}),
        scrapedAt: new Date().toISOString()
      }
    };

    if (formats.includes('markdown')) {
      response.markdown = data.markdown || '';
    }

    if (formats.includes('html')) {
      response.html = data.html || '';
    }

    if (formats.includes('links')) {
      response.links = Array.isArray(data.links) ? data.links : [];
    }

    if (formats.includes('screenshot')) {
      response.screenshot = data.screenshot || '';
    }

    if (includeTextAlias) {
      response.text = response.markdown || data.html || '';
    }

    return response;

  } catch (error) {
    console.error('HyperBrowser scraping error:', error);
    throw new Error(`Failed to scrape ${url}: ${error.message}`);
  }
}

/**
 * MCP Tool: Extract structured data from webpages
 *
 * Extracts structured data from one or more URLs using a provided schema.
 * Uses LLM-powered extraction to parse content according to your requirements.
 *
 * @param {Object} args - Extraction arguments
 * @param {string[]} args.urls - Array of URLs to extract from
 * @param {string} args.prompt - Extraction instructions/prompt
 * @param {Object} args.schema - JSON schema defining the structure to extract
 * @returns {Promise<Array>} Array of extracted data objects (one per URL)
 */
export async function mcp__hyperbrowser__extract_structured_data(args) {
  const {
    urls,
    prompt,
    schema,
    sessionOptions: sessionOverrides = {}
  } = args ?? {};

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    throw new Error('At least one URL is required for structured data extraction');
  }

  if (!schema) {
    throw new Error('Schema is required for structured data extraction');
  }

  try {
    const client = getHyperbrowserClient();

    const result = await client.extract.startAndWait({
      urls,
      prompt,
      schema,
      sessionOptions: mergeSessionOptions(sessionOverrides)
    });

    if (result.status === 'failed') {
      throw new Error(`Extraction failed: ${result.error || 'Unknown error'}`);
    }

    if (result.status !== 'completed') {
      throw new Error(`Extraction incomplete: status ${result.status}`);
    }

    const data = result.data;

    if (Array.isArray(data)) {
      return data;
    }

    if (data && typeof data === 'object') {
      if (Array.isArray(data.results)) {
        return data.results;
      }

      if (urls.length === 1) {
        return [data];
      }

      return urls.map((url) => {
        const keyMatch = Object.entries(data).find(([key]) => key === url);
        if (keyMatch) {
          return keyMatch[1];
        }
        return data[url] ?? null;
      });
    }

    return urls.map(() => null);

  } catch (error) {
    console.error('HyperBrowser extraction error:', error);
    throw new Error(`Failed to extract structured data: ${error.message}`);
  }
}

export async function mcp__hyperbrowser__crawl_webpages(args) {
  const {
    url,
    outputFormat = ['markdown'],
    sessionOptions: sessionOverrides = {},
    followLinks = false,
    ignoreSitemap = false,
    maxPages
  } = args ?? {};

  if (!url) {
    throw new Error('URL is required for webpage crawling');
  }

  try {
    const client = getHyperbrowserClient();
    const { formats } = normalizeOutputFormats(outputFormat);
    const sessionOptions = mergeSessionOptions(sessionOverrides);

    const response = await client.crawl.startAndWait(
      {
        url,
        sessionOptions,
        followLinks: followLinks === true,
        ignoreSitemap: ignoreSitemap === true,
        maxPages: typeof maxPages === 'number' ? maxPages : undefined,
        scrapeOptions: { formats }
      },
      true
    );

    if (response.status === 'failed' || response.error) {
      throw new Error(`Crawling failed: ${response.error || 'Unknown error'}`);
    }

    const pages = Array.isArray(response.data)
      ? response.data.map((page) => ({
          url: page.url,
          status: page.status,
          error: page.error ?? null,
          metadata: page.metadata ?? {},
          markdown: page.markdown ?? '',
          html: page.html ?? '',
          links: Array.isArray(page.links) ? page.links : [],
          screenshot: page.screenshot ?? ''
        }))
      : [];

    return {
      jobId: response.jobId,
      status: response.status,
      totalCrawledPages: response.totalCrawledPages,
      totalPageBatches: response.totalPageBatches,
      currentPageBatch: response.currentPageBatch,
      batchSize: response.batchSize,
      pages,
      metadata: {
        formats,
        sessionOptions,
        followLinks: followLinks === true,
        ignoreSitemap: ignoreSitemap === true,
        maxPages: typeof maxPages === 'number' ? maxPages : undefined
      }
    };
  } catch (error) {
    console.error('HyperBrowser crawl error:', error);
    throw new Error(`Failed to crawl ${url}: ${error.message ?? error}`);
  }
}

export async function mcp__hyperbrowser__search_with_bing(args) {
  const {
    query,
    numResults = 10,
    sessionOptions: sessionOverrides = {}
  } = args ?? {};

  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  if (!trimmedQuery) {
    throw new Error('Query is required for Bing search');
  }

  try {
    const client = getHyperbrowserClient();
    const sessionOptions = mergeSessionOptions({
      adblock: true,
      useProxy: false,
      ...(sessionOverrides || {})
    });

    const encodedUrl = `https://www.bing.com/search?q=${encodeURIComponent(trimmedQuery)}`;

    const result = await client.extract.startAndWait({
      urls: [encodedUrl],
      sessionOptions,
      prompt: `Extract the top ${numResults} search results from this page.`,
      schema: BING_SEARCH_SCHEMA
    });

    if (result.status === 'failed' || result.error) {
      throw new Error(`Bing search failed: ${result.error || 'Unknown error'}`);
    }

    const payload = Array.isArray(result.data) ? result.data[0] : result.data;
    const searchResultsRaw = payload?.allSearchResults;

    const results = Array.isArray(searchResultsRaw)
      ? searchResultsRaw
          .slice(0, numResults)
          .map((item) => ({
            title: typeof item?.title === 'string' ? item.title : '',
            url: typeof item?.url === 'string' ? item.url : '',
            snippet: typeof item?.snippet === 'string' ? item.snippet : ''
          }))
          .filter((entry) => entry.title || entry.url || entry.snippet)
      : [];

    return {
      query: trimmedQuery,
      results,
      raw: payload,
      metadata: {
        sessionOptions,
        numResults
      }
    };
  } catch (error) {
    console.error('HyperBrowser Bing search error:', error);
    throw new Error(`Failed to search Bing for "${trimmedQuery}": ${error.message ?? error}`);
  }
}

export async function mcp__hyperbrowser__browser_use_agent(args) {
  const {
    task,
    sessionOptions: sessionOverrides = {},
    maxSteps,
    returnStepInfo = false
  } = args ?? {};

  const trimmedTask = typeof task === 'string' ? task.trim() : '';
  if (!trimmedTask) {
    throw new Error('Task is required for Browser Use agent');
  }

  try {
    const client = getHyperbrowserClient();
    const sessionOptions = mergeSessionOptions(sessionOverrides);

    const response = await client.agents.browserUse.startAndWait({
      task: trimmedTask,
      sessionOptions,
      maxSteps
    });

    if (response.status === 'failed' || response.error) {
      throw new Error(`Browser Use agent failed: ${response.error || 'Unknown error'}`);
    }

    const data = response.data
      ? {
          ...response.data,
          steps: returnStepInfo ? response.data.steps ?? [] : []
        }
      : null;

    return {
      jobId: response.jobId,
      status: response.status,
      liveUrl: response.liveUrl ?? null,
      data,
      metadata: {
        sessionOptions,
        maxSteps,
        returnStepInfo
      }
    };
  } catch (error) {
    console.error('HyperBrowser BrowserUse error:', error);
    throw new Error(`Browser Use agent failed: ${error.message ?? error}`);
  }
}

export async function mcp__hyperbrowser__openai_computer_use_agent(args) {
  const {
    task,
    sessionOptions: sessionOverrides = {},
    maxSteps,
    returnStepInfo = false
  } = args ?? {};

  const trimmedTask = typeof task === 'string' ? task.trim() : '';
  if (!trimmedTask) {
    throw new Error('Task is required for OpenAI computer use agent');
  }

  try {
    const client = getHyperbrowserClient();
    const sessionOptions = mergeSessionOptions(sessionOverrides);

    const response = await client.agents.cua.startAndWait({
      task: trimmedTask,
      sessionOptions,
      maxSteps
    });

    if (response.status === 'failed' || response.error) {
      throw new Error(`OpenAI computer use agent failed: ${response.error || 'Unknown error'}`);
    }

    const data = response.data
      ? {
          ...response.data,
          steps: returnStepInfo ? response.data.steps ?? [] : []
        }
      : null;

    return {
      jobId: response.jobId,
      status: response.status,
      liveUrl: response.liveUrl ?? null,
      data,
      metadata: {
        sessionOptions,
        maxSteps,
        returnStepInfo
      }
    };
  } catch (error) {
    console.error('HyperBrowser OpenAI CUA error:', error);
    throw new Error(`OpenAI computer use agent failed: ${error.message ?? error}`);
  }
}

export async function mcp__hyperbrowser__claude_computer_use_agent(args) {
  const {
    task,
    sessionOptions: sessionOverrides = {},
    maxSteps,
    returnStepInfo = false
  } = args ?? {};

  const trimmedTask = typeof task === 'string' ? task.trim() : '';
  if (!trimmedTask) {
    throw new Error('Task is required for Claude computer use agent');
  }

  try {
    const client = getHyperbrowserClient();
    const sessionOptions = mergeSessionOptions(sessionOverrides);

    const response = await client.agents.claudeComputerUse.startAndWait({
      task: trimmedTask,
      sessionOptions,
      maxSteps
    });

    if (response.status === 'failed' || response.error) {
      throw new Error(`Claude computer use agent failed: ${response.error || 'Unknown error'}`);
    }

    const data = response.data
      ? {
          ...response.data,
          steps: returnStepInfo ? response.data.steps ?? [] : []
        }
      : null;

    return {
      jobId: response.jobId,
      status: response.status,
      liveUrl: response.liveUrl ?? null,
      data,
      metadata: {
        sessionOptions,
        maxSteps,
        returnStepInfo
      }
    };
  } catch (error) {
    console.error('HyperBrowser Claude computer use error:', error);
    throw new Error(`Claude computer use agent failed: ${error.message ?? error}`);
  }
}

export async function mcp__hyperbrowser__create_profile(args) {
  const { name } = args ?? {};

  try {
    const client = getHyperbrowserClient();
    const response = await client.profiles.create(
      typeof name === 'string' && name.trim().length ? { name: name.trim() } : undefined
    );

    return response;
  } catch (error) {
    console.error('HyperBrowser create profile error:', error);
    throw new Error(`Failed to create profile: ${error.message ?? error}`);
  }
}

export async function mcp__hyperbrowser__delete_profile(args) {
  const { profileId } = args ?? {};

  if (!profileId || typeof profileId !== 'string') {
    throw new Error('profileId is required to delete a profile');
  }

  try {
    const client = getHyperbrowserClient();
    const response = await client.profiles.delete(profileId);
    return {
      profileId,
      success: Boolean(response?.success)
    };
  } catch (error) {
    console.error('HyperBrowser delete profile error:', error);
    throw new Error(`Failed to delete profile ${profileId}: ${error.message ?? error}`);
  }
}

export async function mcp__hyperbrowser__list_profiles(args) {
  const { page, limit } = args ?? {};

  try {
    const client = getHyperbrowserClient();
    const response = await client.profiles.list({
      page: typeof page === 'number' ? page : undefined,
      limit: typeof limit === 'number' ? limit : undefined
    });

    return response;
  } catch (error) {
    console.error('HyperBrowser list profiles error:', error);
    throw new Error(`Failed to list profiles: ${error.message ?? error}`);
  }
}

// Export tool metadata for MCP compatibility
const sessionOptionsParameter = {
  type: 'object',
  required: false,
  description: 'Session configuration overrides',
  properties: {
    useStealth: { type: 'boolean', description: 'Enable stealth mode to reduce bot detection' },
    useProxy: { type: 'boolean', description: 'Route traffic through Hyperbrowser proxy (additional cost)' },
    solveCaptchas: { type: 'boolean', description: 'Attempt to solve encountered CAPTCHAs automatically' },
    acceptCookies: { type: 'boolean', description: 'Automatically accept cookie banners' },
    profile: {
      type: 'object',
      description: 'Persistent session profile configuration',
      properties: {
        id: { type: 'string', description: 'Profile identifier' },
        persistChanges: { type: 'boolean', description: 'Persist browser state changes' }
      }
    }
  }
};

export const toolMetadata = {
  scrape_webpage: {
    name: 'mcp__hyperbrowser__scrape_webpage',
    description: 'Scrape full webpage content with JavaScript rendering',
    parameters: {
      url: { type: 'string', required: true, description: 'URL to scrape' },
      outputFormat: {
        type: 'array',
        items: { type: 'string', enum: ['markdown', 'html', 'links', 'screenshot'] },
        default: ['markdown'],
        description: 'Desired output formats'
      },
      sessionOptions: sessionOptionsParameter
    }
  },
  extract_structured_data: {
    name: 'mcp__hyperbrowser__extract_structured_data',
    description: 'Extract structured data from webpages using LLM and schema',
    parameters: {
      urls: { type: 'array', items: { type: 'string' }, required: true, description: 'URLs to extract from' },
      prompt: { type: 'string', description: 'Extraction instructions' },
      schema: { type: 'object', required: true, description: 'JSON schema for extracted data' },
      sessionOptions: sessionOptionsParameter
    }
  },
  crawl_webpages: {
    name: 'mcp__hyperbrowser__crawl_webpages',
    description: 'Crawl a website and aggregate content from linked pages',
    parameters: {
      url: { type: 'string', required: true, description: 'Starting URL to crawl' },
      outputFormat: {
        type: 'array',
        items: { type: 'string', enum: ['markdown', 'html', 'links', 'screenshot'] },
        default: ['markdown'],
        description: 'Output formats to request for each crawled page'
      },
      sessionOptions: sessionOptionsParameter,
      followLinks: { type: 'boolean', description: 'Follow links discovered on the page (same-domain recommended)' },
      maxPages: { type: 'number', description: 'Maximum number of pages to crawl (1-100)' },
      ignoreSitemap: { type: 'boolean', description: 'Ignore sitemap hints when crawling' }
    }
  },
  search_with_bing: {
    name: 'mcp__hyperbrowser__search_with_bing',
    description: 'Search the web with Bing and return structured results',
    parameters: {
      query: { type: 'string', required: true, description: 'Search query to submit to Bing' },
      numResults: { type: 'number', required: false, default: 10, description: 'Maximum number of search results to return' },
      sessionOptions: sessionOptionsParameter
    }
  },
  browser_use_agent: {
    name: 'mcp__hyperbrowser__browser_use_agent',
    description: 'Automate explicit multi-step browser tasks using the Browser Use agent',
    parameters: {
      task: { type: 'string', required: true, description: 'Detailed instructions for the agent to execute' },
      sessionOptions: sessionOptionsParameter,
      maxSteps: { type: 'number', required: false, description: 'Maximum number of agent steps to execute' },
      returnStepInfo: { type: 'boolean', required: false, description: 'Include per-step reasoning and state in the response' }
    }
  },
  openai_computer_use_agent: {
    name: 'mcp__hyperbrowser__openai_computer_use_agent',
    description: 'Run automation tasks with OpenAI’s Computer Use agent',
    parameters: {
      task: { type: 'string', required: true, description: 'Task instructions for the agent' },
      sessionOptions: sessionOptionsParameter,
      maxSteps: { type: 'number', required: false, description: 'Maximum agent steps before stopping' },
      returnStepInfo: { type: 'boolean', required: false, description: 'Whether to include detailed step telemetry' }
    }
  },
  claude_computer_use_agent: {
    name: 'mcp__hyperbrowser__claude_computer_use_agent',
    description: 'Run automation tasks with Anthropic’s Claude Computer Use agent',
    parameters: {
      task: { type: 'string', required: true, description: 'Task instructions for the agent' },
      sessionOptions: sessionOptionsParameter,
      maxSteps: { type: 'number', required: false, description: 'Maximum agent steps before stopping' },
      returnStepInfo: { type: 'boolean', required: false, description: 'Whether to include detailed step telemetry' }
    }
  },
  create_profile: {
    name: 'mcp__hyperbrowser__create_profile',
    description: 'Create a persistent Hyperbrowser profile for re-usable sessions',
    parameters: {
      name: { type: 'string', required: false, description: 'Optional friendly name for the profile' }
    }
  },
  delete_profile: {
    name: 'mcp__hyperbrowser__delete_profile',
    description: 'Delete an existing Hyperbrowser profile',
    parameters: {
      profileId: { type: 'string', required: true, description: 'Identifier of the profile to delete' }
    }
  },
  list_profiles: {
    name: 'mcp__hyperbrowser__list_profiles',
    description: 'List available Hyperbrowser profiles with pagination support',
    parameters: {
      page: { type: 'number', required: false, description: 'Page number for paginated results' },
      limit: { type: 'number', required: false, description: 'Number of profiles to return per page' }
    }
  }
};

export default {
  mcp__hyperbrowser__scrape_webpage,
  mcp__hyperbrowser__extract_structured_data,
  toolMetadata
};
