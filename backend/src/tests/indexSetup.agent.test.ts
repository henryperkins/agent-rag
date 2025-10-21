import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const endpoint = 'https://example.search.windows.net';

function setCommonEnv() {
  process.env.AZURE_SEARCH_ENDPOINT = endpoint;
  process.env.AZURE_SEARCH_DATA_PLANE_API_VERSION = '2025-08-01-preview';
  process.env.AZURE_SEARCH_MANAGEMENT_API_VERSION = '2025-08-01-preview';
  process.env.AZURE_SEARCH_API_VERSION = '2025-08-01-preview';
  process.env.AZURE_SEARCH_INDEX_NAME = 'earth_at_night';
  process.env.AZURE_KNOWLEDGE_AGENT_NAME = 'earth-knowledge-agent';
  process.env.AZURE_SEARCH_API_KEY = 'test-key';
  process.env.AZURE_OPENAI_ENDPOINT = 'https://example.openai.azure.com';
}

describe('createKnowledgeAgent', () => {
  beforeEach(() => {
    vi.resetModules();
    setCommonEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('provisions knowledge source and agent via OData routes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({})
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({})
      });

    vi.stubGlobal('fetch', fetchMock);

    const { createKnowledgeAgent } = await import('../azure/indexSetup.js');

    await createKnowledgeAgent();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [ksUrl, ksOptions] = fetchMock.mock.calls[0]!;
    expect(ksUrl).toBe(`${endpoint}/knowledgesources('earth-at-night')?api-version=2025-08-01-preview`);
    expect(ksOptions).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'api-key': 'test-key'
      })
    });

    const [agentUrl, agentOptions] = fetchMock.mock.calls[1]!;
    expect(agentUrl).toBe(`${endpoint}/agents('earth-knowledge-agent')?api-version=2025-08-01-preview`);
    expect(agentOptions).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'api-key': 'test-key'
      })
    });
  });

  it('falls back to data plane when management API rejects the request', async () => {
    const managementError = 'Unsupported api-version';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({})
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => managementError
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({})
      });

    vi.stubGlobal('fetch', fetchMock);

    const { createKnowledgeAgent } = await import('../azure/indexSetup.js');

    await createKnowledgeAgent();

    expect(fetchMock).toHaveBeenCalledTimes(3);

    const [, managementOptions] = fetchMock.mock.calls[1]!;
    expect(managementOptions).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'api-key': 'test-key'
      })
    });

    const [fallbackUrl, fallbackOptions] = fetchMock.mock.calls[2]!;
    expect(fallbackUrl).toBe(`${endpoint}/agents('earth-knowledge-agent')?api-version=2025-08-01-preview`);
    expect(fallbackOptions).toMatchObject({
      method: 'PUT',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'api-key': 'test-key'
      })
    });
  });
});
