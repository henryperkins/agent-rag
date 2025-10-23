import type { ActivityStep, Reference, KnowledgeAgentGroundingSummary } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { performSearchRequest } from './searchHttp.js';

interface KnowledgeAgentActivityEntry {
  role: string;
  content: string;
}

export interface KnowledgeAgentInvocationOptions {
  activity: KnowledgeAgentActivityEntry[];
  top?: number;
  filter?: string;
  includeActivity?: boolean;
  includeReferences?: boolean;
  includeReferenceSourceData?: boolean;
  attemptFastPath?: boolean;
  correlationId?: string;
}

export interface KnowledgeAgentInvocationResult {
  references: Reference[];
  activity: ActivityStep[];
  answer?: string;
  usage?: unknown;
  raw?: unknown;
  requestId?: string;
  correlationId?: string;
  grounding?: KnowledgeAgentGroundingSummary;
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined && value !== null);
  return Object.fromEntries(entries) as T;
}

function normalizeKnowledgeReference(entry: any, index: number): Reference {
  if (!entry || typeof entry !== 'object') {
    return {
      id: `knowledge_${index + 1}`,
      title: `Knowledge Result ${index + 1}`,
      content: typeof entry === 'string' ? entry : ''
    };
  }

  const metadata = entry as Record<string, unknown>;
  const id =
    (typeof metadata.id === 'string' && metadata.id) ||
    (typeof metadata.chunkId === 'string' && metadata.chunkId) ||
    (typeof metadata.sourceId === 'string' && metadata.sourceId) ||
    (typeof metadata.documentId === 'string' && metadata.documentId) ||
    `knowledge_${index + 1}`;

  const title =
    (typeof metadata.title === 'string' && metadata.title) ||
    (typeof metadata.heading === 'string' && metadata.heading) ||
    (typeof metadata.sourceTitle === 'string' && metadata.sourceTitle) ||
    (typeof metadata.displayName === 'string' && metadata.displayName) ||
    id;

  let content =
    (typeof metadata.content === 'string' && metadata.content) ||
    (typeof metadata.text === 'string' && metadata.text) ||
    (typeof metadata.chunk === 'string' && metadata.chunk) ||
    (typeof metadata.body === 'string' && metadata.body) ||
    (Array.isArray(metadata.contents) && metadata.contents.filter((part) => typeof part === 'string').join('\n\n')) ||
    '';

  if (!content && typeof metadata.preview === 'string') {
    content = metadata.preview;
  }

  const url =
    (typeof metadata.url === 'string' && metadata.url) ||
    (typeof metadata.href === 'string' && metadata.href) ||
    (metadata.source && typeof (metadata.source as Record<string, unknown>).url === 'string'
      ? ((metadata.source as Record<string, unknown>).url as string)
      : undefined);

  const pageNumber =
    (typeof metadata.pageNumber === 'number' && metadata.pageNumber) ||
    (typeof metadata.page === 'number' && metadata.page) ||
    (metadata.metadata && typeof (metadata.metadata as Record<string, unknown>).pageNumber === 'number'
      ? ((metadata.metadata as Record<string, unknown>).pageNumber as number)
      : undefined);

  const scoreValue =
    (typeof metadata.score === 'number' && metadata.score) ||
    (typeof metadata.confidence === 'number' && metadata.confidence) ||
    (typeof metadata.relevanceScore === 'number' && metadata.relevanceScore) ||
    (typeof metadata.rank === 'number' && metadata.rank) ||
    undefined;

  return {
    id,
    title,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    url,
    page_number: pageNumber,
    score: scoreValue,
    metadata
  };
}

function extractReferenceCandidates(payload: any): any[] {
  const candidates: any[] = [];
  if (Array.isArray(payload?.references)) {
    candidates.push(...payload.references);
  }
  if (Array.isArray(payload?.citations)) {
    candidates.push(...payload.citations);
  }
  if (Array.isArray(payload?.answer?.citations)) {
    candidates.push(...payload.answer.citations);
  }
  if (Array.isArray(payload?.documents)) {
    candidates.push(...payload.documents);
  }
  if (Array.isArray(payload?.items)) {
    candidates.push(...payload.items);
  }
  if (Array.isArray(payload?.results)) {
    candidates.push(...payload.results);
  }
  return candidates;
}

