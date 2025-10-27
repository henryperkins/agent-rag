import type {
  ActivityStep,
  AgentMessage,
  ChatResponse,
  CriticReport,
  OrchestratorTools,
  RetrievalDiagnostics,
  RetrievalAttemptedMode,
  RetrievalKind,
  LazyReference,
  Reference,
  RouteMetadata,
  SessionEvaluation,
  SessionTrace,
  WebResult,
  FeatureOverrideMap,
  FeatureSelectionMetadata
} from '../../../shared/types.js';
import { compactHistory } from './compact.js';
import type { SalienceNote } from './compact.js';
import { budgetSections, estimateTokens } from './contextBudget.js';
import { getPlan } from './plan.js';
import { dispatchTools, buildWebContext } from './dispatch.js';
import { evaluateAnswer } from './critique.js';
import { config } from '../config/app.js';
import { createResponseStream, type Includable } from '../azure/openaiClient.js';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { getTracer, traced } from './telemetry.js';
import { loadMemory, upsertMemory } from './memoryStore.js';
import type { SummaryBullet } from './memoryStore.js';
import { semanticMemoryStore } from './semanticMemoryStore.js';
import { assessComplexity, decomposeQuery, executeSubQueries } from './queryDecomposition.js';
import { retrieveTool, answerTool, webSearchTool, lazyRetrieveTool } from '../tools/index.js';
import { selectSummaryBullets } from './summarySelector.js';
import { buildSessionEvaluation } from './evaluationTelemetry.js';
import { classifyIntent, getRouteConfig } from './router.js';
import type { RouteConfig } from './router.js';
import { loadFullContent, identifyLoadCandidates } from '../azure/lazyRetrieval.js';
import { trackCitationUsage } from './citationTracker.js';
import { resolveFeatureToggles, type FeatureGates } from '../config/features.js';
import { sanitizeUserField } from '../utils/session.js';
import { extractReasoningSummary } from '../utils/openai.js';
import { getReasoningOptions } from '../config/reasoning.js';
import { validateCitationIntegrity } from '../utils/citation-validator.js';

type ExecMode = 'sync' | 'stream';

/**
 * Canonicalize URL by removing tracking parameters and normalizing format
 * to improve deduplication across different sources
 */
function canonicalUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    u.hash = '';
    // Remove common tracking parameters
    const keep = new URLSearchParams();
    for (const [key, value] of new URL(raw).searchParams) {
      // Keep essential params, drop tracking junk (utm_*, fbclid, etc.)
      if (!/^(utm_|fbclid|gclid|msclkid|mc_|_ga)/.test(key)) {
        keep.set(key, value);
      }
    }
    u.search = keep.toString();
    u.host = u.host.toLowerCase();
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Build numbered references block for citation context
 * This ensures the model sees the same numbered format it's asked to cite
 */
function buildReferencesBlock(citations: Reference[]): string {
  if (!citations?.length) return '';
  const lines = citations.map((c, i) => {
    const title = c.title?.trim() || c.url || c.id || `Source ${i + 1}`;
    const url = c.url ? ` — ${c.url}` : '';
    const meta = c.metadata?.publishedDate ? ` (${c.metadata.publishedDate})` : '';
    return `[${i + 1}] ${title}${meta}${url}`;
  });
  return `### References\n${lines.join('\n')}`;
}

function mergeCitations(references: Reference[], webResults: WebResult[], cap = 24): Reference[] {
  if (!webResults.length) {
    return references.slice(0, cap);
  }

  const merged: Reference[] = [];
  const seen = new Set<string>();

  const push = (ref: Reference) => {
    const key = (ref.id as string) || canonicalUrl(ref.url) || ref.title || Math.random().toString(36);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(ref);
  };

  // Add retrieval references first
  for (const r of references) {
    push(r);
  }

  // Add web results sorted by rank
  const sortedWeb = [...webResults].sort(
    (a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER)
  );

  for (const w of sortedWeb) {
    push({
      id: w.id || canonicalUrl(w.url),
      title: w.title,
      content: w.body ?? w.snippet,
      url: w.url,
      sourceType: 'web',
      score: w.relevance,
      metadata: {
        snippet: w.snippet,
        fetchedAt: w.fetchedAt,
        rank: w.rank,
        source: w.source,
        authors: w.authors,
        publishedDate: w.publishedDate,
        citationCount: w.citationCount,
        influentialCitationCount: w.influentialCitationCount,
        authorityScore: w.authorityScore,
        isOpenAccess: w.isOpenAccess,
        pdfUrl: w.pdfUrl,
        venue: w.venue,
        category: w.category
      }
    });

    if (merged.length >= cap) break;
  }

  return merged;
}

/**
 * Build ordered citations list from dispatch enumeration metadata
 * This ensures the citation numbers shown to the model match what the validator checks
 */
function citationsFromEnumeration(
  meta: import('../../../shared/types.js').CitationMetadata,
  retrieval: Reference[],
  web: WebResult[]
): Reference[] {
  const ordered: Reference[] = [];

  const toRef = (w: WebResult): Reference => ({
    id: w.id ?? w.url ?? `web-${ordered.length}`,
    title: w.title,
    content: w.body ?? w.snippet ?? '',
    url: w.url,
    sourceType: 'web',
    score: w.relevance,
    metadata: {
      snippet: w.snippet,
      fetchedAt: w.fetchedAt,
      rank: w.rank,
      source: w.source,
      authors: w.authors,
      publishedDate: w.publishedDate,
      citationCount: w.citationCount,
      influentialCitationCount: w.influentialCitationCount,
      authorityScore: w.authorityScore,
      isOpenAccess: w.isOpenAccess,
      pdfUrl: w.pdfUrl,
      venue: w.venue,
      category: w.category
    }
  });

  const nums = Object.keys(meta.citationMap)
    .map(Number)
    .sort((a, b) => a - b);

  for (const n of nums) {
    const m = meta.citationMap[n];
    if (!m) continue;
    if (m.source === 'retrieval') {
      const r = retrieval[m.index];
      if (r) ordered.push(r);
    } else {
      const w = web[m.index];
      if (w) ordered.push(toRef(w));
    }
  }

  return ordered;
}

export interface RunSessionOptions {
  messages: AgentMessage[];
  mode: ExecMode;
  sessionId: string;
  emit?: (event: string, data: unknown) => void;
  tools?: Partial<OrchestratorTools>;
  featureOverrides?: FeatureOverrideMap | null;
  persistedFeatures?: FeatureOverrideMap | null;
}

const defaultTools: OrchestratorTools = {
  retrieve: (args) => retrieveTool(args),
  lazyRetrieve: (args) => lazyRetrieveTool(args),
  webSearch: (args) => webSearchTool({ mode: config.WEB_SEARCH_MODE, ...args }),
  answer: (args) => answerTool(args),
  critic: (args) => evaluateAnswer(args)
};

interface GenerateAnswerResult {
  answer: string;
  events: ActivityStep[];
  usedFullContent: boolean;
  contextText: string;
  responseId?: string;
  reasoningSummary?: string;
}

function mergeSalienceForContext(existing: SalienceNote[], fresh: SalienceNote[]) {
  const map = new Map<string, SalienceNote>();
  for (const note of existing) {
    map.set(note.fact, note);
  }
  for (const note of fresh) {
    map.set(note.fact, note);
  }
  return [...map.values()].sort((a, b) => (b.lastSeenTurn ?? 0) - (a.lastSeenTurn ?? 0));
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined;
}

function min(values: number[]) {
  return values.length ? Math.min(...values) : undefined;
}

function max(values: number[]) {
  return values.length ? Math.max(...values) : undefined;
}

const DEFAULT_INTENT_MODELS: Record<string, string> = {
  faq: 'gpt-5',
  research: 'gpt-5',
  factual_lookup: 'gpt-5',
  conversational: 'gpt-5'
};

const INTENT_MODEL_ENV_VARS: Record<string, string | undefined> = {
  faq: process.env.MODEL_FAQ,
  research: process.env.MODEL_RESEARCH,
  factual_lookup: process.env.MODEL_FACTUAL,
  conversational: process.env.MODEL_CONVERSATIONAL
};

// F-003: Enhanced model resolution with tracking
interface ModelResolution {
  actualModel: string;
  source: 'route_config' | 'env_override' | 'fallback_default';
  overridden: boolean;
}

