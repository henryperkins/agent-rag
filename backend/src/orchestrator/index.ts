import type {
  ActivityStep,
  AgentMessage,
  ChatResponse,
  CriticReport,
  OrchestratorTools,
  RetrievalDiagnostics,
  LazyReference,
  Reference,
  RouteMetadata,
  SessionEvaluation,
  SessionTrace,
  WebResult
} from '../../../shared/types.js';
import { compactHistory } from './compact.js';
import type { SalienceNote } from './compact.js';
import { budgetSections, estimateTokens } from './contextBudget.js';
import { getPlan } from './plan.js';
import { dispatchTools } from './dispatch.js';
import { evaluateAnswer } from './critique.js';
import { config } from '../config/app.js';
import { createResponseStream } from '../azure/openaiClient.js';
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

type ExecMode = 'sync' | 'stream';

export interface RunSessionOptions {
  messages: AgentMessage[];
  mode: ExecMode;
  sessionId: string;
  emit?: (event: string, data: unknown) => void;
  tools?: Partial<OrchestratorTools>;
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
  faq: 'gpt-4o-mini',
  research: 'gpt-4o',
  factual_lookup: 'gpt-4o-mini',
  conversational: 'gpt-4o-mini'
};

const INTENT_MODEL_ENV_VARS: Record<string, string | undefined> = {
  faq: process.env.MODEL_FAQ,
  research: process.env.MODEL_RESEARCH,
  factual_lookup: process.env.MODEL_FACTUAL,
  conversational: process.env.MODEL_CONVERSATIONAL
};

function resolveModelDeployment(intent: string, routeConfig: RouteConfig) {
  const defaultModel = DEFAULT_INTENT_MODELS[intent] ?? DEFAULT_INTENT_MODELS.research;
  const envOverride = INTENT_MODEL_ENV_VARS[intent];
  const candidate = routeConfig.model?.trim();

  if (envOverride && envOverride.trim()) {
    return candidate || config.AZURE_OPENAI_GPT_DEPLOYMENT;
  }

  if (candidate && candidate !== defaultModel) {
    return candidate;
  }

  return config.AZURE_OPENAI_GPT_DEPLOYMENT;
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
  emit?: (event: string, data: unknown) => void,
  revisionNotes?: string[],
  lazyRefs: LazyReference[] = [],
  previousResponseId?: string
): Promise<GenerateAnswerResult> {
  const routePromptHint = routeConfig.systemPromptHints ? `${routeConfig.systemPromptHints}\n\n` : '';
  const basePrompt = `${routePromptHint}Respond using ONLY the provided context. Cite evidence inline as [1], [2], etc. Say "I do not know" if grounding is insufficient.`;

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

  if (!activeContext?.trim()) {
    const fallbackAnswer = 'I do not know. (No grounded evidence retrieved)';
    if (mode === 'stream') {
      emit?.('token', { content: fallbackAnswer });
    }
    return { answer: fallbackAnswer, events: [], usedFullContent, contextText: activeContext };
  }

  const stage = hasLazyReferences
    ? usedFullContent
      ? 'generating_full'
      : 'generating_from_summaries'
    : 'generating';

  let userPrompt = `Question: ${question}\n\nContext:\n${activeContext}`;
  if (revisionNotes && revisionNotes.length > 0) {
    userPrompt += `\n\nRevision guidance (address these issues):\n${revisionNotes.map((note, i) => `${i + 1}. ${note}`).join('\n')}`;
  }

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

    const reader = await createResponseStream({
      messages: [
        { role: 'system', content: basePrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      model: modelDeployment,
      max_output_tokens: routeConfig.maxTokens,
      parallel_tool_calls: config.RESPONSES_PARALLEL_TOOL_CALLS,
      stream_options: { include_usage: config.RESPONSES_STREAM_INCLUDE_USAGE },
      textFormat: { type: 'text' },
      truncation: 'auto',
      store: config.ENABLE_RESPONSE_STORAGE,
      // Only send previous_response_id when storage is enabled
      ...(config.ENABLE_RESPONSE_STORAGE && previousResponseId ? { previous_response_id: previousResponseId } : {})
    });

    let answer = '';
    const decoder = new TextDecoder();
    let successfulChunks = 0;
    let responseId: string | undefined;

    emit?.('status', { stage });

    let completed = false;
    let buffer = '';

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
        const type = delta.type as string | undefined;

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
            emit?.('token', { content });
          }
          return;
        }

        if (type === 'response.output_text.done') {
          const text =
            extractStreamText(delta.text) ||
            extractStreamText(delta.delta) ||
            extractStreamText(delta.response);
          if (typeof delta?.response?.id === 'string') {
            responseId = delta.response.id;
          }
          if (typeof (delta as Record<string, unknown>)?.id === 'string') {
            responseId = (delta as Record<string, unknown>).id as string;
          }
          if (text) {
            answer += text;
            emit?.('token', { content: text });
          }
          return;
        }

        if (type === 'response.output_item.added') {
          const text = extractStreamText(delta.output_item);
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

        // Optional usage snapshots when stream_options.include_usage=true
        if (type === 'response.usage' || delta?.response?.usage) {
          const usage = delta.response?.usage ?? delta.usage;
          if (usage) {
            emit?.('usage', usage);
          }
          return;
        }

        if (type === 'response.completed') {
          if (!answer && typeof delta.response?.output_text === 'string') {
            answer = delta.response.output_text;
          }
          if (typeof delta.response?.id === 'string') {
            responseId = delta.response.id;
          }
          completed = true;
        }
      } catch (_error) {
        // ignore malformed chunks
      }
    };

    const processBuffer = (flush = false) => {
      while (buffer) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex === -1) {
          if (!flush) {
            break;
          }
          const remaining = buffer.trim();
          buffer = '';
          if (remaining) {
            handleLine(remaining);
          }
          break;
        }

        const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);
        handleLine(rawLine);

        if (completed) {
          buffer = '';
          break;
        }
      }
    };

    while (!completed) {
      const { value, done } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        processBuffer(true);
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      processBuffer();
    }

    if (!answer && successfulChunks === 0) {
      throw new Error('Streaming failed: no valid chunks received');
    }

    return { answer, events: [], usedFullContent, contextText: activeContext, responseId };
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
    previousResponseId
  });

  const answer = result?.answer?.trim() ? result.answer : 'I do not know.';
  return { answer, events: [], usedFullContent, contextText: activeContext, responseId: result.responseId };
}

