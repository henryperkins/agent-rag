import type {
  ActivityStep,
  AgentMessage,
  ChatResponse,
  CriticReport,
  OrchestratorTools,
  PlanSummary,
  Reference,
  RetrievalDiagnostics,
  SessionTrace
} from '../../../shared/types.js';
import { compactHistory } from './compact.js';
import type { SalienceNote } from './compact.js';
import { budgetSections, estimateTokens } from './contextBudget.js';
import { getPlan } from './plan.js';
import { dispatchTools } from './dispatch.js';
import { evaluateAnswer } from './critique.js';
import { config } from '../config/app.js';
import { createResponseStream } from '../azure/openaiClient.js';
import { trace } from '@opentelemetry/api';
import { getTracer, traced } from './telemetry.js';
import { loadMemory, upsertMemory } from './memoryStore.js';
import { agenticRetrieveTool, answerTool, webSearchTool } from '../tools/index.js';

export type ExecMode = 'sync' | 'stream';

export interface RunSessionOptions {
  messages: AgentMessage[];
  mode: ExecMode;
  sessionId: string;
  emit?: (event: string, data: unknown) => void;
  tools?: Partial<OrchestratorTools>;
}

const defaultTools: OrchestratorTools = {
  retrieve: (args) => agenticRetrieveTool(args),
  webSearch: (args) => webSearchTool({ mode: config.WEB_SEARCH_MODE, ...args }),
  answer: (args) => answerTool(args),
  critic: (args) => evaluateAnswer(args)
};

interface GenerateAnswerResult {
  answer: string;
  events: ActivityStep[];
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

function latestQuestion(messages: AgentMessage[]) {
  return [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
}

async function generateAnswer(
  mode: ExecMode,
  question: string,
  contextText: string,
  tools: OrchestratorTools,
  emit?: (event: string, data: unknown) => void,
  revisionNotes?: string[]
): Promise<GenerateAnswerResult> {
  const systemPrompt =
    'Respond using ONLY the provided context. Cite evidence inline as [1], [2], etc. Say "I do not know" if grounding is insufficient.';

  if (!contextText?.trim()) {
    const fallbackAnswer = 'I do not know. (No grounded evidence retrieved)';
    if (mode === 'stream') {
      emit?.('token', { content: fallbackAnswer });
    }
    return { answer: fallbackAnswer, events: [] };
  }

  let userPrompt = `Question: ${question}\n\nContext:\n${contextText}`;
  if (revisionNotes && revisionNotes.length > 0) {
    userPrompt += `\n\nRevision guidance (address these issues):\n${revisionNotes.map((note, i) => `${i + 1}. ${note}`).join('\n')}`;
  }

  if (mode === 'stream') {
    const reader = await createResponseStream({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.4,
      parallel_tool_calls: false,
      textFormat: { type: 'text' }
    });

    let answer = '';
    const decoder = new TextDecoder();

    // emit initial status
    emit?.('status', { stage: 'generating' });

    let completed = false;
    while (!completed) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload);
          const type = delta.type as string | undefined;

          if (type === 'response.output_text.delta') {
            const content = delta.delta ?? '';
            if (content) {
              answer += content;
              emit?.('tokens', { content });
            }
            continue;
          }

          if (type === 'response.output_text.done') {
            const text = delta.text ?? '';
            if (text) {
              answer += text;
              emit?.('tokens', { content: text });
            }
            continue;
          }

          if (type === 'response.completed') {
            if (!answer && typeof delta.response?.output_text === 'string') {
              answer = delta.response.output_text;
            }
            completed = true;
            break;
          }
        } catch (error) {
          // ignore malformed chunks
        }
      }
    }

    return { answer, events: [] };
  }

  const result = await tools.answer({
    question,
    context: contextText,
    revisionNotes
  });

  const answer = result?.answer?.trim() ? result.answer : 'I do not know.';
  return { answer, events: [] };
}