function resolveModelDeployment(intent: string, routeConfig: RouteConfig): ModelResolution {
  const defaultModel = DEFAULT_INTENT_MODELS[intent] ?? DEFAULT_INTENT_MODELS.research;
  const envOverride = INTENT_MODEL_ENV_VARS[intent];
  const candidate = routeConfig.model?.trim();

  // Apply env override if present (highest priority)
  if (envOverride?.trim()) {
    return {
      actualModel: envOverride.trim(),
      source: 'env_override',
      overridden: true
    };
  }

  // Use route-suggested model if provided
  if (candidate) {
    return {
      actualModel: candidate,
      source: 'route_config',
      overridden: false
    };
  }

  // Fallback to config deployment
  const fallbackModel = config.AZURE_OPENAI_GPT_DEPLOYMENT;
  if (!fallbackModel?.trim()) {
    throw new Error(
      `No valid model deployment found for intent '${intent}': ` +
      `config.AZURE_OPENAI_GPT_DEPLOYMENT is missing and no route/env override provided. ` +
      `Please set AZURE_OPENAI_GPT_DEPLOYMENT in environment or configure intent-specific model.`
    );
  }

  return {
    actualModel: fallbackModel.trim(),
    source: 'fallback_default',
    overridden: candidate === defaultModel || !candidate
  };
}