interface UnifiedGroundingEntry {
  groundingId: string;
  chunkId?: string;
  documentId?: string;
  sourceId?: string;
  citationIds?: Set<string>;
}

const IDENTIFIER_KEYWORDS = ['id', 'chunk', 'source', 'document', 'ground'];
const GROUNDING_HINTS = ['ground', 'chain', 'support'];
const CITATION_HINTS = ['citat', 'attribut', 'reference'];

function normalizeLookupKey(value: string): string {
  return value.trim().toLowerCase();
}

function collectMetadataIdentifiers(
  metadata: Record<string, unknown> | undefined,
  depth = 0
): string[] {
  if (!metadata || typeof metadata !== 'object' || depth > 2) {
    return [];
  }

  const results: string[] = [];
  for (const [key, rawValue] of Object.entries(metadata)) {
    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (typeof rawValue === 'string') {
      if (IDENTIFIER_KEYWORDS.some((hint) => lowerKey.includes(hint))) {
        const trimmed = rawValue.trim();
        if (trimmed) {
          results.push(trimmed);
        }
      }
    } else if (typeof rawValue === 'number') {
      if (lowerKey.includes('id')) {
        results.push(rawValue.toString());
      }
    } else if (Array.isArray(rawValue) && depth < 2) {
      for (const candidate of rawValue.slice(0, 8)) {
        if (typeof candidate === 'string') {
          const trimmed = candidate.trim();
          if (trimmed) {
            results.push(trimmed);
          }
        } else if (typeof candidate === 'object' && candidate !== null) {
          results.push(...collectMetadataIdentifiers(candidate as Record<string, unknown>, depth + 1));
        }
      }
    } else if (typeof rawValue === 'object' && rawValue !== null && depth < 2) {
      results.push(...collectMetadataIdentifiers(rawValue as Record<string, unknown>, depth + 1));
    }
  }

  return results;
}

function collectReferenceKeys(ref: Reference): Set<string> {
  const keys = new Set<string>();

  const register = (value?: unknown) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const normalized = normalizeLookupKey(trimmed);
      keys.add(normalized);

      const parts = trimmed.split(/[#:@|]/);
      for (const part of parts) {
        const token = part.trim();
        if (token.length >= 3) {
          keys.add(token.toLowerCase());
        }
      }
    }
  };

  register(ref.id);
  const metadata = ref.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    const identifiers = collectMetadataIdentifiers(metadata);
    identifiers.forEach(register);
  }

  return keys;
}

function buildReferenceIndex(references: Reference[]): Map<string, number[]> {
  const index = new Map<string, number[]>();

  references.forEach((ref, refIndex) => {
    const keys = collectReferenceKeys(ref);
    keys.forEach((key) => {
      if (!key) {
        return;
      }
      const existing = index.get(key);
      if (existing) {
        if (!existing.includes(refIndex)) {
          existing.push(refIndex);
        }
      } else {
        index.set(key, [refIndex]);
      }
    });
  });

  return index;
}

function pickString(entry: Record<string, unknown>, candidates: string[]): string | undefined {
  for (const key of candidates) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) {
      const value = entry[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          return trimmed;
        }
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value.toString();
      }
    }
  }
  return undefined;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    const results: string[] = [];
    for (const element of value) {
      if (typeof element === 'string') {
        const trimmed = element.trim();
        if (trimmed) {
          results.push(trimmed);
        }
      } else if (typeof element === 'number') {
        results.push(element.toString());
      } else if (typeof element === 'object' && element !== null) {
        const inner = pickString(element as Record<string, unknown>, ['id', 'groundingId', 'grounding_id']);
        if (inner) {
          results.push(inner);
        }
      }
    }
    return results;
  }

  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  if (typeof value === 'number') {
    return [value.toString()];
  }

  if (typeof value === 'object' && value !== null) {
    const candidate = pickString(value as Record<string, unknown>, ['id', 'groundingId', 'grounding_id']);
    return candidate ? [candidate] : [];
  }

  return [];
}

