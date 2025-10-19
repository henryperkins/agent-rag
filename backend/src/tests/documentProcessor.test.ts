import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

process.env.AZURE_SEARCH_ENDPOINT = 'https://example.search.windows.net';
process.env.AZURE_SEARCH_INDEX_NAME = 'test-index';
process.env.AZURE_SEARCH_DATA_PLANE_API_VERSION = '2025-08-01-preview';
process.env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com';

vi.mock('../azure/directSearch.js', () => ({
  getSearchAuthHeaders: vi.fn()
}));

import { uploadDocumentsToIndex } from '../tools/documentProcessor.js';
import { getSearchAuthHeaders } from '../azure/directSearch.js';

describe('uploadDocumentsToIndex', () => {
  const fetchSpy = vi.fn();
  const authMock = getSearchAuthHeaders as unknown as vi.Mock;

  beforeEach(() => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' })
    });
    vi.stubGlobal('fetch', fetchSpy);
    authMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('merges API key header from search auth helper', async () => {
    authMock.mockResolvedValue({ 'api-key': 'abc123' });

    const result = await uploadDocumentsToIndex([{ id: '1' }]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    expect(options).toMatchObject({ method: 'POST' });
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      'api-key': 'abc123'
    });
    expect(result).toEqual({ status: 'ok' });
  });

  it('propagates managed identity Authorization header', async () => {
    authMock.mockResolvedValue({ Authorization: 'Bearer token' });

    await uploadDocumentsToIndex([{ id: '1' }]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, options] = fetchSpy.mock.calls[0]!;
    expect(options.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token'
    });
  });
});