function latestQuestion(messages: AgentMessage[]) {
  return [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
}

async function generateAnswer(
  mode: ExecMode,
  question: string,
  contextText: string,
  tools: OrchestratorTools,
  routeConfig: RouteConfig,
  modelDeployment: string,
  featureStates: FeatureOverrideMap,
  emit?: (event: string, data: unknown) => void,
  revisionNotes?: string[],
  lazyRefs: LazyReference[] = [],
  previousResponseId?: string,
  sessionId?: string,
  intentHint?: string,
  citations?: Reference[]
): Promise<GenerateAnswerResult> {
  const routePromptHint = routeConfig.systemPromptHints ? `${routeConfig.systemPromptHints}\n\n` : '';
  const basePrompt = `${routePromptHint}Respond using ONLY the provided context. Cite evidence inline as [1], [2], etc. Say "I do not know" if grounding is insufficient.\n\nReview every section in the context (Knowledge Agent Summary, Retrieved Knowledge, Retrieval Insights, Salience Signals, Web Context, Memory Context) and integrate relevant details. Treat any Knowledge Agent Summary as guidance—verify its claims against the numbered sources before citing.`;

  const hasLazyReferences = lazyRefs.length > 0;
  const lazyContext = hasLazyReferences
    ? lazyRefs
        .map((ref, index) => {
          const body = ref.content ?? ref.summary ?? '';
          return `[${index + 1}] ${body}`;
        })
        .join('\n\n')
    : '';
  const supplementalContext = hasLazyReferences ? (contextText?.trim() ?? '') : contextText;
  const activeContext = hasLazyReferences
    ? [lazyContext, supplementalContext].filter((segment) => segment && segment.length > 0).join('\n\n')
    : supplementalContext;
  const usedFullContent = hasLazyReferences && lazyRefs.some((ref) => ref.isSummary === false);
  const hasNumberedSources = /\[\d+\]/.test(activeContext ?? '');

  if (!activeContext?.trim()) {
    const fallbackAnswer = 'I do not know. (No grounded evidence retrieved)';
    if (mode === 'stream') {
      emit?.('token', { content: fallbackAnswer });
    }
    return { answer: fallbackAnswer, events: [], usedFullContent, contextText: activeContext, reasoningSummary: undefined };
  }

  const stage = hasLazyReferences
    ? usedFullContent
      ? 'generating_full'
      : 'generating_from_summaries'
    : 'generating';

  const instructions = [
    'Review each available section in the context (Knowledge Agent Summary, Retrieved Knowledge, Retrieval Insights, Salience Signals, Web Context, Memory Context).',
    'Synthesize information across sections to create a comprehensive answer.',
    'Highlight agreements, contradictions, or gaps when they matter to the question.'
  ];

  // Build numbered references block so model sees the exact format it should cite
  // P0 Fix: Only append references if not already in context (from dispatch.citationMetadata)
  const hasReferencesInContext = /###\s+References/i.test(activeContext);
  const referencesBlock =
    !hasReferencesInContext && citations && citations.length > 0 ? buildReferencesBlock(citations) : '';

  if (referencesBlock || hasNumberedSources || hasReferencesInContext) {
    instructions.push('Cite the numbered sources for every factual statement.');
    instructions.push('Only use a citation number [n] if the corresponding source [n] appears in the References section.');
  } else {
    instructions.push('If no numbered sources are available, clearly state the limitations before answering.');
  }

  let userPrompt = `Question: ${question}\n\nInstructions:\n- ${instructions.join('\n- ')}\n`;
  if (revisionNotes && revisionNotes.length > 0) {
    userPrompt += `\nRevision guidance (address these issues):\n${revisionNotes.map((note, i) => `${i + 1}. ${note}`).join('\n')}`;
  }

  // Append context with numbered references at the end for clarity
  const contextSections = [activeContext];
  if (referencesBlock) {
    contextSections.push(referencesBlock);
  }
  userPrompt += `\n\nContext:\n${contextSections.join('\n\n')}`;

  if (mode === 'stream') {
    const extractStreamText = (payload: unknown): string => {
      if (!payload) {
        return '';
      }

      if (typeof payload === 'string') {
        return payload;
      }

      if (Array.isArray(payload)) {
        return payload.map((item) => extractStreamText(item)).join('');
      }

      if (typeof payload === 'object') {
        const candidate = payload as Record<string, unknown>;
        const textValue = candidate.text;
        if (typeof textValue === 'string') {
          return textValue;
        }
        const deltaValue = candidate.delta;
        if (typeof deltaValue === 'string') {
          return deltaValue;
        }
        const outputText = candidate.output_text;
        if (typeof outputText === 'string') {
          return outputText;
        }
        if (Array.isArray(candidate.content)) {
          return candidate.content
            .map((part) => {
              if (typeof part === 'string') {
                return part;
              }
              if (typeof part === 'object' && part) {
                const partRecord = part as Record<string, unknown>;
                if (typeof partRecord.text === 'string') {
                  return partRecord.text;
                }
                if (typeof partRecord.output_text === 'string') {
                  return partRecord.output_text;
                }
              }
              return '';
            })
            .join('');
        }
        if (Array.isArray(candidate.output)) {
          return candidate.output.map((item) => extractStreamText(item)).join('');
        }
        if (candidate.response) {
          const response = candidate.response as Record<string, unknown>;
          const responseText =
            extractStreamText(response['output_text']) || extractStreamText(response['output']);
          if (responseText) {
            return responseText;
          }
        }
        if (candidate.output_item) {
          const outputItem = candidate.output_item as Record<string, unknown>;
          return (
            extractStreamText(outputItem['output_text']) || extractStreamText(outputItem['content'])
          );
        }
      }

      return '';
    };

    const reasoningConfig = getReasoningOptions('synthesis');
    const includeFields: Includable[] = [];

    // Request reasoning content if reasoning is enabled
    if (reasoningConfig) {
      includeFields.push('reasoning.encrypted_content');
    }

    const reader = await createResponseStream({
      messages: [
        { role: 'system', content: basePrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      model: modelDeployment,
      max_output_tokens: routeConfig.maxTokens,
      parallel_tool_calls: config.RESPONSES_PARALLEL_TOOL_CALLS,
      reasoning: reasoningConfig,
      include: includeFields.length > 0 ? includeFields : undefined,
      // NOTE: Azure OpenAI doesn't support stream_options.include_usage yet
      // stream_options: { include_usage: config.RESPONSES_STREAM_INCLUDE_USAGE },
      textFormat: { type: 'text' },
      truncation: 'auto',
      store: featureStates.ENABLE_RESPONSE_STORAGE ?? config.ENABLE_RESPONSE_STORAGE,
      metadata: {
        sessionId: sessionId ?? '',
        intent: intentHint ?? '',
        routeModel: routeConfig.model ?? ''
      },
      user: sanitizeUserField(sessionId ?? 'unknown'),
      // Only send previous_response_id when storage is enabled, using resolved feature flag
      ...((featureStates.ENABLE_RESPONSE_STORAGE ?? config.ENABLE_RESPONSE_STORAGE) && previousResponseId ? { previous_response_id: previousResponseId } : {})
    });

    let answer = '';
    const decoder = new TextDecoder();
    let successfulChunks = 0;
    let responseId: string | undefined;
    const reasoningSnippets: string[] = [];
    const seenReasoning = new Set<string>();
    const reasoningBuffers = new Map<string, string>();

    const publishReasoningSnippet = (raw: string | undefined) => {
      if (typeof raw !== 'string') {
        return;
      }
      const normalized = raw.replace(/\s+/g, ' ').trim();
      if (!normalized || seenReasoning.has(normalized)) {
        return;
      }
      seenReasoning.add(normalized);
      reasoningSnippets.push(normalized);
      emit?.('activity', {
        steps: [
          {
            type: 'insight',
            description: `[Synthesis] ${normalized}`,
            timestamp: new Date().toISOString()
          }
        ]
      });
    };

    const publishFromPayload = (payload: unknown) => {
      const summary = extractReasoningSummary(payload);
      if (!summary?.length) {
        return;
      }
      for (const entry of summary) {
        publishReasoningSnippet(entry);
      }
    };

    const reasoningKey = (event: Record<string, unknown>) => {
      const itemId = typeof event.item_id === 'string' ? event.item_id : 'primary';
      const outputIndex =
        typeof event.output_index === 'number' && Number.isFinite(event.output_index)
          ? event.output_index
          : 0;
      const summaryIndex =
        typeof event.summary_index === 'number' && Number.isFinite(event.summary_index)
          ? event.summary_index
          : 0;
      const contentIndex =
        typeof event.content_index === 'number' && Number.isFinite(event.content_index)
          ? event.content_index
          : 0;
      return `${itemId}:${outputIndex}:${summaryIndex}:${contentIndex}`;
    };

    const mergeIntoBuffer = (key: string, fragment: string) => {
      const existing = reasoningBuffers.get(key) ?? '';
      reasoningBuffers.set(key, `${existing}${fragment}`);
    };

    const flushBuffer = (key: string, tail?: string) => {
      const existing = reasoningBuffers.get(key);
      const combined = `${existing ?? ''}${tail ?? ''}`.replace(/\s+/g, ' ').trim();
      reasoningBuffers.delete(key);
      if (!combined) {
        return;
      }
      publishReasoningSnippet(combined);
    };

    const publishResponseEvents = (response: Record<string, unknown>) => {
      if (!response || !Array.isArray(response.output)) {
        return;
      }
      for (const item of response.output as unknown[]) {
        publishFromPayload(item);
      }
    };

    const handleReasoningEvent = (event: Record<string, unknown>): boolean => {
      const type = typeof event.type === 'string' ? event.type : undefined;
      if (!type) {
        return false;
      }

      if (type === 'response.reasoning_summary_text.delta') {
        const key = reasoningKey(event);
        if (typeof event.delta === 'string') {
          mergeIntoBuffer(key, event.delta);
        } else if (event.delta) {
          const fragments = extractReasoningSummary(event.delta);
          if (fragments?.length) {
            mergeIntoBuffer(key, fragments.join(' '));
          }
        }
        return true;
      }

      if (type === 'response.reasoning_summary_text.done') {
        const key = reasoningKey(event);
        if (typeof event.text === 'string') {
          flushBuffer(key, event.text);
        } else {
          const fragments = extractReasoningSummary(event.text ?? event);
          if (fragments?.length) {
            flushBuffer(key, fragments.join(' '));
          } else {
            flushBuffer(key);
          }
        }
        return true;
      }

      if (
        type === 'response.reasoning_summary.delta' ||
        type === 'response.reasoning_summary.done' ||
        type === 'response.reasoning_summary_part.added' ||
        type === 'response.reasoning_summary_part.done' ||
        type === 'response.reasoning.delta' ||
        type === 'response.reasoning.done'
      ) {
        publishFromPayload(event);
        return true;
      }

      return false;
    };

    emit?.('status', { stage });

    let completed = false;
    let buffer = '';
    const hasCitations = Array.isArray(citations) && citations.length > 0;

    // Citation validation buffer for streaming mode
    const CITATION_VALIDATION_WINDOW = 150;
    let citationBuffer = '';
    const validateBufferedCitations = () => {
      if (!hasCitations || citationBuffer.length < CITATION_VALIDATION_WINDOW) {
        return true;
      }
      const isValid = validateCitationIntegrity(citationBuffer, citations);
      if (!isValid) {
        emit?.('warning', {
          type: 'citation_integrity',
          message: 'Invalid citations detected during streaming. Aborting.'
        });
        return false;
      }
      // Keep overlap for next validation window
      citationBuffer = citationBuffer.slice(-50);
      return true;
    };

    const handleLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        return;
      }

      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        return;
      }

      try {
        const delta = JSON.parse(payload);
        const type = typeof delta.type === 'string' ? delta.type : undefined;

        // Diagnostic logging for event types
        if (type && !type.includes('reasoning')) {
          console.log('[Streaming Event Type]', { type, keys: Object.keys(delta).join(',') });
        }

        if (delta && typeof delta === 'object') {
          if (!handleReasoningEvent(delta as Record<string, unknown>)) {
            publishFromPayload(delta);
          }
        }

        if (delta?.reasoning) {
          publishFromPayload(delta.reasoning);
        }
        if (delta?.response?.reasoning) {
          publishFromPayload(delta.response.reasoning);
        }

        if (type === 'response.output_text.delta') {
          const content =
            extractStreamText(delta.delta) ||
            extractStreamText(delta.output_text) ||
            extractStreamText(delta);
          if (typeof delta?.response?.id === 'string') {
            responseId = delta.response.id;
          }
          if (typeof (delta as Record<string, unknown>)?.id === 'string') {
            responseId = (delta as Record<string, unknown>).id as string;
          }
          if (content) {
            successfulChunks++;
            answer += content;
            citationBuffer += content;
            // Validate citations during streaming
            if (!validateBufferedCitations()) {
              answer = 'I do not know. (Citation validation failed during streaming)';
              await abortAndFinish();
              return;
            }
            emit?.('token', { content });
          }
          return;
        }

        if (type === 'response.output_text.done') {
          if (typeof delta?.response?.id === 'string') {
            responseId = delta.response.id;
          }
          if (typeof (delta as Record<string, unknown>)?.id === 'string') {
            responseId = (delta as Record<string, unknown>).id as string;
          }
          if (delta.response) {
            publishFromPayload(delta.response);
          }
          const text =
            extractStreamText(delta.text) ||
            extractStreamText(delta.delta) ||
            extractStreamText(delta.response);
          if (text) {
            answer += text;
            emit?.('token', { content: text });
          }
          return;
        }

        if (
          type === 'response.output_item.added' ||
          type === 'response.output_item.delta' ||
          type === 'response.output_item.done'
        ) {
          const item = delta.output_item ?? delta.delta ?? delta;
          publishFromPayload(item);
          if (item && typeof item === 'object' && (item as { type?: string }).type === 'reasoning') {
            return;
          }
          const text = extractStreamText(item);
          if (typeof delta?.response?.id === 'string') {
            responseId = delta.response.id;
          }
          if (text) {
            successfulChunks++;
            answer += text;
            emit?.('token', { content: text });
          }
          return;
        }

        if (type === 'response.delta') {
          if (delta.delta) {
            publishFromPayload(delta.delta);
          }
          if (delta.response) {
            publishFromPayload(delta.response);
          }
          const text = extractStreamText(delta.delta);
          if (typeof delta?.response?.id === 'string') {
            responseId = delta.response.id;
          }
          if (text) {
            successfulChunks++;
            answer += text;
            emit?.('token', { content: text });
          }
          return;
        }

        if (type === 'response.usage') {
          const usage = delta.response?.usage ?? delta.usage;
          if (usage) {
            emit?.('usage', usage);
          }
          return;
        }

        if (delta?.response?.usage) {
          emit?.('usage', delta.response.usage);
        }

        if (type === 'response.completed') {
          if (!answer && typeof delta.response?.output_text === 'string') {
            answer = delta.response.output_text;
          }
          if (typeof delta.response?.id === 'string') {
            responseId = delta.response.id;
          }
          publishFromPayload(delta.response);
          for (const key of [...reasoningBuffers.keys()]) {
            flushBuffer(key);
          }
          if (delta.response?.usage) {
            emit?.('usage', delta.response.usage);
          }
          if (delta.response?.output) {
            publishResponseEvents(delta.response);
          }
          completed = true;
        }
      } catch (parseError) {
        // Log malformed chunks for debugging
        console.error('[Streaming Parse Error]', {
          error: parseError instanceof Error ? parseError.message : String(parseError),
          payload: payload.slice(0, 200), // Log first 200 chars
          rawLine: rawLine.slice(0, 200)
        });
      }
    };

    // Track cancellation state for resource cleanup
    let cancelled = false;

    const abortAndFinish = async () => {
      try {
        await reader.cancel?.();
      } catch {
        // Ignore cancellation errors
      }
      completed = true;
      cancelled = true;
    };

    // SSE frame accumulator for multi-line data: events
    let sseFrame: string[] = [];

    const processSSEFrame = (frame: string[]) => {
      const payload = frame.map((l) => l.slice(5).trim()).join('\n');
      if (!payload || payload === '[DONE]') return;

      try {
        const delta = JSON.parse(payload);
        handleLine(`data: ${JSON.stringify(delta)}`);
      } catch (_e) {
        // Silently ignore malformed JSON in production
      }
    };

    // Log first few non-reasoning payloads for debugging
    let debugLogCount = 0;
    const MAX_DEBUG_LOGS = 5;

    const processBuffer = (flush = false) => {
      while (true) {
        const nl = buffer.indexOf('\n');
        if (nl === -1) {
          if (flush && sseFrame.length) {
            processSSEFrame(sseFrame);
            sseFrame = [];
          }
          break;
        }

        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);

        // Blank line ends an SSE frame
        if (!line) {
          if (sseFrame.length) {
            processSSEFrame(sseFrame);
            sseFrame = [];
          }
          continue;
        }

        // Ignore comments/heartbeats
        if (line.startsWith(':')) continue;
        // Ignore event: lines (not used in current implementation)
        if (line.startsWith('event:')) continue;

        // Accumulate data: lines into frame
        if (line.startsWith('data:')) {
          // Debug logging for first few events
          if (debugLogCount < MAX_DEBUG_LOGS) {
            const payload = line.slice(5).trim();
            if (payload && payload !== '[DONE]') {
              try {
                const delta = JSON.parse(payload);
                const type = typeof delta.type === 'string' ? delta.type : undefined;
                if (type && !type.includes('reasoning')) {
                  console.log('[Debug Payload Sample]', JSON.stringify(delta).slice(0, 500));
                  debugLogCount++;
                }
              } catch {
                // Ignore JSON parse errors for debug logging
              }
            }
          }

          sseFrame.push(line);
          continue;
        }

        if (completed || cancelled) {
          buffer = '';
          break;
        }
      }
    };

    let chunkCount = 0;
    while (!completed && !cancelled) {
      const { value, done } = await reader.read();
      if (done || cancelled) {
        console.log(`[Streaming] Completed after ${chunkCount} chunks`, {
          totalChunks: chunkCount,
          successfulChunks,
          answerLength: answer.length,
          answerPreview: answer.slice(0, 150)
        });
        buffer += decoder.decode();
        processBuffer(true);
        break;
      }

      chunkCount++;
      buffer += decoder.decode(value, { stream: true });
      processBuffer();
    }

    if (!answer && successfulChunks === 0) {
      console.error('[Streaming Failed]', {
        completed,
        bufferLength: buffer.length,
        responseId,
        reasoningSnippets: reasoningSnippets.length
      });
      throw new Error('Streaming failed: no valid chunks received from Azure OpenAI. Check backend logs for parse errors.');
    }

    if (hasCitations) {
      console.log('[Citation Validation]', {
        answerLength: answer.length,
        answerPreview: answer.slice(0, 300),
        citationsCount: citations?.length || 0,
        hasCitationMarkers: /\[\d+\]/.test(answer)
      });
      const citationValid = validateCitationIntegrity(answer, citations);
      if (!citationValid) {
        const failureMessage = 'I do not know. (Citation validation failed)';
        console.error('[Citation Validation Failed]', {
          reason: /\[\d+\]/.test(answer) ? 'Invalid citation references' : 'No citation markers found',
          answerHadContent: answer.length > 0,
          successfulChunks
        });
        emit?.('warning', {
          type: 'citation_integrity',
          message: 'Invalid citations detected in streamed response.'
        });
        if (successfulChunks > 0) {
          emit?.('token', {
            content: '\n\n[System Notice: Citation validation failed. Response rejected.]'
          });
        }
        answer = failureMessage;
      }
    }

    const reasoningSummary = reasoningSnippets.length > 0 ? reasoningSnippets.join(' ') : undefined;
    return { answer, events: [], usedFullContent, contextText: activeContext, responseId, reasoningSummary };
  }

  emit?.('status', { stage });
  const result = await tools.answer({
    question,
    context: activeContext,
    revisionNotes,
    model: modelDeployment,
    maxTokens: routeConfig.maxTokens,
    systemPrompt: basePrompt,
    temperature: 0.4,
    previousResponseId,
    features: featureStates,
    sessionId,
    userId: sessionId,
    intent: intentHint
  });

  const answer = result?.answer?.trim() ? result.answer : 'I do not know.';
  return {
    answer,
    events: [],
    usedFullContent,
    contextText: activeContext,
    responseId: result?.responseId,
    reasoningSummary: result?.reasoningSummary
  };
}