function extractGroundingEntry(
  node: Record<string, unknown>,
  likelyGrounding: boolean
): UnifiedGroundingEntry | null {
  let groundingId =
    pickString(node, ['groundingId', 'grounding_id', 'groundingReference', 'grounding_reference']) ?? undefined;

  if (!groundingId && likelyGrounding) {
    groundingId = pickString(node, ['id', 'identifier']);
  }

  if (!groundingId) {
    return null;
  }

  const entry: UnifiedGroundingEntry = {
    groundingId
  };

  entry.chunkId =
    pickString(node, [
      'chunkId',
      'chunk_id',
      'chunk',
      'retrievalId',
      'retrieval_id',
      'chunkReference',
      'chunk_reference'
    ]) ?? entry.chunkId;
  entry.documentId =
    pickString(node, ['documentId', 'document_id', 'docId', 'doc_id']) ?? entry.documentId;
  entry.sourceId =
    pickString(node, ['sourceId', 'source_id', 'sourceDocumentId', 'source_document_id']) ?? entry.sourceId;

  return entry;
}

function gatherEntryCandidateKeys(entry: UnifiedGroundingEntry): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const register = (value?: string, split = true) => {
    if (!value) {
      return;
    }
    const normalized = normalizeLookupKey(value);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
    if (!split) {
      return;
    }
    const parts = value.split(/[#:@|]/);
    for (const part of parts) {
      const token = part.trim();
      if (token.length >= 3) {
        const lowered = token.toLowerCase();
        if (!seen.has(lowered)) {
          seen.add(lowered);
          candidates.push(lowered);
        }
      }
    }
  };

  register(entry.groundingId);
  register(entry.chunkId);
  register(entry.documentId);
  register(entry.sourceId);

  if (entry.citationIds) {
    entry.citationIds.forEach((citationId) => register(citationId, false));
  }

  return candidates;
}

function matchEntryToReference(
  entry: UnifiedGroundingEntry,
  index: Map<string, number[]>,
  references: Reference[]
): { index: number; refId: string } | null {
  const candidates = gatherEntryCandidateKeys(entry);

  for (const candidate of candidates) {
    const matches = index.get(candidate);
    if (matches && matches.length > 0) {
      const refIndex = matches[0];
      const ref = references[refIndex];
      const refId = (typeof ref.id === 'string' && ref.id.trim()) || `knowledge_${refIndex + 1}`;
      return { index: refIndex, refId };
    }
  }

  return null;
}

function visitUnifiedGrounding(
  node: unknown,
  state: {
    entries: Map<string, UnifiedGroundingEntry>;
    citations: Map<string, Set<string>>;
  },
  path: string[],
  depth = 0
): void {
  if (!node || depth > 40) {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => visitUnifiedGrounding(item, state, path, depth + 1));
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  const record = node as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.length) {
    return;
  }

  const lowerKeys = keys.map((key) => key.toLowerCase());
  const pathHints = path.map((segment) => segment.toLowerCase());

  const hasGroundingHint =
    pathHints.some((segment) => GROUNDING_HINTS.some((hint) => segment.includes(hint))) ||
    lowerKeys.some((key) => GROUNDING_HINTS.some((hint) => key.includes(hint)));

  if (hasGroundingHint) {
    const entry = extractGroundingEntry(record, true);
    if (entry) {
      const existing = state.entries.get(entry.groundingId);
      if (existing) {
        existing.chunkId = existing.chunkId ?? entry.chunkId;
        existing.documentId = existing.documentId ?? entry.documentId;
        existing.sourceId = existing.sourceId ?? entry.sourceId;
      } else {
        state.entries.set(entry.groundingId, entry);
      }
    }
  } else {
    const fallbackEntry = extractGroundingEntry(record, false);
    if (fallbackEntry && lowerKeys.some((key) => key.includes('ground'))) {
      const existing = state.entries.get(fallbackEntry.groundingId);
      if (existing) {
        existing.chunkId = existing.chunkId ?? fallbackEntry.chunkId;
        existing.documentId = existing.documentId ?? fallbackEntry.documentId;
        existing.sourceId = existing.sourceId ?? fallbackEntry.sourceId;
      } else {
        state.entries.set(fallbackEntry.groundingId, fallbackEntry);
      }
    }
  }

  const hasCitationHint =
    pathHints.some((segment) => CITATION_HINTS.some((hint) => segment.includes(hint))) ||
    lowerKeys.some((key) => CITATION_HINTS.some((hint) => key.includes(hint)));

  if (hasCitationHint) {
    const citationId =
      pickString(record, ['citationId', 'citation_id', 'citation', 'id', 'slot', 'index', 'name']) ?? undefined;
    const referencedIds = new Set<string>();

    const direct = pickString(record, ['groundingId', 'grounding_id']);
    if (direct) {
      referencedIds.add(direct);
    }

    for (const key of keys) {
      if (key.toLowerCase().includes('ground')) {
        const values = toStringArray(record[key]);
        values.forEach((value) => referencedIds.add(value));
      }
    }

    if (citationId && referencedIds.size > 0) {
      const bucket = state.citations.get(citationId) ?? new Set<string>();
      referencedIds.forEach((id) => bucket.add(id));
      state.citations.set(citationId, bucket);

      referencedIds.forEach((groundingId) => {
        const entry = state.entries.get(groundingId);
        if (entry) {
          if (!entry.citationIds) {
            entry.citationIds = new Set();
          }
          entry.citationIds.add(citationId);
        } else {
          state.entries.set(groundingId, {
            groundingId,
            citationIds: new Set([citationId])
          });
        }
      });
    }
  }

  keys.forEach((key) => {
    const value = record[key];
    if (value !== undefined) {
      visitUnifiedGrounding(value, state, path.concat(key), depth + 1);
    }
  });
}

