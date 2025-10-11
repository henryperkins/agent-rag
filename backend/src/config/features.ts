import type { FeatureFlag, FeatureOverrideMap, FeatureSource } from '../../../shared/types.js';
import { config } from './app.js';

export const FEATURE_FLAG_KEYS: FeatureFlag[] = [
  'ENABLE_MULTI_INDEX_FEDERATION',
  'ENABLE_LAZY_RETRIEVAL',
  'ENABLE_SEMANTIC_SUMMARY',
  'ENABLE_INTENT_ROUTING',
  'ENABLE_SEMANTIC_MEMORY',
  'ENABLE_QUERY_DECOMPOSITION',
  'ENABLE_WEB_RERANKING',
  'ENABLE_SEMANTIC_BOOST',
  'ENABLE_RESPONSE_STORAGE',
  'ENABLE_ADAPTIVE_RETRIEVAL'
];

export interface FeatureGates {
  multiIndexFederation: boolean;
  lazyRetrieval: boolean;
  semanticSummary: boolean;
  intentRouting: boolean;
  semanticMemory: boolean;
  queryDecomposition: boolean;
  webReranking: boolean;
  semanticBoost: boolean;
  responseStorage: boolean;
  adaptiveRetrieval: boolean;
}

const FEATURE_KEY_MAP: Record<FeatureFlag, keyof FeatureGates> = {
  ENABLE_MULTI_INDEX_FEDERATION: 'multiIndexFederation',
  ENABLE_LAZY_RETRIEVAL: 'lazyRetrieval',
  ENABLE_SEMANTIC_SUMMARY: 'semanticSummary',
  ENABLE_INTENT_ROUTING: 'intentRouting',
  ENABLE_SEMANTIC_MEMORY: 'semanticMemory',
  ENABLE_QUERY_DECOMPOSITION: 'queryDecomposition',
  ENABLE_WEB_RERANKING: 'webReranking',
  ENABLE_SEMANTIC_BOOST: 'semanticBoost',
  ENABLE_RESPONSE_STORAGE: 'responseStorage',
  ENABLE_ADAPTIVE_RETRIEVAL: 'adaptiveRetrieval'
};

export function sanitizeFeatureOverrides(input?: FeatureOverrideMap | null): FeatureOverrideMap | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const sanitized: FeatureOverrideMap = {};
  for (const key of FEATURE_FLAG_KEYS) {
    const value = input[key];
    if (typeof value === 'boolean') {
      sanitized[key] = value;
    }
  }

  return Object.keys(sanitized).length ? sanitized : undefined;
}

function defaultFeatureStates(): Record<FeatureFlag, boolean> {
  return {
    ENABLE_MULTI_INDEX_FEDERATION: config.ENABLE_MULTI_INDEX_FEDERATION,
    ENABLE_LAZY_RETRIEVAL: config.ENABLE_LAZY_RETRIEVAL,
    ENABLE_SEMANTIC_SUMMARY: config.ENABLE_SEMANTIC_SUMMARY,
    ENABLE_INTENT_ROUTING: config.ENABLE_INTENT_ROUTING,
    ENABLE_SEMANTIC_MEMORY: config.ENABLE_SEMANTIC_MEMORY,
    ENABLE_QUERY_DECOMPOSITION: config.ENABLE_QUERY_DECOMPOSITION,
    ENABLE_WEB_RERANKING: config.ENABLE_WEB_RERANKING,
    ENABLE_SEMANTIC_BOOST: config.ENABLE_SEMANTIC_BOOST,
    ENABLE_RESPONSE_STORAGE: config.ENABLE_RESPONSE_STORAGE,
    ENABLE_ADAPTIVE_RETRIEVAL: config.ENABLE_ADAPTIVE_RETRIEVAL
  };
}

export interface ResolveFeatureParams {
  overrides?: FeatureOverrideMap | null;
  persisted?: FeatureOverrideMap | null;
}

export interface FeatureResolution {
  gates: FeatureGates;
  resolved: Record<FeatureFlag, boolean>;
  sources: Record<FeatureFlag, FeatureSource>;
  overrides?: FeatureOverrideMap;
  persisted?: FeatureOverrideMap;
}

export function resolveFeatureToggles(params: ResolveFeatureParams = {}): FeatureResolution {
  const defaults = defaultFeatureStates();
  const overrides = sanitizeFeatureOverrides(params.overrides);
  const persisted = sanitizeFeatureOverrides(params.persisted);

  const resolved: Record<FeatureFlag, boolean> = { ...defaults };
  const sources: Record<FeatureFlag, FeatureSource> = Object.fromEntries(
    FEATURE_FLAG_KEYS.map((flag) => [flag, 'config' as FeatureSource])
  ) as Record<FeatureFlag, FeatureSource>;

  if (persisted) {
    for (const [flag, value] of Object.entries(persisted) as Array<[FeatureFlag, boolean]>) {
      resolved[flag] = value;
      sources[flag] = 'persisted';
    }
  }

  if (overrides) {
    for (const [flag, value] of Object.entries(overrides) as Array<[FeatureFlag, boolean]>) {
      resolved[flag] = value;
      sources[flag] = 'override';
    }
  }

  const gates = FEATURE_FLAG_KEYS.reduce((acc, flag) => {
    const key = FEATURE_KEY_MAP[flag];
    acc[key] = resolved[flag];
    return acc;
  }, {} as FeatureGates);

  return {
    gates,
    resolved,
    sources,
    overrides,
    persisted
  };
}