async function buildContextSections(
  compacted: Awaited<ReturnType<typeof compactHistory>>,
  memorySummary: SummaryBullet[],
  memorySalience: SalienceNote[],
  question: string,
  features: FeatureGates
) {
  const historyText = compacted.latest.map((m) => `${m.role}: ${m.content}`).join('\n');

  const candidateMap = new Map<string, SummaryBullet>();
  for (const entry of memorySummary) {
    const text = entry.text?.trim();
    if (!text) {
      continue;
    }
    candidateMap.set(text, { text, embedding: entry.embedding ? [...entry.embedding] : undefined });
  }
  for (const summary of compacted.summary) {
    const text = summary?.trim();
    if (!text) {
      continue;
    }
    if (!candidateMap.has(text)) {
      candidateMap.set(text, { text });
    }
  }

  const summaryCandidates = Array.from(candidateMap.values());
  const selection = await selectSummaryBullets(question, summaryCandidates, config.CONTEXT_MAX_SUMMARY_ITEMS, {
    semanticEnabled: features.semanticSummary
  });

  const combinedSummary = selection.selected.map((item) => `- ${item.text}`).join('\n');
  const combinedSalience = mergeSalienceForContext(memorySalience, compacted.salience)
    .slice(0, config.CONTEXT_MAX_SALIENCE_ITEMS)
    .map((note) => `- ${note.fact}`)
    .join('\n');

  return {
    historyText,
    summaryText: combinedSummary,
    salienceText: combinedSalience,
    summaryCandidates: selection.candidates,
    summaryStats: selection.stats
  };
}

