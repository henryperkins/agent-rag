import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

describe('webSearchTool Hyperbrowser enrichment', () => {
  const mockScrape = vi.fn();
  const mockExtract = vi.fn();
  let webSearchTool: typeof import('../tools/webSearch.js')['webSearchTool'];

  beforeEach(async () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'test-key';
    process.env.GOOGLE_SEARCH_ENGINE_ID = 'search-engine';
    process.env.GOOGLE_SEARCH_ENDPOINT = 'https://customsearch.googleapis.com/customsearch/v1';
    process.env.HYPERBROWSER_API_KEY = 'hb-test';
    process.env.HYPERBROWSER_SCRAPE_FORMATS = 'markdown,links';

    vi.resetModules();
    mockScrape.mockReset();
    mockExtract.mockReset();

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            title: 'Example Result',
            snippet: 'Snippet text',
            link: 'https://example.com/article',
            cacheId: 'example-1',
            htmlTitle: 'Example Result',
            htmlSnippet: 'Snippet text',
            displayLink: 'example.com',
            formattedUrl: 'https://example.com/article',
            htmlFormattedUrl: 'https://example.com/article'
          }
        ]
      })
    });

    vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

    vi.doMock('../../../mcp-tools.js', () => ({
      mcp__hyperbrowser__scrape_webpage: mockScrape,
      mcp__hyperbrowser__extract_structured_data: mockExtract,
      mergeSessionOptions: (overrides: Record<string, unknown> = {}) => ({
        useStealth: true,
        useProxy: false,
        solveCaptchas: false,
        acceptCookies: true,
        ...overrides
      })
    }));

    ({ webSearchTool } = await import('../tools/webSearch.js'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('passes configured formats and surfaces enriched fields', async () => {
    const scrapedAt = '2025-01-01T00:00:00.000Z';
    mockScrape.mockResolvedValue({
      markdown: '# Example',
      html: '<h1>Example</h1>',
      links: [{ url: 'https://docs.example', text: 'Docs' }],
      metadata: { scrapedAt }
    });

    const response = await webSearchTool({
      query: 'example query',
      mode: 'hyperbrowser_scrape'
    });

    expect(mockScrape).toHaveBeenCalledTimes(1);
    expect(mockScrape).toHaveBeenCalledWith({
      url: 'https://example.com/article',
      outputFormat: ['markdown', 'links'],
      sessionOptions: {
        useStealth: true,
        useProxy: false,
        solveCaptchas: false,
        acceptCookies: true
      }
    });

    expect(response.results).toHaveLength(1);
    const [result] = response.results;
    expect(result.html).toBe('<h1>Example</h1>');
    expect(result.links).toEqual([{ url: 'https://docs.example', text: 'Docs' }]);
    expect(result.metadata && typeof result.metadata === 'object').toBe(true);
    expect((result.metadata as Record<string, unknown>).hyperbrowser).toMatchObject({
      formats: ['markdown', 'links'],
      sessionOptions: {
        useStealth: true,
        useProxy: false,
        solveCaptchas: false,
        acceptCookies: true
      }
    });
    expect(result.scrapedAt).toBe(scrapedAt);
  });

  it('honors explicit Hyperbrowser scrape overrides', async () => {
    mockScrape.mockResolvedValue({
      markdown: '',
      html: '<article>Content</article>',
      screenshot: 'base64-data',
      metadata: {}
    });

    await webSearchTool({
      query: 'custom hyperbrowser options',
      mode: 'hyperbrowser_scrape',
      hyperbrowser: {
        scrape: {
          outputFormats: ['html', 'screenshot'],
          sessionOptions: {
            useProxy: true,
            profile: { id: 'profile-1', persistChanges: false }
          },
          enhanceCount: 1
        }
      }
    });

    expect(mockScrape).toHaveBeenCalledWith({
      url: 'https://example.com/article',
      outputFormat: ['html', 'screenshot'],
      sessionOptions: {
        useStealth: true,
        useProxy: true,
        solveCaptchas: false,
        acceptCookies: true,
        profile: { id: 'profile-1', persistChanges: false }
      }
    });
  });
});
