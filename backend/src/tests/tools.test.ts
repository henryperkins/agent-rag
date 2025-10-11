import { describe, expect, it, vi, beforeEach } from 'vitest';
import { retrieveTool } from '../tools/index.js';
import * as directSearch from '../azure/directSearch.js';
import { config } from '../config/app.js';

// Mock the azure modules
vi.mock('../azure/directSearch.js', () => ({
  hybridSemanticSearch: vi.fn(),
  vectorSearch: vi.fn(),
  isRestrictiveFilter: vi.fn(() => false)
}));

vi.mock('../azure/multiIndexSearch.js', () => ({
  federatedSearch: vi.fn()
}));

vi.mock('../utils/resilience.js', () => ({
  withRetry: vi.fn((_, fn) => fn())
}));

describe('retrieveTool coverage threshold', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits low_coverage activity when Azure coverage is below threshold (0-100 scale)', async () => {
    // Azure returns coverage as 0-100 (e.g., 75 = 75%)
    // Config SEARCH_MIN_COVERAGE is 0-1 scale (e.g., 0.8 = 80%)
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 75 // 75% coverage from Azure (0-100 scale)
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: { ENABLE_MULTI_INDEX_FEDERATION: false }
    });

    // Should have low_coverage activity since 75% < 80% threshold
    expect(result.activity).toBeDefined();
    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeDefined();
    expect(lowCoverageActivity?.description).toContain('75%');
    expect(lowCoverageActivity?.description).toContain('80%');
    expect(lowCoverageActivity?.description).not.toContain('7500%'); // Should not have scale error
  });

  it('does not emit low_coverage activity when Azure coverage meets threshold', async () => {
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 85 // 85% coverage from Azure (above 80% threshold)
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: { ENABLE_MULTI_INDEX_FEDERATION: false }
    });

    expect(result.activity).toBeDefined();
    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeUndefined();
  });

  it('handles coverage exactly at threshold (boundary case)', async () => {
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 80 // Exactly at 80% threshold
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: { ENABLE_MULTI_INDEX_FEDERATION: false }
    });

    expect(result.activity).toBeDefined();
    // Should not emit low_coverage since 80% == 80% (not below)
    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeUndefined();
  });

  it('handles missing coverage value gracefully', async () => {
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ]
      // No coverage field
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: { ENABLE_MULTI_INDEX_FEDERATION: false }
    });

    expect(result.activity).toBeDefined();
    // Should not emit low_coverage when coverage is undefined
    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeUndefined();
  });

  it('correctly formats coverage percentage in activity message', async () => {
    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 65.7 // Test decimal handling
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: { ENABLE_MULTI_INDEX_FEDERATION: false }
    });

    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeDefined();
    // Should show "66%" (rounded) not "6570%"
    expect(lowCoverageActivity?.description).toMatch(/66%.*below.*80%/);
  });

  it('uses config.SEARCH_MIN_COVERAGE for threshold comparison', async () => {
    // Verify that we're comparing against the right config value
    expect(config.SEARCH_MIN_COVERAGE).toBe(0.8); // Should be 0-1 scale

    const mockResult = {
      references: [
        { id: '1', title: 'Doc 1', content: 'Content 1' },
        { id: '2', title: 'Doc 2', content: 'Content 2' },
        { id: '3', title: 'Doc 3', content: 'Content 3' }
      ],
      coverage: 79 // Just below 80%
    };

    vi.mocked(directSearch.hybridSemanticSearch).mockResolvedValue(mockResult);

    const result = await retrieveTool({
      query: 'test query',
      features: { ENABLE_MULTI_INDEX_FEDERATION: false }
    });

    const lowCoverageActivity = result.activity?.find((a) => a.type === 'low_coverage');
    expect(lowCoverageActivity).toBeDefined();
  });
});