async function buildContextSections(
  compacted: Awaited<ReturnType<typeof compactHistory>>,
  memorySummary: SummaryBullet[],
  memorySalience: SalienceNote[],
  question: string
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
  const selection = await selectSummaryBullets(
    question,
    summaryCandidates,
    config.CONTEXT_MAX_SUMMARY_ITEMS
  );

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
  const tools: OrchestratorTools = {
    ...defaultTools,
    ...(options.tools ?? {})
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
      const { intent, confidence: intentConfidence, reasoning: intentReasoning } = await traced(
        'agent.intent_resolution',
        () => classifyIntent(question, messages.slice(-6))
      );
      const routeConfig = getRouteConfig(intent);
      const routeMetadata: RouteMetadata = {
        intent,
        confidence: intentConfidence,
        reasoning: intentReasoning,
        model: routeConfig.model,
        retrieverStrategy: routeConfig.retrieverStrategy,
        maxTokens: routeConfig.maxTokens
      };
      sessionSpan.setAttribute('agent.route.intent', intent);
      sessionSpan.setAttribute('agent.route.model', routeConfig.model);
      emit?.('route', routeMetadata);

      const modelDeployment = resolveModelDeployment(intent, routeConfig);

      emit?.('status', { stage: 'context' });

      const compacted = await traced('agent.state.compaction', () => compactHistory(messages));
      const memorySnapshot = loadMemory(options.sessionId);
      const { historyText, summaryText, salienceText, summaryCandidates, summaryStats } =
        await buildContextSections(compacted, memorySnapshot.summaryBullets, memorySnapshot.salience, question);
      upsertMemory(options.sessionId, messages.length, compacted, summaryCandidates);

      const summarySection = summaryText;
      let salienceSection = salienceText;
      let memoryContextBlock = '';
      let memoryContextAugmented = '';
      let recalledMemories: Awaited<ReturnType<typeof semanticMemoryStore.recallMemories>> = [];

      if (config.ENABLE_SEMANTIC_MEMORY && question.trim()) {
        recalledMemories = await semanticMemoryStore.recallMemories(question, {
          k: config.SEMANTIC_MEMORY_RECALL_K,
          sessionId: options.sessionId,
          minSimilarity: config.SEMANTIC_MEMORY_MIN_SIMILARITY,
          maxAgeDays: config.SEMANTIC_MEMORY_PRUNE_AGE_DAYS
        });

        if (recalledMemories.length) {
          memoryContextBlock = recalledMemories
            .map((memory, idx) => `[Memory ${idx + 1}] ${memory.text}`)
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

      if (config.ENABLE_QUERY_DECOMPOSITION && question.trim()) {
        emit?.('status', { stage: 'complexity_assessment' });
        complexityAssessment = await assessComplexity(question);
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
          return {
            contextText: decompositionContextText,
            references: decompositionReferences,
            lazyReferences: [],
        activity: decompositionActivity,
        webResults: decompositionWebResults,
        webContextText: '',
        webContextTokens: 0,
        webContextTrimmed: false,
        summaryTokens: undefined,
        source: 'direct' as const,
        retrievalMode: 'direct' as const,
        escalated: false
      };
    }

    const result = await dispatchTools({
      plan,
      messages,
      salience: compacted.salience,
      emit,
      preferLazy: config.ENABLE_LAZY_RETRIEVAL && routeConfig.retrieverStrategy !== 'web',
      tools
    });
    const span = trace.getActiveSpan();
    span?.setAttribute('retrieval.references', result.references.length);
    span?.setAttribute('retrieval.web_results', result.webResults.length);
    span?.setAttribute('retrieval.escalated', result.escalated);
    return result;
  });
  emit?.('tool', {
    references: dispatch.references.length,
    webResults: dispatch.webResults.length
  });
  emit?.('citations', { citations: dispatch.references });
  emit?.('activity', { steps: dispatch.activity });

  if (dispatch.webContextText) {
    contextBudget.web_tokens = dispatch.webContextTokens;
  }

  const lazyReferenceState: LazyReference[] = dispatch.lazyReferences.map((ref) => ({ ...ref }));
  const lazyRetrievalEnabled = dispatch.retrievalMode === 'lazy' && lazyReferenceState.length > 0;

  const scoreValues = dispatch.references
    .map((ref) => ref.score)
    .filter((score): score is number => typeof score === 'number');
  const attemptedMode: 'direct' | 'lazy' | 'fallback_vector' = dispatch.retrievalMode === 'lazy' ? 'lazy' : dispatch.source;
  const retrievalDiagnostics: RetrievalDiagnostics = {
    attempted: attemptedMode,
    succeeded: dispatch.references.length > 0,
    retryCount: 0,
    documents: dispatch.references.length,
    meanScore: average(scoreValues),
    minScore: min(scoreValues),
    maxScore: max(scoreValues),
    thresholdUsed: config.RERANKER_THRESHOLD,
    fallbackReason: dispatch.source === 'fallback_vector' ? 'direct_search_fallback' : undefined,
    escalated: dispatch.escalated,
    mode: dispatch.retrievalMode,
    summaryTokens: dispatch.summaryTokens
  };

  const highlightedDocuments = dispatch.references.filter((ref) => {
    if (!ref.highlights) {
      return false;
    }
    return Object.values(ref.highlights).some((entries) => Array.isArray(entries) && entries.length > 0);
  }).length;

  if (highlightedDocuments > 0) {
    retrievalDiagnostics.highlightedDocuments = highlightedDocuments;
  }

  if (dispatch.references.length < config.RETRIEVAL_MIN_DOCS) {
    retrievalDiagnostics.fallbackReason = retrievalDiagnostics.fallbackReason ?? 'insufficient_documents';
  }

  const combinedSegments = [dispatch.contextText, dispatch.webContextText];
  if (memoryContextAugmented) {
    combinedSegments.push(memoryContextAugmented);
  }

  let combinedContext = combinedSegments
    .filter((segment) => typeof segment === 'string' && segment.trim().length > 0)
    .join('\n\n');

  if (!combinedContext) {
    const fallbackSegments = [sections.history];
    if (memoryContextAugmented) {
      fallbackSegments.push(memoryContextAugmented);
    }
    combinedContext = fallbackSegments
      .filter((segment) => typeof segment === 'string' && segment.trim().length > 0)
      .join('\n\n');
  }

  // Critic (optional) retry loop
  let answer = '';
  let attempt = 0;
  let lazyLoadAttempts = 0;
  const MAX_LAZY_LOAD_ATTEMPTS = 2;
  let finalCritic: CriticReport | undefined;
  const critiqueHistory: Array<{ attempt: number; grounded: boolean; coverage: number; action: 'accept' | 'revise'; issues?: string[]; usedFullContent?: boolean }> = [];
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
          emit,
          revisionNotes,
          lazyReferenceState,
          previousResponseId
        )
      );
      answer = answerResult.answer;
      combinedContext = answerResult.contextText;
      if (answerResult.responseId) {
        previousResponseId = answerResult.responseId;
      }
      responseHistory.push({ attempt, responseId: answerResult.responseId });

      emit?.('status', { stage: 'review' });
      const criticResult = await traced('agent.critique', async () => {
        const result = await tools.critic({ draft: answer, evidence: answerResult.contextText, question });
        const span = trace.getActiveSpan();
        span?.setAttribute('critic.attempt', attempt);
        span?.setAttribute('critic.coverage', result.coverage);
        span?.setAttribute('critic.grounded', result.grounded);
        span?.setAttribute('critic.action', result.action);
        return result;
      });

      critiqueHistory.push({
        attempt,
        grounded: criticResult.grounded,
        coverage: criticResult.coverage,
        action: criticResult.action,
        issues: criticResult.issues,
        usedFullContent: answerResult.usedFullContent
      });

      emit?.('critique', { ...criticResult, attempt });

      if (criticResult.action === 'accept' || criticResult.coverage >= config.CRITIC_THRESHOLD) {
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
        config.ENABLE_LAZY_RETRIEVAL &&
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
        emit,
        undefined,
        lazyReferenceState,
        previousResponseId
      )
    );
    answer = answerResult.answer;
    combinedContext = answerResult.contextText;
    if (answerResult.responseId) {
      previousResponseId = answerResult.responseId;
    }
    responseHistory.push({ attempt, responseId: answerResult.responseId });
    // Provide a trivial accept critic for downstream telemetry
    finalCritic = { grounded: true, coverage: 1.0, action: 'accept', issues: [] };
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
    citations: dispatch.references,
    summarySelection: summaryStats,
    plan,
    route: routeMetadata,
    referencesUsed: dispatch.references.length,
    webResultsUsed: dispatch.webResults.length,
    retrievalMode: dispatch.retrievalMode,
    lazySummaryTokens: dispatch.summaryTokens,
    criticIterations: attempt + 1,
    finalCriticAction: critic.action,
    activity: dispatch.activity
  });

  const semanticMemorySummary = recalledMemories.length
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
          id: result.id,
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
    route: routeMetadata,
    retrievalMode: dispatch.retrievalMode,
    lazySummaryTokens: dispatch.summaryTokens,
    semanticMemory: semanticMemorySummary,
    queryDecomposition: queryDecompositionSummary,
    summarySelection: summaryStats,
    webContext: webContextSummary,
    evaluation,
    responses: responseHistory
  } as const;

  // Emit dedicated summary selection stats event for real-time monitoring
  if (summaryStats && (summaryStats.selectedCount > 0 || summaryStats.error)) {
    emit?.('summary_selection_stats', summaryStats);
  }

  const response: ChatResponse = {
    answer,
    citations: dispatch.references,
    activity: dispatch.activity,
    metadata: {
      retrieval_time_ms: undefined,
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
      responses: telemetrySnapshot.responses,
      semantic_memory: telemetrySnapshot.semanticMemory,
      query_decomposition: telemetrySnapshot.queryDecomposition,
      web_context: telemetrySnapshot.webContext,
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
    issues: critic.issues
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
    error: undefined
  };
  if (webContextSummary) {
    sessionTrace.webContext = webContextSummary;
  }
  emit?.('trace', { session: sessionTrace });
  emit?.('done', { status: 'complete' });

      if (config.ENABLE_CITATION_TRACKING && config.ENABLE_SEMANTIC_MEMORY && !answer.startsWith('I do not know')) {
    try {
      await trackCitationUsage(answer, dispatch.references, question, options.sessionId);
    } catch (error) {
      console.warn('Citation tracking failed:', error);
    }
  }

      if (
    config.ENABLE_SEMANTIC_MEMORY &&
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