function parseUnifiedGroundingSource(payload: any): unknown {
  const candidate =
    payload?.answer?.unified_grounding ??
    payload?.answer?.grounding ??
    payload?.unified_grounding ??
    payload?.grounding;

  if (!candidate) {
    return null;
  }

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }

    const attempts = [trimmed];
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      attempts.push(trimmed.slice(1, -1));
    }

    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt);
      } catch (_error) {
        // ignore parse failure and try next attempt
        continue;
      }
    }

    return null;
  }

  if (typeof candidate === 'object') {
    return candidate;
  }

  return null;
}

function applyUnifiedGrounding(
  payload: any,
  references: Reference[]
): KnowledgeAgentGroundingSummary | null {
  const parsed = parseUnifiedGroundingSource(payload);
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const state = {
    entries: new Map<string, UnifiedGroundingEntry>(),
    citations: new Map<string, Set<string>>()
  };

  visitUnifiedGrounding(parsed, state, []);

  if (state.entries.size === 0 && state.citations.size === 0) {
    return null;
  }

  const index = buildReferenceIndex(references);
  const mapping: Record<string, string> = {};
  const unmatched: string[] = [];
  const referenceGrounding = new Map<number, Set<string>>();

  state.entries.forEach((entry) => {
    const match = matchEntryToReference(entry, index, references);
    if (match) {
      mapping[entry.groundingId] = match.refId;

      if (!referenceGrounding.has(match.index)) {
        referenceGrounding.set(match.index, new Set<string>());
      }
      referenceGrounding.get(match.index)!.add(entry.groundingId);
    } else {
      unmatched.push(entry.groundingId);
    }
  });

  referenceGrounding.forEach((ids, refIndex) => {
    const ref = references[refIndex];
    const metadata = (ref.metadata ??= {});
    const store = metadata as Record<string, unknown>;
    const existing = Array.isArray(store.unifiedGroundingIds)
      ? (store.unifiedGroundingIds as string[])
      : [];
    const merged = Array.from(new Set([...existing, ...ids]));
    store.unifiedGroundingIds = merged;
  });

  const citationMap: Record<string, string[]> = {};
  state.citations.forEach((ids, citationId) => {
    citationMap[citationId] = Array.from(ids);
  });

  return {
    mapping,
    citationMap,
    unmatched
  };
}

