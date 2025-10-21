import { config } from '../config/app.js';
import { getSearchAuthHeaders } from './directSearch.js';

const buildIndexStatsUrl = (indexName: string): string => {
  const encodedName = encodeURIComponent(indexName);
  return `${config.AZURE_SEARCH_ENDPOINT}/indexes('${encodedName}')/search.stats?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;
};

// Types derived from searchservice-preview.json
export interface ResourceCounter {
  usage: number;
  quota?: number | null;
}

// Matches 2025-08-01-preview REST wire schema (field names on the wire)
export interface ServiceStatistics {
  counters: {
    // aliasesCount appears in API but not always present in examples
    aliasesCount?: ResourceCounter; // optional
    documentCount: ResourceCounter;
    indexesCount: ResourceCounter;
    indexersCount: ResourceCounter;
    dataSourcesCount: ResourceCounter;
    storageSize: ResourceCounter;
    synonymMaps: ResourceCounter;
    skillsetCount: ResourceCounter;
    vectorIndexSize: ResourceCounter;
  };
  limits: {
    maxFieldsPerIndex?: number | null;
    maxFieldNestingDepthPerIndex?: number | null;
    maxComplexCollectionFieldsPerIndex?: number | null;
    maxComplexObjectsInCollectionsPerDocument?: number | null;
    maxStoragePerIndex?: number | null;
  };
}

export interface IndexStatistics {
  documentCount: number;
  storageSize: number;
  vectorIndexSize: number;
}

export interface IndexStatsSummaryEntry {
  name: string;
  documentCount: number;
  storageSize: number;
  vectorIndexSize: number;
}

export async function getServiceStats(): Promise<ServiceStatistics> {
  const url = `${config.AZURE_SEARCH_ENDPOINT}/servicestats?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;
  const headers = await getSearchAuthHeaders();

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Service stats failed: ${res.status} ${text}`);
  }
  return (await res.json()) as ServiceStatistics;
}

export async function getIndexStats(indexName = config.AZURE_SEARCH_INDEX_NAME): Promise<IndexStatistics> {
  const url = buildIndexStatsUrl(indexName);
  const headers = await getSearchAuthHeaders();

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Index stats failed: ${res.status} ${text}`);
  }
  return (await res.json()) as IndexStatistics;
}

export async function getIndexStatsSummary(): Promise<{ indexes: IndexStatsSummaryEntry[] }> {
  const url = `${config.AZURE_SEARCH_ENDPOINT}/indexstats?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;
  const headers = await getSearchAuthHeaders();

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Index stats summary failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { value: Array<IndexStatsSummaryEntry> };
  return { indexes: data.value };
}
