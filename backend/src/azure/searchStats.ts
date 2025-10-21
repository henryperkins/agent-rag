import { config } from '../config/app.js';
import { performSearchRequest } from './searchHttp.js';

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
  const { response } = await performSearchRequest('get-service-stats', url);
  return (await response.json()) as ServiceStatistics;
}

export async function getIndexStats(indexName = config.AZURE_SEARCH_INDEX_NAME): Promise<IndexStatistics> {
  const url = buildIndexStatsUrl(indexName);
  const { response } = await performSearchRequest('get-index-stats', url);
  return (await response.json()) as IndexStatistics;
}

export async function getIndexStatsSummary(): Promise<{ indexes: IndexStatsSummaryEntry[] }> {
  const url = `${config.AZURE_SEARCH_ENDPOINT}/indexstats?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;
  const { response } = await performSearchRequest('get-index-stats-summary', url);
  const data = (await response.json()) as { value: Array<IndexStatsSummaryEntry> };
  return { indexes: data.value };
}