function normalizeKnowledgeActivity(payload: any): ActivityStep[] {
  if (!Array.isArray(payload?.activity) || !payload.activity.length) {
    return [];
  }

  return payload.activity
    .map((step: any, index: number): ActivityStep | null => {
      if (!step || typeof step !== 'object') {
        return {
          type: 'knowledge_agent_activity',
          description: typeof step === 'string' ? step : JSON.stringify(step),
          timestamp: new Date().toISOString()
        };
      }

      const type =
        (typeof step.type === 'string' && step.type) ||
        (typeof step.kind === 'string' && step.kind) ||
        `knowledge_agent_step_${index + 1}`;

      const descriptionCandidate =
        (typeof step.description === 'string' && step.description) ||
        (typeof step.summary === 'string' && step.summary) ||
        (typeof step.detail === 'string' && step.detail) ||
        (typeof step.message === 'string' && step.message) ||
        null;

      const description =
        descriptionCandidate ?? JSON.stringify(stripUndefined(step), null, 2);

      const timestamp =
        (typeof step.timestamp === 'string' && step.timestamp) ||
        (typeof step.time === 'string' && step.time) ||
        new Date().toISOString();

      return { type, description, timestamp };
    })
    .filter((step): step is ActivityStep => Boolean(step));
}

function normalizeKnowledgeReferences(payload: any): Reference[] {
  const candidates = extractReferenceCandidates(payload);
  const references: Reference[] = [];
  const seen = new Set<string>();
  let index = 0;

  for (const candidate of candidates) {
    const ref = normalizeKnowledgeReference(candidate, index);
    index += 1;

    if (!ref.content || !ref.content.trim()) {
      continue;
    }

    const key =
      ref.id ??
      `${ref.url ?? ''}|${ref.page_number ?? ''}|${(ref.content ?? '').slice(0, 64)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push(ref);
  }

  return references;
}

export async function invokeKnowledgeAgent(
  options: KnowledgeAgentInvocationOptions
): Promise<KnowledgeAgentInvocationResult> {
  if (!Array.isArray(options.activity) || options.activity.length === 0) {
    throw new Error('Knowledge agent invocation requires non-empty activity history.');
  }

  const agentName = encodeURIComponent(config.AZURE_KNOWLEDGE_AGENT_NAME);
  const url = `${config.AZURE_SEARCH_ENDPOINT}/agents('${agentName}')/search?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;

  const payload = stripUndefined({
    activity: options.activity,
    options: stripUndefined({
      top: options.top ?? config.KNOWLEDGE_AGENT_TOP_K ?? config.RAG_TOP_K,
      filter: options.filter,
      includeActivity: options.includeActivity ?? config.KNOWLEDGE_AGENT_INCLUDE_ACTIVITY,
      includeReferences: options.includeReferences ?? config.KNOWLEDGE_AGENT_INCLUDE_REFERENCES,
      includeReferenceSourceData:
        options.includeReferenceSourceData ?? config.KNOWLEDGE_AGENT_INCLUDE_SOURCE_DATA,
      attemptFastPath: options.attemptFastPath ?? config.KNOWLEDGE_AGENT_ATTEMPT_FAST_PATH
    })
  });

  const { response, requestId, correlationId } = await performSearchRequest('knowledge-agent-search', url, {
    method: 'POST',
    body: payload,
    correlationId: options.correlationId
  });

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  const references = normalizeKnowledgeReferences(data);
  const grounding = applyUnifiedGrounding(data, references);
  const activity = normalizeKnowledgeActivity(data);

  if (grounding && grounding.unmatched.length > 0) {
    activity.push({
      type: 'knowledge_agent_grounding_warning',
      description: `Unified grounding parsing left ${grounding.unmatched.length} id(s) unmatched.`,
      timestamp: new Date().toISOString()
    });
  }

  const answer =
    (typeof data?.answer === 'string' && data.answer) ||
    (typeof data?.answer?.text === 'string' && data.answer.text) ||
    (typeof data?.response === 'string' && data.response) ||
    undefined;

  const usage = data?.usage ?? data?.answer?.usage;

  return {
    references,
    activity,
    answer,
    usage,
    raw: data,
    requestId,
    correlationId,
    grounding: grounding ?? undefined
  };
}