function buildContextSections(
  compacted: Awaited<ReturnType<typeof compactHistory>>,
  memorySummary: string[],
  memorySalience: SalienceNote[]
) {
  const historyText = compacted.latest.map((m) => `${m.role}: ${m.content}`).join('\n');
  const combinedSummary = [...memorySummary, ...compacted.summary]
    .slice(-config.CONTEXT_MAX_SUMMARY_ITEMS)
    .map((item) => `- ${item}`)
    .join('\n');
  const combinedSalience = mergeSalienceForContext(memorySalience, compacted.salience)
    .slice(0, config.CONTEXT_MAX_SALIENCE_ITEMS)
    .map((note) => `- ${note.fact}`)
    .join('\n');

  return {
    historyText,
    summaryText: combinedSummary,
    salienceText: combinedSalience
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
  const sessionSpan = tracer.startSpan('session', {
    attributes: {
      'session.id': options.sessionId,
      'session.mode': mode
    }
  });

  emit?.('status', { stage: 'context' });

  const compacted = await traced('context.compact', () => compactHistory(messages));
  const memorySnapshot = loadMemory(options.sessionId);
  const { historyText, summaryText, salienceText } = buildContextSections(
    compacted,
    memorySnapshot.summaryBullets,
    memorySnapshot.salience
  );
  upsertMemory(options.sessionId, messages.length, compacted);

  const sections = budgetSections({
    model: config.AZURE_OPENAI_GPT_MODEL_NAME,
    sections: {
      history: historyText,
      summary: summaryText,
      salience: salienceText
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

  const contextBudget = {
    history_tokens: estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, sections.history),
    summary_tokens: estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, sections.summary),
    salience_tokens: estimateTokens(config.AZURE_OPENAI_GPT_MODEL_NAME, sections.salience)
  };

  const plan = await traced('plan', async () => {
    const result = await getPlan(messages, compacted);
    const span = trace.getActiveSpan();
    span?.setAttribute('plan.confidence', result.confidence);
    span?.setAttribute('plan.step_count', result.steps.length);
    return result;
  });
  emit?.('plan', plan);

  const dispatch = await traced('tools.dispatch', async () => {
    const result = await dispatchTools({
      plan,
      messages,
      salience: compacted.salience,
      emit,
      tools: {
        retrieve: tools.retrieve,
        webSearch: tools.webSearch
      }
    });
    const span = trace.getActiveSpan();
    span?.setAttribute('retrieval.references', result.references.length);
    span?.setAttribute('retrieval.web_results', result.webResults.length);
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

  const scoreValues = dispatch.references
    .map((ref) => ref.score)
    .filter((score): score is number => typeof score === 'number');
  const retrievalDiagnostics: RetrievalDiagnostics = {
    attempted: dispatch.source,
    succeeded: dispatch.references.length > 0,
    retryCount: 0,
    documents: dispatch.references.length,
    meanScore: average(scoreValues),
    minScore: min(scoreValues),
    maxScore: max(scoreValues),
    thresholdUsed: config.RERANKER_THRESHOLD,
    fallbackReason: dispatch.source === 'fallback_vector' ? 'knowledge_agent_unavailable' : undefined
  };

  if (dispatch.references.length < config.RETRIEVAL_MIN_DOCS) {
    retrievalDiagnostics.fallbackReason = retrievalDiagnostics.fallbackReason ?? 'insufficient_documents';
  }

  const question = latestQuestion(messages);
  let combinedContext = [dispatch.contextText, dispatch.webContextText].filter(Boolean).join('\n\n');
  if (!combinedContext) {
    combinedContext = sections.history;
  }

  // Critic retry loop
  let answer = '';
  let attempt = 0;
  let finalCritic: CriticReport | undefined;
  const critiqueHistory: Array<{ attempt: number; grounded: boolean; coverage: number; action: 'accept' | 'revise'; issues?: string[] }> = [];

  while (attempt <= config.CRITIC_MAX_RETRIES) {
    const isRevision = attempt > 0;
    const revisionNotes = isRevision && finalCritic?.issues?.length ? finalCritic.issues : undefined;

    emit?.('status', { stage: isRevision ? 'revising' : 'generating' });
    const answerResult = await traced(isRevision ? 'synthesis.revision' : 'synthesis', () =>
      generateAnswer(mode, question, combinedContext, tools, emit, revisionNotes)
    );
    answer = answerResult.answer;

    emit?.('status', { stage: 'review' });
    const criticResult = await traced('critic', async () => {
      const result = await tools.critic({ draft: answer, evidence: combinedContext, question });
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
      issues: criticResult.issues
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

    // Prepare for next iteration
    finalCritic = criticResult;
    attempt += 1;
  }

  const critic = finalCritic ?? {
    grounded: true,
    coverage: 0.8,
    action: 'accept' as const,
    issues: []
  };

  const response: ChatResponse = {
    answer,
    citations: dispatch.references,
    activity: dispatch.activity,
    metadata: {
      retrieval_time_ms: undefined,
      critic_iterations: attempt + 1,
      plan,
      trace_id: options.sessionId,
      context_budget: contextBudget,
      critic_report: critic,
      web_context: dispatch.webContextText
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
        : undefined,
      critique_history: critiqueHistory.map((entry) => ({
        attempt: entry.attempt,
        coverage: entry.coverage,
        grounded: entry.grounded,
        action: entry.action,
        issues: entry.issues
      }))
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
    plan,
    contextBudget,
    critic,
    retrieval: retrievalDiagnostics,
    webContext: dispatch.webContextText
      ? {
          tokens: dispatch.webContextTokens,
          trimmed: dispatch.webContextTrimmed,
          results: dispatch.webResults.map((result) => ({
            id: result.id,
            title: result.title,
            url: result.url,
            rank: result.rank
          }))
        }
      : undefined
  });
  const sessionTrace: SessionTrace = {
    sessionId: options.sessionId,
    mode,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    plan,
    planConfidence: plan.confidence,
    contextBudget,
    retrieval: retrievalDiagnostics,
    critic: criticSummary,
    critiqueHistory,
    events: [],
    error: undefined
  };
  if (dispatch.webContextText) {
    sessionTrace.webContext = {
      tokens: dispatch.webContextTokens,
      trimmed: dispatch.webContextTrimmed,
      results: dispatch.webResults.map((result) => ({
        id: result.id,
        title: result.title,
        url: result.url,
        rank: result.rank
      }))
    };
  }
  emit?.('trace', { session: sessionTrace });
  emit?.('done', { status: 'complete' });

  sessionSpan.setAttributes({
    'plan.confidence': plan.confidence,
    'plan.steps': plan.steps.length,
    'context.tokens.history': contextBudget.history_tokens,
    'context.tokens.summary': contextBudget.summary_tokens,
    'context.tokens.salience': contextBudget.salience_tokens,
    'context.tokens.web': contextBudget.web_tokens ?? 0,
    'critic.grounded': critic.grounded,
    'critic.coverage': critic.coverage,
    'critic.iterations': attempt + 1,
    'retrieval.documents': dispatch.references.length,
    'web.results': dispatch.webResults.length,
    'web.context.trimmed': dispatch.webContextTrimmed
  });
  sessionSpan.end();

  return response;
}
