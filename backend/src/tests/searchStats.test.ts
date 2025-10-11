import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node 20 has global fetch; we will mock it

describe('searchStats', () => {
  const endpoint = 'https://example-search.search.windows.net';

  beforeEach(() => {
    process.env.AZURE_SEARCH_ENDPOINT = endpoint;
    process.env.AZURE_SEARCH_DATA_PLANE_API_VERSION = '2025-08-01-preview';
    process.env.AZURE_SEARCH_INDEX_NAME = 'my-index';
    // Use API key path to avoid managed identity in tests
    process.env.AZURE_SEARCH_API_KEY = 'test-key';
    vi.restoreAllMocks();
  });

  it('fetches service stats', async () => {
    const { getServiceStats } = await import('../azure/searchStats.js');
    const mockJson = {
      counters: {
        aliasesCount: { usage: 0 },
        documentCount: { usage: 123 },
        indexesCount: { usage: 1 },
        indexersCount: { usage: 0 },
        dataSourcesCount: { usage: 0 },
        storageSize: { usage: 45678 },
        synonymMaps: { usage: 0 },
        skillsetCount: { usage: 0 },
        vectorIndexSize: { usage: 0 }
      },
      limits: {}
    };

    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => mockJson
    } as any);

    const result = await getServiceStats();
    expect(fetchSpy).toHaveBeenCalledWith(
      `${endpoint}/servicestats?api-version=2025-08-01-preview`,
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.counters.documentCount.usage).toBe(123);
  });

  it('fetches index stats for default index', async () => {
    const { getIndexStats } = await import('../azure/searchStats.js');
    const mockJson = { documentCount: 10, storageSize: 2048, vectorIndexSize: 1024 };
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => mockJson
    } as any);

    const result = await getIndexStats();
    expect(fetchSpy).toHaveBeenCalledWith(
      `${endpoint}/indexes/my-index/search.stats?api-version=2025-08-01-preview`,
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.documentCount).toBe(10);
  });

  it('fetches index stats summary', async () => {
    const { getIndexStatsSummary } = await import('../azure/searchStats.js');
    const mockJson = { value: [{ name: 'my-index', documentCount: 10, storageSize: 2048, vectorIndexSize: 1024 }] };
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      json: async () => mockJson
    } as any);

    const result = await getIndexStatsSummary();
    expect(fetchSpy).toHaveBeenCalledWith(
      `${endpoint}/indexstats?api-version=2025-08-01-preview`,
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.indexes[0]?.name).toBe('my-index');
  });

  it('throws on non-OK responses', async () => {
    const { getIndexStats } = await import('../azure/searchStats.js');
    vi.spyOn(global, 'fetch' as any).mockResolvedValue({ ok: false, status: 500, text: async () => 'err' } as any);
    await expect(getIndexStats()).rejects.toBeInstanceOf(Error);
  });
});
