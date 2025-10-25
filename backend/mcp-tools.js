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
 * @param {string[]} args.outputFormat - Desired output formats: ['markdown', 'html', 'text']
 * @returns {Promise<Object>} Scraped content with metadata
 */
export async function mcp__hyperbrowser__scrape_webpage(args) {
  const { url, outputFormat = ['markdown'] } = args;

  if (!url) {
    throw new Error('URL is required for webpage scraping');
  }

  try {
    const client = getHyperbrowserClient();

    // Start a scraping session
    const session = await client.sessions.create({
      url,
      outputFormat: outputFormat.includes('markdown') ? 'markdown' : 'html'
    });

    // Wait for the session to complete
    const result = await client.sessions.get(session.id);

    // Poll for completion if needed
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout

    while (result.status !== 'completed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const updated = await client.sessions.get(session.id);

      if (updated.status === 'completed') {
        // Extract content based on output format
        const response = {
          url,
          status: 'success'
        };

        if (outputFormat.includes('markdown')) {
          response.markdown = updated.result?.markdown || updated.result?.content || '';
        }

        if (outputFormat.includes('html')) {
          response.html = updated.result?.html || '';
        }

        if (outputFormat.includes('text')) {
          response.text = updated.result?.text || updated.result?.markdown || '';
        }

        // Include metadata
        response.metadata = {
          title: updated.result?.title || '',
          description: updated.result?.description || '',
          scrapedAt: new Date().toISOString(),
          sessionId: session.id
        };

        return response;
      }

      if (updated.status === 'failed') {
        throw new Error(`Scraping failed: ${updated.error || 'Unknown error'}`);
      }

      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error('Scraping timeout: Session did not complete within 30 seconds');
    }

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
  const { urls, prompt, schema } = args;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    throw new Error('At least one URL is required for structured data extraction');
  }

  if (!schema) {
    throw new Error('Schema is required for structured data extraction');
  }

  try {
    const client = getHyperbrowserClient();

    // Process each URL
    const results = await Promise.all(
      urls.map(async (url) => {
        try {
          // Create extraction session
          const session = await client.sessions.create({
            url,
            outputFormat: 'json',
            extractionSchema: schema,
            extractionPrompt: prompt || 'Extract structured data according to the schema'
          });

          // Poll for completion
          let attempts = 0;
          const maxAttempts = 30;

          while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const updated = await client.sessions.get(session.id);

            if (updated.status === 'completed') {
              return updated.result?.extracted || updated.result || {};
            }

            if (updated.status === 'failed') {
              console.error(`Extraction failed for ${url}:`, updated.error);
              return null;
            }

            attempts++;
          }

          console.warn(`Extraction timeout for ${url}`);
          return null;

        } catch (error) {
          console.error(`Error extracting from ${url}:`, error);
          return null;
        }
      })
    );

    return results;

  } catch (error) {
    console.error('HyperBrowser extraction error:', error);
    throw new Error(`Failed to extract structured data: ${error.message}`);
  }
}

// Export tool metadata for MCP compatibility
export const toolMetadata = {
  scrape_webpage: {
    name: 'mcp__hyperbrowser__scrape_webpage',
    description: 'Scrape full webpage content with JavaScript rendering',
    parameters: {
      url: { type: 'string', required: true, description: 'URL to scrape' },
      outputFormat: {
        type: 'array',
        items: { type: 'string', enum: ['markdown', 'html', 'text'] },
        default: ['markdown'],
        description: 'Desired output formats'
      }
    }
  },
  extract_structured_data: {
    name: 'mcp__hyperbrowser__extract_structured_data',
    description: 'Extract structured data from webpages using LLM and schema',
    parameters: {
      urls: { type: 'array', items: { type: 'string' }, required: true, description: 'URLs to extract from' },
      prompt: { type: 'string', description: 'Extraction instructions' },
      schema: { type: 'object', required: true, description: 'JSON schema for extracted data' }
    }
  }
};

export default {
  mcp__hyperbrowser__scrape_webpage,
  mcp__hyperbrowser__extract_structured_data,
  toolMetadata
};