export async function runSession(options: RunSessionOptions): Promise<ChatResponse> {
  const { messages, mode, emit } = options;
  const featureResolution = resolveFeatureToggles({
    overrides: options.featureOverrides,
    persisted: options.persistedFeatures
  });
  const features = featureResolution.gates;
  const featureMetadata: FeatureSelectionMetadata = {
    resolved: featureResolution.resolved
  };
  if (featureResolution.overrides) {
    featureMetadata.overrides = featureResolution.overrides;
  }
  if (featureResolution.persisted) {
    featureMetadata.persisted = featureResolution.persisted;
  }
  featureMetadata.sources = featureResolution.sources;

  const tools: OrchestratorTools = {
    ...defaultTools,
    ...(options.tools ?? {})
  };
  emit?.('features', {
    resolved: featureResolution.resolved,
    sources: featureResolution.sources,
    overrides: featureResolution.overrides,
    persisted: featureResolution.persisted
  });

  const stageInsights: ActivityStep[] = [];
  const seenInsights = new Set<string>();
  const pushInsight = (stage: string, details?: string | string[]) => {
    if (!details) {
      return;
    }
    const items = Array.isArray(details) ? details : [details];
    for (const item of items) {
      if (!item) {
        continue;
      }
      const text = typeof item === 'string' ? item.trim() : String(item).trim();
      if (!text) {
        continue;
      }
      const key = `${stage}:${text}`;
      if (seenInsights.has(key)) {
        continue;
      }
      seenInsights.add(key);
      const label = stage.replace(/_/g, ' ');
      const step: ActivityStep = {
        type: 'insight',
        description: `[${label.charAt(0).toUpperCase()}${label.slice(1)}] ${text}`,
        timestamp: new Date().toISOString()
      };
      stageInsights.push(step);
      emit?.('activity', { steps: [step] });
    }
  };

  const startedAt = Date.now();

  const tracer = getTracer();
  const sessionSpan = tracer.startSpan('execute_task', {
    attributes: {
      'gen_ai.system': 'agent_orchestrator',
      'gen_ai.request.id': options.sessionId,
      'gen_ai.request.type': 'agent',
      'session.mode': mode
    }
  });

  return await context.with(trace.setSpan(context.active(), sessionSpan), async () => {
    try {
      const question = latestQuestion(messages);
      emit?.('status', { stage: 'intent_classification' });
      const intentResult = features.intentRouting
        ? await traced('agent.intent_resolution', () => classifyIntent(question, messages.slice(-6), { enabled: true }))
        : {
            intent: 'research',
            confidence: 1,
            reasoning: 'Intent routing disabled',
            summaries: undefined
          };
      const { intent, confidence: intentConfidence, reasoning: intentReasoning, summaries: intentSummaries } = intentResult;
      pushInsight('intent', [intentReasoning, ...(intentSummaries ?? [])]);
      const routeConfig = getRouteConfig(intent);

      // F-003: Resolve model deployment with tracking
      const modelResolution = resolveModelDeployment(intent, routeConfig);
      const modelDeployment = modelResolution.actualModel;

      const routeMetadata: RouteMetadata = {
        intent,
        confidence: intentConfidence,
        reasoning: intentReasoning,
        insights: intentSummaries,
        model: routeConfig.model, // Keep for backward compatibility
        configuredModel: routeConfig.model, // F-003: Configured model from route
        actualModel: modelResolution.actualModel, // F-003: Resolved deployment
        modelResolution: {
          source: modelResolution.source,
          overridden: modelResolution.overridden
        },
        retrieverStrategy: routeConfig.retrieverStrategy,
        maxTokens: routeConfig.maxTokens
      };
      sessionSpan.setAttribute('agent.route.intent', intent);
      sessionSpan.setAttribute('agent.route.model', routeConfig.model);
      sessionSpan.setAttribute('agent.route.actual_model', modelResolution.actualModel); // F-003
      emit?.('route', routeMetadata);

      emit?.('status', { stage: 'context' });

      const compacted = await traced('agent.state.compaction', () => compactHistory(messages));
      if (compacted.insights?.length) {
        pushInsight('context', compacted.insights);
      }
      const memorySnapshot = loadMemory(options.sessionId);
      const { historyText, summaryText, salienceText, summaryCandidates, summaryStats } = await buildContextSections(
        compacted,
        memorySnapshot.summaryBullets,
        memorySnapshot.salience,
        question,
        features
      );
      upsertMemory(options.sessionId, messages.length, compacted, summaryCandidates);

      const summarySection = summaryText;
      let salienceSection = salienceText;
      let memoryContextBlock = '';
      let memoryContextAugmented = '';
      let recalledMemories: Awaited<ReturnType<typeof semanticMemoryStore.recallMemories>> = [];

      if (features.semanticMemory && question.trim()) {
        recalledMemories = await semanticMemoryStore.recallMemories(question, {
          k: config.SEMANTIC_MEMORY_RECALL_K,
          sessionId: options.sessionId,
          minSimilarity: config.SEMANTIC_MEMORY_MIN_SIMILARITY,
          maxAgeDays: config.SEMANTIC_MEMORY_PRUNE_AGE_DAYS
        });

        if (recalledMemories && recalledMemories.length) {
          memoryContextBlock = recalledMemories
            .map((memory, idx) => `Memory ${idx + 1}: ${memory.text}`)
            .join('\n');
          memoryContextAugmented = `Relevant memories:\n${memoryContextBlock}`;

          salienceSection = salienceSection ? `${salienceSection}\n\n${memoryContextAugmented}` : memoryContextAugmented;

          emit?.('semantic_memory', {
            recalled: recalledMemories.length,
            memories: recalledMemories.map((memory) => ({
              type: memory.type,
              similarity: memory.similarity,
              preview: memory.text.slice(0, 120)
            }))
          });
        }
      }

      const sections = budgetSections({
        model: config.AZURE_OPENAI_GPT_MODEL_NAME,
        sections: {
          history: historyText,
          summary: summarySection,
          salience: salienceSection
        },
        caps: {
          history: config.CONTEXT_HISTORY_TOKEN_CAP,
          summary: config.CONTEXT_SUMMARY_TOKEN_CAP,
          salience: config.CONTEXT_SALIENCE_TOKEN_CAP
        }
      });

      emit?.('context', {
        history: sections.history,
        summary: sections.summary,
        salience: sections.salience
      });

      const contextBudget: {
        history_tokens: number;
        summary_tokens: number;
        salience_tokens: number;
        web_tokens?: number;
      } = {
        history_tokens: estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, sections.history),
        summary_tokens: estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, sections.summary),
        salience_tokens: estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, sections.salience)
      };

      let decompositionApplied = false;
      let decompositionResult: Awaited<ReturnType<typeof decomposeQuery>> | undefined;
      let decompositionContextText = '';
      let decompositionReferences: Reference[] = [];
      let decompositionWebResults: WebResult[] = [];
      const decompositionActivity: ActivityStep[] = [];
      let complexityAssessment: Awaited<ReturnType<typeof assessComplexity>> | undefined;

      const plan = await traced('agent.plan', async () => {
        const result = await getPlan(messages, compacted);
        const span = trace.getActiveSpan();
        span?.setAttribute('agent.plan.confidence', result.confidence);
        span?.setAttribute('agent.plan.step_count', result.steps.length);
        return result;
      });
      emit?.('plan', plan);
      const planMessages = [
        plan.reasoningSummary,
        `Planner confidence ${plan.confidence.toFixed(2)} with ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}.`
      ].filter(Boolean) as string[];
      pushInsight('planning', planMessages);

      if (features.queryDecomposition && question.trim()) {
        emit?.('status', { stage: 'complexity_assessment' });
        complexityAssessment = await assessComplexity(question);
        pushInsight('complexity', [complexityAssessment.reasoning, complexityAssessment.reasoningSummary].filter(Boolean) as string[]);
        emit?.('complexity', {
          score: complexityAssessment.complexity,
          needsDecomposition: complexityAssessment.needsDecomposition,
          reasoning: complexityAssessment.reasoning
        });

        const eligible =
          complexityAssessment.needsDecomposition &&
          complexityAssessment.complexity >= config.DECOMPOSITION_COMPLEXITY_THRESHOLD;

        if (eligible) {
          emit?.('status', { stage: 'query_decomposition' });
          const candidate = await decomposeQuery(question);
          pushInsight('query_decomposition', candidate.reasoningSummary);
          const validSubQueries = candidate.subQueries.filter((item) => item.query.trim().length > 0);

          if (validSubQueries.length > 1 && validSubQueries.length <= config.DECOMPOSITION_MAX_SUBQUERIES) {
            decompositionResult = { ...candidate, subQueries: validSubQueries };
            emit?.('decomposition', {
              subQueries: validSubQueries.map((item) => ({
                id: item.id,
                query: item.query,
                dependencies: item.dependencies
              })),
              synthesisPrompt: candidate.synthesisPrompt
            });

            emit?.('status', { stage: 'executing_subqueries' });
            const subqueryResults = await executeSubQueries(validSubQueries, {
              retrieve: (args) => tools.retrieve(args),
              webSearch: (args) => tools.webSearch(args)
            });

            const aggregatedReferences: Reference[] = [];
            const aggregatedWebResults: WebResult[] = [];

            for (const [, result] of subqueryResults.entries()) {
              if (Array.isArray(result.references)) {
                aggregatedReferences.push(...result.references);
              }
              if (Array.isArray(result.webResults)) {
                aggregatedWebResults.push(...result.webResults);
              }
            }

            decompositionContextText = aggregatedReferences
              .map((reference, index) => {
                const body = reference.content ?? reference.chunk ?? '';
                return body ? `[SubQuery ${index + 1}] ${body}` : '';
              })
              .filter((segment) => segment.length > 0)
              .join('\n\n');

            decompositionReferences = aggregatedReferences;
            decompositionWebResults = aggregatedWebResults;

            if (decompositionContextText) {
              decompositionApplied = true;
              decompositionActivity.push({
                type: 'query_decomposition',
                description: `Executed ${validSubQueries.length} sub-queries via decomposition pipeline.`
              });
            }
          }
        }
      }

      const dispatch = await traced('agent.tool.dispatch', async () => {
        if (decompositionApplied) {
          // Build web context from decomposition web results
          const { text: webContextText, tokens: webContextTokens, trimmed: webContextTrimmed } =
            decompositionWebResults.length > 0
              ? buildWebContext(decompositionWebResults, config.WEB_CONTEXT_MAX_TOKENS)
              : buildWebContext([], config.WEB_CONTEXT_MAX_TOKENS);

          return {
            contextText: decompositionContextText,
            references: decompositionReferences,
            lazyReferences: [],
            activity: decompositionActivity,
            webResults: decompositionWebResults,
            webContextText,
            webContextTokens,
            webContextTrimmed,
            summaryTokens: undefined,
            source: 'direct' as const,
            retrievalMode: 'direct' as const,
            strategy: 'direct' as const,
            escalated: false,
            adaptiveStats: undefined,
            diagnostics: undefined,
            knowledgeAgentAnswer: undefined,
            knowledgeAgentGrounding: undefined,
            retrievalThresholdUsed: undefined,
            retrievalThresholdHistory: undefined,
            retrievalLatencyMs: undefined
          };
        }

        const result = await dispatchTools({
          plan,
          messages,
          salience: compacted.salience,
          emit,
          preferLazy: features.lazyRetrieval && routeConfig.retrieverStrategy !== 'web',
          tools,
          features,
          featureStates: featureMetadata.resolved
        });
        const span = trace.getActiveSpan();
        span?.setAttribute('retrieval.references', result.references.length);
        span?.setAttribute('retrieval.web_results', result.webResults.length);
        span?.setAttribute('retrieval.escalated', result.escalated);
        return result;
      });
  // P0 Fix: Respect dispatch.citationMetadata to maintain numbering consistency
  // The model sees numbered citations [1], [2]... from dispatchTools enumeration
  // We must use the same ordering here for validation to work
  const combinedCitations = dispatch.citationMetadata
    ? citationsFromEnumeration(dispatch.citationMetadata, dispatch.references, dispatch.webResults)
    : mergeCitations(dispatch.references, dispatch.webResults);

  emit?.('tool', {
    references: dispatch.references.length,
    webResults: dispatch.webResults.length
  });
  emit?.('citations', { citations: combinedCitations });
  emit?.('activity', { steps: dispatch.activity });
  const combinedActivity = [...stageInsights, ...dispatch.activity];

  if (dispatch.webContextText) {
    contextBudget.web_tokens = dispatch.webContextTokens;
  }

  const lazyReferenceState: LazyReference[] = dispatch.lazyReferences.map((ref) => ({ ...ref }));
  const lazyRetrievalEnabled = dispatch.retrievalMode === 'lazy' && lazyReferenceState.length > 0;

  const scoreValues = dispatch.references
    .map((ref) => ref.score)
    .filter((score): score is number => typeof score === 'number');
  // F-002: Derive attempted mode with proper hybrid_kb_web classification
  const attemptedMode: RetrievalAttemptedMode =
    dispatch.retrievalMode === 'hybrid_kb_web'
      ? 'hybrid_kb_web'
      : dispatch.retrievalMode === 'lazy'
      ? 'lazy'
      : dispatch.strategy === 'knowledge_agent' || dispatch.strategy === 'hybrid'
      ? 'knowledge_agent'
      : dispatch.source === 'knowledge_agent'
      ? 'knowledge_agent'
      : dispatch.source === 'fallback_vector'
      ? 'fallback_vector'
      : 'direct';

  // F-002: Derive canonical retrieval kind for unified classification
  const knowledgeAgentUsed = Boolean(dispatch.diagnostics?.knowledgeAgent?.attempted);
  const webUsed = dispatch.webResults.length > 0;
  const retrievalKind: RetrievalKind =
    attemptedMode === 'hybrid_kb_web'
      ? 'knowledge_agent_web_fallback'
      : knowledgeAgentUsed && !webUsed
      ? 'knowledge_agent_only'
      : attemptedMode === 'lazy'
      ? 'lazy_hybrid'
      : dispatch.source === 'fallback_vector'
      ? 'pure_vector'
      : webUsed && !knowledgeAgentUsed
      ? 'web_only'
      : 'direct_hybrid';

  const retrievalDiagnostics: RetrievalDiagnostics = {
    attempted: attemptedMode,
    succeeded: dispatch.references.length > 0,
    retryCount: dispatch.diagnostics?.retryCount ?? 0,
    documents: dispatch.references.length,
    meanScore: average(scoreValues),
    minScore: min(scoreValues),
    maxScore: max(scoreValues),
    thresholdUsed: dispatch.retrievalThresholdUsed ?? config.RERANKER_THRESHOLD,
    fallbackReason: dispatch.source === 'fallback_vector' ? 'direct_search_fallback' : undefined,
    escalated: dispatch.escalated,
    mode: dispatch.retrievalMode,
    summaryTokens: dispatch.summaryTokens,
    strategy: dispatch.strategy,
    kind: retrievalKind, // F-002: Add canonical classification
    latencyMs: dispatch.retrievalLatencyMs
  };
  if (dispatch.diagnostics?.correlationId) {
    retrievalDiagnostics.correlationId = dispatch.diagnostics.correlationId;
  }
  if (dispatch.diagnostics?.knowledgeAgent) {
    retrievalDiagnostics.knowledgeAgent = dispatch.diagnostics.knowledgeAgent;
  }
  if (typeof dispatch.diagnostics?.fallbackAttempts === 'number') {
    retrievalDiagnostics.fallbackAttempts = dispatch.diagnostics.fallbackAttempts;
  }
  if (dispatch.retrievalThresholdHistory && dispatch.retrievalThresholdHistory.length > 0) {
    retrievalDiagnostics.thresholdHistory = dispatch.retrievalThresholdHistory;
  }

  const highlightedDocuments = dispatch.references.filter((ref) => {
    if (!ref.highlights) {
      return false;
    }
    return Object.values(ref.highlights).some((entries) => Array.isArray(entries) && entries.length > 0);
  }).length;

  if (highlightedDocuments > 0) {
    retrievalDiagnostics.highlightedDocuments = highlightedDocuments;
  }

  if (
    (dispatch.strategy === 'knowledge_agent' || dispatch.strategy === 'hybrid') &&
    dispatch.source !== 'knowledge_agent' &&
    retrievalDiagnostics.fallbackReason === undefined
  ) {
    retrievalDiagnostics.fallbackReason = 'knowledge_agent_fallback';
  }
  if (dispatch.references.length < config.RETRIEVAL_MIN_DOCS) {
    const isKnowledgeAgentMode = dispatch.retrievalMode === 'knowledge_agent';
    if (!isKnowledgeAgentMode && retrievalDiagnostics.fallbackReason !== 'knowledge_agent_fallback') {
      retrievalDiagnostics.fallbackReason = retrievalDiagnostics.fallbackReason ?? 'insufficient_documents';
    }
  }
  if (dispatch.coverageChecklistCount !== undefined) {
    retrievalDiagnostics.coverageChecklistCount = dispatch.coverageChecklistCount;
  }
  if (dispatch.contextSectionLabels && dispatch.contextSectionLabels.length) {
    retrievalDiagnostics.contextSectionLabels = dispatch.contextSectionLabels;
  }
  // Type assertion for knowledgeAgentSummaryProvided field (not yet in RetrievalDiagnostics interface)
  (retrievalDiagnostics as any).knowledgeAgentSummaryProvided =
    (retrievalDiagnostics as any).knowledgeAgentSummaryProvided ||
    Boolean(dispatch.knowledgeAgentAnswer && dispatch.knowledgeAgentAnswer.trim().length > 0);

  const normalize = (value?: string) => (typeof value === 'string' ? value.trim() : '');
  const knowledgeAgentSummary = normalize(dispatch.knowledgeAgentAnswer);
  const retrievedBlock = normalize(dispatch.contextText);
  const webBlock = normalize(dispatch.webContextText);
  const memoryBlock = normalize(memoryContextAugmented);

  const contextSections: string[] = [];
  if (knowledgeAgentSummary) {
    contextSections.push(`### Knowledge Agent Summary\n${knowledgeAgentSummary}`);
  }
  if (retrievedBlock) {
    contextSections.push(retrievedBlock);
  }
  if (webBlock) {
    contextSections.push(`### Web Context\n${webBlock}`);
  }
  if (memoryBlock) {
    contextSections.push(`### Memory Context\n${memoryBlock}`);
  }

  let combinedContext = contextSections.join('\n\n');

  if (!combinedContext) {
    const fallbackSegments = [sections.history, memoryContextAugmented]
      .filter((segment): segment is string => typeof segment === 'string' && segment.trim().length > 0)
      .map((segment, idx) => `### Fallback Context ${idx + 1}\n${segment.trim()}`);
    combinedContext = fallbackSegments.join('\n\n');
  }

  // Critic (optional) retry loop
  let answer = '';
  let attempt = 0;
  let lazyLoadAttempts = 0;
  const MAX_LAZY_LOAD_ATTEMPTS = 2;
  let finalCritic: CriticReport | undefined;
  const critiqueHistory: Array<{ attempt: number; grounded: boolean; coverage: number; action: 'accept' | 'revise'; issues?: string[]; usedFullContent?: boolean; forced?: boolean }> = [];
  const responseHistory: Array<{ attempt: number; responseId?: string }> = [];
  let previousResponseId: string | undefined;

  if (config.ENABLE_CRITIC) {
    while (attempt <= config.CRITIC_MAX_RETRIES) {
      const isRevision = attempt > 0;
      const revisionNotes = isRevision && finalCritic?.issues?.length ? finalCritic.issues : undefined;

      emit?.('status', { stage: isRevision ? 'revising' : 'generating' });
      const answerResult = await traced(isRevision ? 'agent.synthesis.revision' : 'agent.synthesis', () =>
        generateAnswer(
          mode,
          question,
          combinedContext,
          tools,
          routeConfig,
          modelDeployment,
          featureMetadata.resolved,
          emit,
          revisionNotes,
          lazyReferenceState,
          previousResponseId,
          options.sessionId,
          intent,
          combinedCitations
        )
      );
      answer = answerResult.answer;
      combinedContext = answerResult.contextText;
      pushInsight('synthesis', answerResult.reasoningSummary);
      if (answerResult.responseId) {
        previousResponseId = answerResult.responseId;
      }
      responseHistory.push({ attempt, responseId: answerResult.responseId });

      emit?.('status', { stage: 'review' });
      const criticResult = await traced('agent.critique', async () => {
        const result = await tools.critic({ draft: answer, evidence: answerResult.contextText, question });
        const span = trace.getActiveSpan();
        span?.setAttribute('critic.attempt', attempt);
        if (result) {
          span?.setAttribute('critic.coverage', result.coverage);
          span?.setAttribute('critic.grounded', result.grounded);
          span?.setAttribute('critic.action', result.action);
        }
        return result;
      });

      // Handle undefined critic result
      if (!criticResult) {
        console.warn('Critic returned undefined, using default accept');
        finalCritic = { grounded: true, coverage: 1.0, action: 'accept', issues: [] };
        break;
      }

      critiqueHistory.push({
        attempt,
        grounded: criticResult.grounded,
        coverage: criticResult.coverage,
        action: criticResult.action,
        issues: criticResult.issues,
        usedFullContent: answerResult.usedFullContent,
        forced: criticResult.forced
      });

      emit?.('critique', { ...criticResult, attempt });
      pushInsight('quality_review', [
        criticResult.reasoningSummary,
        ...(criticResult.issues ?? [])
      ].filter(Boolean) as string[]);

      if (criticResult.action === 'accept') {
        finalCritic = criticResult;
        break;
      }

      if (attempt === config.CRITIC_MAX_RETRIES) {
        // Reached max retries, append quality notes
        finalCritic = criticResult;
        if (criticResult.issues?.length) {
          answer = `${answer}\n\n[Quality review notes: ${criticResult.issues.join('; ')}]`;
        }
        break;
      }

      // Consider loading full content if lazy summaries proved insufficient
      if (
        lazyRetrievalEnabled &&
        !answerResult.usedFullContent &&
        features.lazyRetrieval &&
        lazyLoadAttempts < MAX_LAZY_LOAD_ATTEMPTS &&
        (criticResult.coverage < config.LAZY_LOAD_THRESHOLD || (criticResult.issues?.length ?? 0) > 0)
      ) {
        lazyLoadAttempts++;
        const loadTargets = identifyLoadCandidates(lazyReferenceState, criticResult.issues ?? []);
        if (loadTargets.length) {
          emit?.('activity', {
            steps: [{
              type: 'lazy_load_triggered',
              description: `Loading full content for ${loadTargets.length} retrieval results based on critic feedback.`
            }]
          });

          const fullContentMap = await loadFullContent(lazyReferenceState, loadTargets);
          for (const [idx, content] of fullContentMap.entries()) {
            const existing = lazyReferenceState[idx];
            if (!existing) {
              continue;
            }
            lazyReferenceState[idx] = {
              ...existing,
              content,
              isSummary: false
            };
          }
        }
      }

      // Prepare for next iteration
      finalCritic = criticResult;
      attempt += 1;
    }
  } else {
    // Critic disabled — generate once, do not emit review/critique events
    emit?.('status', { stage: 'generating' });
    const answerResult = await traced('agent.synthesis', () =>
      generateAnswer(
        mode,
        question,
        combinedContext,
        tools,
        routeConfig,
        modelDeployment,
        featureMetadata.resolved,
        emit,
        undefined,
        lazyReferenceState,
        previousResponseId,
        options.sessionId,
        intent,
        combinedCitations
      )
    );
    answer = answerResult.answer;
    combinedContext = answerResult.contextText;
    pushInsight('synthesis', answerResult.reasoningSummary);
    if (answerResult.responseId) {
      previousResponseId = answerResult.responseId;
    }
    responseHistory.push({ attempt, responseId: answerResult.responseId });
    // Provide a trivial accept critic for downstream telemetry
    finalCritic = { grounded: true, coverage: 1.0, action: 'accept', issues: [] };
  }

  // FINAL SAFETY GATE: Enforce grounding requirements
  // If critic is enabled and final answer fails quality thresholds, refuse to answer
  if (config.ENABLE_CRITIC && finalCritic) {
    const finalCoverage = finalCritic.coverage ?? 0;
    const finalGrounded = finalCritic.grounded ?? false;

    if (!finalGrounded || finalCoverage < config.CRITIC_THRESHOLD) {
      answer = 'I do not know. The available evidence does not provide sufficient grounding to answer this question confidently.';

      emit?.('quality_gate_refusal', {
        reason: !finalGrounded ? 'ungrounded' : 'insufficient_coverage',
        coverage: finalCoverage,
        grounded: finalGrounded,
        iterations: attempt + 1,
        threshold: config.CRITIC_THRESHOLD
      });

      console.warn(
        `[QUALITY_GATE] Answer refused after ${attempt + 1} iterations (coverage: ${finalCoverage.toFixed(2)}, grounded: ${finalGrounded}, threshold: ${config.CRITIC_THRESHOLD})`
      );
    }
  }

  const critic = finalCritic ?? {
    grounded: true,
    coverage: 0.8,
    action: 'accept' as const,
    issues: []
  };

  const evaluation: SessionEvaluation = buildSessionEvaluation({
    question,
    answer,
    retrieval: retrievalDiagnostics,
    critic,
    citations: combinedCitations,
    summarySelection: summaryStats,
    plan,
    route: routeMetadata,
    referencesUsed: dispatch.references.length,
    webResultsUsed: dispatch.webResults.length,
    retrievalMode: dispatch.retrievalMode,
    lazySummaryTokens: dispatch.summaryTokens,
    criticIterations: attempt + 1,
    finalCriticAction: critic.action,
    activity: combinedActivity
  });

  const semanticMemorySummary = recalledMemories && recalledMemories.length
    ? {
        recalled: recalledMemories.length,
        entries: recalledMemories.map((memory) => ({
          id: memory.id,
          type: memory.type,
          similarity: memory.similarity,
          preview: memory.text.slice(0, 120)
        }))
      }
    : undefined;

  const queryDecompositionSummary = decompositionResult
    ? {
        active: decompositionApplied,
        complexityScore: complexityAssessment?.complexity,
        subQueries: decompositionResult.subQueries.map((item) => ({
          id: item.id,
          query: item.query,
          dependencies: item.dependencies
        })),
        synthesisPrompt: decompositionResult.synthesisPrompt
      }
    : decompositionApplied
    ? { active: true, complexityScore: complexityAssessment?.complexity }
    : undefined;

  const webContextSummary = dispatch.webContextText
    ? {
        tokens: dispatch.webContextTokens,
        trimmed: dispatch.webContextTrimmed,
        text: dispatch.webContextText,
        results: dispatch.webResults.map((result) => ({
          id: result.id ?? result.url,
          title: result.title,
          url: result.url,
          rank: result.rank
        }))
      }
    : undefined;

  const telemetrySnapshot = {
    plan,
    contextBudget,
    critic,
    retrieval: retrievalDiagnostics,
    diagnostics: dispatch.diagnostics,
    route: routeMetadata,
    retrievalMode: dispatch.retrievalMode,
    retrievalStrategy: dispatch.strategy,
    lazySummaryTokens: dispatch.summaryTokens,
    adaptiveRetrieval: dispatch.adaptiveStats,
    semanticMemory: semanticMemorySummary,
    queryDecomposition: queryDecompositionSummary,
    summarySelection: summaryStats,
    webContext: webContextSummary,
    evaluation,
    knowledgeAgentGrounding: dispatch.knowledgeAgentGrounding,
    rerankerThresholdUsed: dispatch.retrievalThresholdUsed,
    rerankerThresholdHistory: dispatch.retrievalThresholdHistory,
    responses: responseHistory,
    retrievalLatencyMs: dispatch.retrievalLatencyMs
  } as const;

  // Emit dedicated summary selection stats event for real-time monitoring
  if (summaryStats && (summaryStats.selectedCount > 0 || summaryStats.error)) {
    emit?.('summary_selection_stats', summaryStats);
  }

  const response: ChatResponse = {
    answer,
    citations: combinedCitations,
    activity: combinedActivity,
    metadata: {
      features: featureMetadata,
      retrieval_time_ms: dispatch.retrievalLatencyMs,
      critic_iterations: attempt + 1,
      plan: telemetrySnapshot.plan,
      trace_id: options.sessionId,
      context_budget: telemetrySnapshot.contextBudget,
      critic_report: telemetrySnapshot.critic,
      summary_selection: telemetrySnapshot.summarySelection,
      route: telemetrySnapshot.route,
      retrieval_mode: telemetrySnapshot.retrievalMode,
      lazy_summary_tokens: telemetrySnapshot.lazySummaryTokens,
      retrieval: telemetrySnapshot.retrieval,
      diagnostics: telemetrySnapshot.diagnostics,
      responses: telemetrySnapshot.responses,
      adaptive_retrieval: telemetrySnapshot.adaptiveRetrieval,
      semantic_memory: telemetrySnapshot.semanticMemory,
      query_decomposition: telemetrySnapshot.queryDecomposition,
      web_context: telemetrySnapshot.webContext,
      knowledge_agent_grounding: telemetrySnapshot.knowledgeAgentGrounding,
      reranker_threshold_used: telemetrySnapshot.rerankerThresholdUsed,
      reranker_threshold_history: telemetrySnapshot.rerankerThresholdHistory,
      critique_history: critiqueHistory.map((entry) => ({
        attempt: entry.attempt,
        coverage: entry.coverage,
        grounded: entry.grounded,
        action: entry.action,
        issues: entry.issues,
        usedFullContent: entry.usedFullContent
      })),
      evaluation: telemetrySnapshot.evaluation
    }
  };

  const completedAt = Date.now();
  const criticSummary = {
    grounded: critic.grounded,
    coverage: critic.coverage,
    action: critic.action,
    iterations: attempt + 1,
    issues: critic.issues,
    reasoningSummary: critic.reasoningSummary
  };

  emit?.('complete', { answer });
  emit?.('telemetry', {
    traceId: options.sessionId,
    ...telemetrySnapshot
  });
  const sessionTrace: SessionTrace = {
    sessionId: options.sessionId,
    mode,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    plan,
    planConfidence: plan.confidence,
    route: routeMetadata,
    contextBudget,
    retrieval: retrievalDiagnostics,
    critic: criticSummary,
    summarySelection: summaryStats,
    critiqueHistory: critiqueHistory.map((entry) => ({ ...entry })),
    responses: responseHistory.map((entry) => ({ ...entry })),
    semanticMemory: semanticMemorySummary,
    queryDecomposition: queryDecompositionSummary,
    events: [],
    evaluation,
    rerankerThresholdUsed: dispatch.retrievalThresholdUsed,
    rerankerThresholdHistory: dispatch.retrievalThresholdHistory,
    knowledgeAgentGrounding: dispatch.knowledgeAgentGrounding,
    error: undefined
  };
  if (webContextSummary) {
    sessionTrace.webContext = webContextSummary;
  }
  emit?.('trace', { session: sessionTrace });
  emit?.('done', { status: 'complete' });

  if (config.ENABLE_CITATION_TRACKING && features.semanticMemory && !answer.startsWith('I do not know')) {
    try {
      await trackCitationUsage(answer, combinedCitations, question, options.sessionId);
    } catch (error) {
      console.warn('Citation tracking failed:', error);
    }
  }

  if (
    features.semanticMemory &&
    question.trim() &&
    answer.trim() &&
    !answer.trim().startsWith('I do not know')
  ) {
    try {
      await semanticMemoryStore.addMemory(
        `Q: ${question}\nA: ${answer.slice(0, 500)}`,
        'episodic',
        {
          planConfidence: plan.confidence,
          criticCoverage: critic.coverage,
          criticGrounded: critic.grounded
        },
        { sessionId: options.sessionId }
      );
    } catch (error) {
      console.warn('Failed to persist semantic memory entry:', error);
    }
  }

      const evaluationEvent: import('@opentelemetry/api').Attributes = {
        'evaluation.summary.status': evaluation.summary.status,
        'evaluation.safety.flagged': evaluation.safety?.flagged ?? false
      };
      if (evaluation.summary.failingMetrics.length > 0) {
        evaluationEvent['evaluation.summary.failures'] = evaluation.summary.failingMetrics.join(',');
      }
      if (evaluation.rag?.retrieval) {
        evaluationEvent['evaluation.rag.retrieval.score'] = evaluation.rag.retrieval.score;
      }
      if (evaluation.agent?.intentResolution) {
        evaluationEvent['evaluation.agent.intent_resolution.score'] = evaluation.agent.intentResolution.score;
      }
      if (evaluation.agent?.toolCallAccuracy) {
        evaluationEvent['evaluation.agent.tool_call_accuracy.score'] = evaluation.agent.toolCallAccuracy.score;
      }
      if (evaluation.agent?.taskAdherence) {
        evaluationEvent['evaluation.agent.task_adherence.score'] = evaluation.agent.taskAdherence.score;
      }
      sessionSpan.addEvent('evaluation', evaluationEvent);

      sessionSpan.setAttributes({
        'agent.plan.confidence': plan.confidence,
        'agent.plan.step_count': plan.steps.length,
        'context.tokens.history': contextBudget.history_tokens,
        'context.tokens.summary': contextBudget.summary_tokens,
        'context.tokens.salience': contextBudget.salience_tokens,
        'context.tokens.web': contextBudget.web_tokens ?? 0,
        'summary.selection.mode': summaryStats.mode,
        'summary.selection.selected': summaryStats.selectedCount,
        'summary.selection.total': summaryStats.totalCandidates,
        'agent.critic.grounded': critic.grounded,
        'agent.critic.coverage': critic.coverage,
        'agent.critic.iterations': attempt + 1,
        'agent.retrieval.documents': dispatch.references.length,
        'agent.retrieval.escalated': dispatch.escalated,
        'agent.retrieval.mode': dispatch.retrievalMode,
        'agent.retrieval.lazy_summary_tokens': dispatch.summaryTokens ?? 0,
        'agent.web.results': dispatch.webResults.length,
        'agent.web.context_trimmed': dispatch.webContextTrimmed,
        'gen_ai.response.latency_ms': completedAt - startedAt
      });

      return response;
    } catch (error) {
      sessionSpan.recordException(error as Error);
      sessionSpan.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      sessionSpan.end();
    }
  });
}
