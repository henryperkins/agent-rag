import { hybridSemanticSearch } from './directSearch.js';
import { config } from '../config/app.js';
import type { Reference } from '../../../shared/types.js';

interface IndexConfig {
  name: string;
  weight: number;
  type?: string;
  description?: string;
}

interface FederatedSearchOptions {
  top?: number;
  filter?: string;
  semanticConfiguration?: string;
}

interface FederatedSearchResult {
  references: Reference[];
  indexBreakdown: Record<string, number>;
}

function parseRawIndexConfig(raw: string): IndexConfig[] {
  if (!raw || !raw.trim()) {
    return [];
  }

  // Primary format: JSON array
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const name = typeof entry.name === 'string' ? entry.name.trim() : '';
          if (!name) {
            return null;
          }
          const weight = typeof entry.weight === 'number' && entry.weight > 0 ? entry.weight : 1;
          const type = typeof entry.type === 'string' ? entry.type : undefined;
          const description = typeof entry.description === 'string' ? entry.description : undefined;
          return { name, weight, type, description };
        })
        .filter((entry): entry is IndexConfig => Boolean(entry));
    }
  } catch {
    // fall through to legacy parsing
  }

  // Legacy format: name[:weight[:type]];name[:weight[:type]]
  return raw
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const [name, weightRaw, type] = segment.split(':').map((part) => part.trim());
      if (!name) {
        return null;
      }
      const weight = weightRaw ? Number(weightRaw) : 1;
      return {
        name,
        weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
        type: type || undefined
      } satisfies IndexConfig;
    })
    .filter((entry): entry is IndexConfig => Boolean(entry));
}

function resolveFederatedIndexes(): IndexConfig[] {
  const baseIndex: IndexConfig = {
    name: config.AZURE_SEARCH_INDEX_NAME,
    weight: 1,
    type: 'primary',
    description: 'Primary Azure AI Search index'
  };

  const extra = parseRawIndexConfig(config.AZURE_SEARCH_FEDERATED_INDEXES);
  const seen = new Set<string>([baseIndex.name]);

  const indexes = [baseIndex];
  for (const entry of extra) {
    if (!seen.has(entry.name)) {
      indexes.push(entry);
      seen.add(entry.name);
    }
  }

  return indexes;
}

export async function federatedSearch(query: string, options: FederatedSearchOptions = {}): Promise<FederatedSearchResult> {
  const indexes = resolveFederatedIndexes();

  if (indexes.length <= 1) {
    const fallback = await hybridSemanticSearch(query, {
      top: options.top ?? config.RAG_TOP_K,
      filter: options.filter,
      semanticConfig: options.semanticConfiguration,
      searchFields: ['page_chunk'],
      selectFields: ['id', 'page_chunk', 'page_number']
    });

    return {
      references: fallback.references,
      indexBreakdown: {
        [config.AZURE_SEARCH_INDEX_NAME]: fallback.references.length
      }
    };
  }

  const totalResults = options.top ?? config.RAG_TOP_K;
  const perIndex = Math.max(1, Math.ceil(totalResults * 1.5 / indexes.length));

  const indexBreakdown: Record<string, number> = {};
  const weighted: Array<{ reference: Reference; score: number }> = [];

  await Promise.all(
    indexes.map(async (index) => {
      try {
        const result = await hybridSemanticSearch(query, {
          indexName: index.name,
          top: perIndex,
          filter: options.filter,
          semanticConfig: options.semanticConfiguration,
          searchFields: ['page_chunk'],
          selectFields: ['id', 'page_chunk', 'page_number']
        });

        indexBreakdown[index.name] = result.references.length;

        for (const ref of result.references) {
          const score = (ref.score ?? 0) * (index.weight || 1);
          const enriched: Reference = {
            ...ref,
            sourceIndex: index.name,
            sourceType: index.type ?? 'unknown',
            metadata: {
              ...(ref.metadata ?? {}),
              source_index: index.name,
              source_type: index.type ?? 'unknown',
              source_weight: index.weight
            }
          };
          weighted.push({ reference: enriched, score });
        }
      } catch (error) {
        indexBreakdown[index.name] = 0;
        console.warn(`Federated search failed for index "${index.name}":`, error);
      }
    })
  );

  if (!weighted.length) {
    return {
      references: [],
      indexBreakdown
    };
  }

  weighted.sort((a, b) => b.score - a.score);
  const unique: Reference[] = [];
  const seenIds = new Set<string>();

  for (const item of weighted) {
    const id = item.reference.id ?? `${item.reference.metadata?.source_index ?? 'unknown'}:${unique.length}`;
    if (seenIds.has(id)) {
      continue;
    }
    seenIds.add(id);
    unique.push(item.reference);
    if (unique.length >= totalResults) {
      break;
    }
  }

  return {
    references: unique,
    indexBreakdown
  };
}
