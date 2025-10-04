import type {
  ActivityStep,
  CriticReport,
  EvaluationDimension,
  PlanSummary,
  Reference,
  RetrievalDiagnostics,
  RouteMetadata,
  SafetyEvaluationCategory,
  SessionEvaluation,
  SummarySelectionStats
} from '../../../shared/types.js';

interface BuildSessionEvaluationOptions {
  question: string;
  answer: string;
  retrieval?: RetrievalDiagnostics;
  critic?: CriticReport;
  citations: Reference[];
  summarySelection?: SummarySelectionStats;
  plan?: PlanSummary;
  route?: RouteMetadata;
  referencesUsed?: number;
  webResultsUsed?: number;
  retrievalMode?: string;
  lazySummaryTokens?: number;
  criticIterations: number;
  finalCriticAction: CriticReport['action'];
  activity?: ActivityStep[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function likertFromFraction(value: number | undefined | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 1;
  }
  if (value >= 0.9) return 5;
  if (value >= 0.75) return 4;
  if (value >= 0.6) return 3;
  if (value >= 0.4) return 2;
  return 1;
}

function stripUndefined<T extends Record<string, unknown>>(value: T | undefined): T | undefined {
  if (!value) {
    return undefined;
  }
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      next[key] = item;
    }
  }
  return Object.keys(next).length ? (next as T) : undefined;
}

function evaluateIntentResolution(
  plan: PlanSummary | undefined,
  route: RouteMetadata | undefined,
  retrieval: RetrievalDiagnostics | undefined
): EvaluationDimension {
  let score = 3;
  const stepsCount = plan?.steps?.length ?? 0;
  const fallbackTriggered = Boolean(retrieval?.fallbackReason ?? retrieval?.fallback_reason);
  const escalated = Boolean(retrieval?.escalated);
  const reasonParts: string[] = [];

  if (stepsCount > 0) {
    score += 1;
    reasonParts.push(`Planner produced ${stepsCount} step(s).`);
  } else {
    score -= 1;
    reasonParts.push('Planner returned no actionable steps.');
  }

  if (typeof route?.confidence === 'number') {
    const confidencePct = Math.round(route.confidence * 100);
    if (route.confidence >= 0.75) {
      score += 1;
      reasonParts.push(`High route confidence (${confidencePct}%).`);
    } else if (route.confidence < 0.4) {
      score -= 1;
      reasonParts.push(`Low route confidence (${confidencePct}%).`);
    } else {
      reasonParts.push(`Route confidence ${confidencePct}%.`);
    }
  } else {
    reasonParts.push('Route confidence unavailable.');
  }

  if (fallbackTriggered) {
    score -= 0.5;
    reasonParts.push('Retrieval fallback triggered, possible intent mismatch.');
  }

  if (escalated) {
    score -= 0.5;
    reasonParts.push('Retrieval escalated beyond primary plan.');
  }

  const passed = score >= 3;
  reasonParts.push(passed ? 'Intent resolution evaluator passes.' : 'Intent resolution evaluator requires review.');

  return {
    metric: 'intent_resolution',
    score: clamp(Math.round(score), 1, 5),
    threshold: 3,
    passed,
    reason: reasonParts.join(' '),
    evidence: {
      intent: route?.intent,
      confidence: route?.confidence,
      stepsCount,
      fallback: retrieval?.fallbackReason ?? retrieval?.fallback_reason,
      escalated
    }
  };
}

function evaluateToolCallAccuracy(
  plan: PlanSummary | undefined,
  referencesUsed: number,
  webResultsUsed: number,
  retrieval: RetrievalDiagnostics | undefined,
  activity: ActivityStep[] | undefined,
  retrievalMode: string | undefined
): EvaluationDimension {
  let score = 3;
  const steps = plan?.steps ?? [];
  const expectsVector = steps.some((step) => step.action === 'vector_search' || step.action === 'both');
  const expectsWeb = steps.some((step) => step.action === 'web_search' || step.action === 'both');
  const expectsAnswerOnly = steps.length > 0 && steps.every((step) => step.action === 'answer');
  const fallbackTriggered = Boolean(retrieval?.fallbackReason ?? retrieval?.fallback_reason);
  const escalated = Boolean(retrieval?.escalated);
  const hasFallbackActivity = (activity ?? []).some((step) => /fallback/i.test(step.type) || /fallback/i.test(step.description));
  const reasonParts: string[] = [];

  if (expectsAnswerOnly) {
    score += 1;
    reasonParts.push('Planner requested direct answer without tool calls.');
  }

  if (expectsVector) {
    if (referencesUsed > 0) {
      score += 1;
      reasonParts.push('Vector retrieval succeeded with citations.');
    } else {
      score -= 1;
      reasonParts.push('Planner expected vector retrieval but no citations returned.');
    }
  }

  if (expectsWeb) {
    if (webResultsUsed > 0) {
      score += 1;
      reasonParts.push('Web search provided results as planned.');
    } else {
      score -= 1;
      reasonParts.push('Planner expected web search but no results were retrieved.');
    }
  }

  if (fallbackTriggered) {
    score -= 1;
    reasonParts.push('Fallback retrieval path invoked.');
  }

  if (escalated) {
    score -= 0.5;
    reasonParts.push('Retrieval escalated beyond initial tool plan.');
  }

  if (hasFallbackActivity) {
    score -= 0.5;
    reasonParts.push('Activity log indicates fallback steps.');
  }

  const passed = score >= 3;
  reasonParts.push(passed ? 'Tool call accuracy evaluator passes.' : 'Tool call accuracy evaluator needs review.');

  return {
    metric: 'tool_call_accuracy',
    score: clamp(Math.round(score), 1, 5),
    threshold: 3,
    passed,
    reason: reasonParts.join(' '),
    evidence: {
      expectedVector: expectsVector,
      referencesUsed,
      expectedWeb: expectsWeb,
      webResultsUsed,
      fallback: retrieval?.fallbackReason ?? retrieval?.fallback_reason,
      escalated,
      fallbackActivity: hasFallbackActivity,
      retrievalMode
    }
  };
}

function evaluateTaskAdherence(
  plan: PlanSummary | undefined,
  criticIterations: number,
  finalCriticAction: CriticReport['action'],
  activity: ActivityStep[] | undefined,
  retrieval: RetrievalDiagnostics | undefined,
  summarySelection: SummarySelectionStats | undefined,
  lazySummaryTokens: number | undefined
): EvaluationDimension {
  let score = 3;
  const reasonParts: string[] = [];
  const hasIteration = criticIterations > 1;
  const fallbackTriggered = Boolean(retrieval?.fallbackReason ?? retrieval?.fallback_reason);
  const summaryFallback = Boolean(summarySelection?.usedFallback);
  const escalated = Boolean(retrieval?.escalated);
  const correctiveActivity = (activity ?? []).some((step) => /lazy_load|confidence_escalation|fallback/i.test(step.type));

  if (plan?.steps?.length) {
    reasonParts.push(`Executed plan with ${plan.steps.length} step(s).`);
  }

  if (finalCriticAction === 'accept') {
    score += 1;
    reasonParts.push('Critic accepted final answer.');
  } else {
    score -= 1;
    reasonParts.push('Critic requested revision on final turn.');
  }

  if (hasIteration) {
    score -= 0.5;
    reasonParts.push(`Response required ${criticIterations} critic iteration(s).`);
  }

  if (fallbackTriggered) {
    score -= 0.5;
    reasonParts.push('Task required retrieval fallback.');
  }

  if (escalated) {
    score -= 0.5;
    reasonParts.push('Task escalated beyond initial plan.');
  }

  if (summaryFallback) {
    score -= 0.25;
    reasonParts.push('Summary selection used fallback heuristics.');
  }

  if (correctiveActivity) {
    score -= 0.25;
    reasonParts.push('Corrective activity steps executed (lazy load/escalation).');
  }

  if (typeof lazySummaryTokens === 'number' && lazySummaryTokens > 0) {
    score -= 0.25;
    reasonParts.push('Lazy summaries consumed additional tokens to complete the task.');
  }

  const passed = score >= 3;
  reasonParts.push(passed ? 'Task adherence evaluator passes.' : 'Task adherence evaluator indicates follow-up needed.');

  return {
    metric: 'task_adherence',
    score: clamp(Math.round(score), 1, 5),
    threshold: 3,
    passed,
    reason: reasonParts.join(' '),
    evidence: {
      criticIterations,
      finalCriticAction,
      fallback: retrieval?.fallbackReason ?? retrieval?.fallback_reason,
      escalated,
      summaryFallback,
      correctiveActivity,
      lazySummaryTokens
    }
  };
}

function evaluateRetrieval(
  retrieval: RetrievalDiagnostics | undefined,
  summarySelection: SummarySelectionStats | undefined
): EvaluationDimension {
  if (!retrieval) {
    return {
      metric: 'retrieval',
      score: 1,
      threshold: 3,
      passed: false,
      reason: 'No retrieval diagnostics recorded; treat as failing retrieval evaluation until instrumentation is available.',
      evidence: {}
    };
  }

  let score = 3;
  const evidence: Record<string, unknown> = {
    attempted: retrieval.attempted,
    documents: retrieval.documents,
    meanScore: retrieval.meanScore,
    fallbackReason: retrieval.fallbackReason ?? retrieval.fallback_reason,
    escalated: retrieval.escalated,
    summarySelectionFallback: summarySelection?.usedFallback
  };

  if (!retrieval.succeeded || retrieval.documents === 0) {
    score = 1;
  } else {
    if (retrieval.documents >= 3) {
      score += 1;
    }
    if (typeof retrieval.meanScore === 'number' && retrieval.meanScore >= 0.7) {
      score += 1;
    }
    if (retrieval.fallbackReason || retrieval.fallback_reason) {
      score -= 1;
    }
    if (retrieval.escalated) {
      score -= 0.5;
    }
    if (summarySelection?.usedFallback) {
      score -= 0.5;
    }
  }

  score = clamp(Math.round(score), 1, 5);
  const passed = score >= 3;
  const reasonParts: string[] = [];

  if (!retrieval.succeeded || retrieval.documents === 0) {
    reasonParts.push('No relevant documents returned.');
  } else {
    reasonParts.push(`Retrieved ${retrieval.documents} document(s).`);
    if (typeof retrieval.meanScore === 'number') {
      reasonParts.push(`Mean relevance score ${retrieval.meanScore.toFixed(2)}.`);
    }
    if (retrieval.fallbackReason || retrieval.fallback_reason) {
      reasonParts.push('Fallback triggered in retrieval pipeline.');
    }
    if (retrieval.escalated) {
      reasonParts.push('Escalated to alternate retriever.');
    }
    if (summarySelection?.usedFallback) {
      reasonParts.push('Summary selection fell back to recency heuristics.');
    }
  }

  reasonParts.push(
    passed
      ? 'Meets Azure AI Foundry retrieval evaluator threshold.'
      : 'Below retrieval evaluator threshold, review search parameters.'
  );

  return {
    metric: 'retrieval',
    score,
    threshold: 3,
    passed,
    reason: reasonParts.join(' '),
    evidence
  };
}

function evaluateGroundedness(critic?: CriticReport): EvaluationDimension {
  if (!critic) {
    return {
      metric: 'groundedness',
      score: 2,
      threshold: 3,
      passed: false,
      reason: 'Critic results unavailable; unable to confirm groundedness per Azure AI Foundry guidance.',
      evidence: {}
    };
  }

  let score = critic.grounded ? 4 : 2;
  if (critic.coverage >= 0.85) {
    score += 1;
  }
  if (critic.coverage < 0.6) {
    score -= 1;
  }
  if (critic.issues?.some((issue) => /hallucin/i.test(issue))) {
    score -= 1;
  }

  score = clamp(score, 1, 5);
  const passed = score >= 3;
  const reason = critic.grounded
    ? `Critic accepted answer with ${(critic.coverage * 100).toFixed(0)}% coverage; groundedness evaluator passes.`
    : 'Critic requested revision or detected fabrication; fails groundedness evaluator.';

  return {
    metric: 'groundedness',
    score,
    threshold: 3,
    passed,
    reason,
    evidence: {
      grounded: critic.grounded,
      coverage: critic.coverage,
      issues: critic.issues
    }
  };
}

function evaluateResponseCompleteness(critic?: CriticReport): EvaluationDimension {
  const coverage = critic?.coverage;
  const score = likertFromFraction(coverage);
  const passed = score >= 3;
  const reason = typeof coverage === 'number'
    ? `Response coverage at ${(coverage * 100).toFixed(0)}%; ${passed ? 'meets' : 'below'} response completeness threshold.`
    : 'Coverage unknown; cannot confirm completeness.';

  return {
    metric: 'response_completeness',
    score,
    threshold: 3,
    passed,
    reason,
    evidence: {
      coverage
    }
  };
}

function evaluateRelevance(
  question: string,
  answer: string,
  citations: Reference[],
  retrieval?: RetrievalDiagnostics
): EvaluationDimension {
  const normalizedQuestion = question.trim().toLowerCase();
  const normalizedAnswer = answer.trim().toLowerCase();
  const referenced = citations.length > 0;

  let score = 3;
  if (!normalizedAnswer) {
    score = 1;
  } else {
    const firstToken = normalizedQuestion.split(/\s+/).find(Boolean);
    if (firstToken && normalizedAnswer.includes(firstToken)) {
      score += 1;
    }
    if (referenced) {
      score += 1;
    }
    if (!retrieval?.succeeded) {
      score -= 1;
    }
  }

  score = clamp(score, 1, 5);
  const passed = score >= 3;
  const reasonParts = [referenced ? 'Answer cites retrieved content.' : 'Answer missing citations.'];
  if (retrieval && !retrieval.succeeded) {
    reasonParts.push('Retrieval pipeline reported failure.');
  }
  if (normalizedAnswer.length < normalizedQuestion.length) {
    reasonParts.push('Response shorter than query; may not fully address user intent.');
  }

  reasonParts.push(passed ? 'Satisfies relevance evaluator guidance.' : 'Needs manual review for relevance.');

  return {
    metric: 'relevance',
    score,
    threshold: 3,
    passed,
    reason: reasonParts.join(' '),
    evidence: {
      citations: citations.length,
      retrievalSucceeded: retrieval?.succeeded ?? false
    }
  };
}

function evaluateCoherence(answer: string): EvaluationDimension {
  const sentences = answer
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const averageSentenceLength = sentences.length
    ? sentences.reduce((acc, sentence) => acc + sentence.split(/\s+/).length, 0) / sentences.length
    : 0;

  let score = 2;
  if (sentences.length >= 2) {
    score += 1;
  }
  if (averageSentenceLength >= 8) {
    score += 1;
  }
  if (sentences.length >= 3 && averageSentenceLength >= 12) {
    score += 1;
  }

  score = clamp(score, 1, 5);
  const passed = score >= 3;

  return {
    metric: 'coherence',
    score,
    threshold: 3,
    passed,
    reason: passed
      ? 'Response contains multi-sentence structure aligned with Coherence evaluator guidance.'
      : 'Response is terse or fragmented; consider revision for coherence.',
    evidence: {
      sentences: sentences.length,
      averageSentenceLength
    }
  };
}

function evaluateFluency(answer: string): EvaluationDimension {
  const tokens = answer.split(/\s+/).filter(Boolean);
  const containsPlaceholders = /\[(quality review|Quality review notes)/i.test(answer);

  let score = 3;
  if (tokens.length < 10) {
    score -= 1;
  }
  if (containsPlaceholders) {
    score -= 1;
  }
  if (/\b(umm|uh|\?\?\?)/i.test(answer)) {
    score -= 1;
  }
  if (/[\n]{2,}/.test(answer)) {
    score += 1;
  }

  score = clamp(score, 1, 5);
  const passed = score >= 3;

  return {
    metric: 'fluency',
    score,
    threshold: 3,
    passed,
    reason: passed
      ? 'Response length and cadence align with Fluency evaluator expectations.'
      : 'Response may be too short or contain placeholders impacting fluency.',
    evidence: {
      tokenLength: tokens.length,
      containsPlaceholders
    }
  };
}

const SAFETY_PATTERNS: Array<{ category: SafetyEvaluationCategory; regex: RegExp; note: string }> = [
  { category: 'hate_and_unfairness', regex: /\b(racist|bigot|violence against|inferior race)\b/i, note: 'Potential hate or unfairness language detected.' },
  { category: 'sexual', regex: /\b(explicit|porn|sexual act)\b/i, note: 'Potential sexual content detected.' },
  { category: 'violence', regex: /\b(kill|attack|shoot|bomb)\b/i, note: 'Potential violent content detected.' },
  { category: 'self_harm', regex: /\b(suicide|self-harm|self harm|harm myself)\b/i, note: 'Potential self-harm content detected.' },
  { category: 'protected_materials', regex: /\bcopyright\b/i, note: 'Potential protected material reference detected.' },
  { category: 'code_vulnerability', regex: /\b(eval\(|exec\(|system\(|rm -rf\b)/i, note: 'Potential unsafe code pattern detected.' }
];

function evaluateSafety(answer: string, critic?: CriticReport) {
  const categories: SafetyEvaluationCategory[] = [];
  const notes: string[] = [];

  for (const pattern of SAFETY_PATTERNS) {
    if (pattern.regex.test(answer)) {
      categories.push(pattern.category);
      notes.push(pattern.note);
    }
  }

  if (critic?.issues?.some((issue) => /ungrounded/i.test(issue))) {
    categories.push('ungrounded_attributes');
    notes.push('Critic flagged ungrounded attributes.');
  }

  const uniqueCategories = Array.from(new Set(categories));

  return {
    flagged: uniqueCategories.length > 0,
    categories: uniqueCategories,
    reason: uniqueCategories.length ? notes.join(' ') : undefined,
    evidence: uniqueCategories.length
      ? {
          issues: critic?.issues,
          notes
        }
      : undefined
  } satisfies NonNullable<SessionEvaluation['safety']>;
}

export function buildSessionEvaluation(options: BuildSessionEvaluationOptions): SessionEvaluation {
  const {
    question,
    answer,
    retrieval,
    critic,
    citations,
    summarySelection,
    plan,
    route,
    referencesUsed = 0,
    webResultsUsed = 0,
    retrievalMode,
    lazySummaryTokens,
    criticIterations,
    finalCriticAction,
    activity
  } = options;

  const retrievalDimension = evaluateRetrieval(retrieval, summarySelection);
  const groundednessDimension = evaluateGroundedness(critic);
  const completenessDimension = evaluateResponseCompleteness(critic);
  const relevanceDimension = evaluateRelevance(question, answer, citations, retrieval);
  const coherenceDimension = evaluateCoherence(answer);
  const fluencyDimension = evaluateFluency(answer);
  const safetySnapshot = evaluateSafety(answer, critic);
  const intentResolutionDimension = evaluateIntentResolution(plan, route, retrieval);
  const toolCallDimension = evaluateToolCallAccuracy(
    plan,
    referencesUsed,
    webResultsUsed,
    retrieval,
    activity,
    retrievalMode
  );
  const taskAdherenceDimension = evaluateTaskAdherence(
    plan,
    criticIterations,
    finalCriticAction,
    activity,
    retrieval,
    summarySelection,
    lazySummaryTokens
  );

  const rag = stripUndefined({
    retrieval: retrievalDimension,
    documentRetrieval: undefined,
    groundedness: groundednessDimension,
    groundednessPro: undefined,
    relevance: relevanceDimension,
    responseCompleteness: completenessDimension
  }) as SessionEvaluation['rag'];

  const quality = stripUndefined({
    coherence: coherenceDimension,
    fluency: fluencyDimension,
    qa: undefined
  }) as SessionEvaluation['quality'];

  const agent = stripUndefined({
    intentResolution: intentResolutionDimension,
    toolCallAccuracy: toolCallDimension,
    taskAdherence: taskAdherenceDimension
  }) as SessionEvaluation['agent'];

  const failingMetrics: string[] = [];
  const appendFailing = (group: string, dimension?: EvaluationDimension) => {
    if (dimension && !dimension.passed) {
      failingMetrics.push(`${group}.${dimension.metric}`);
    }
  };

  appendFailing('rag', rag?.retrieval);
  appendFailing('rag', rag?.groundedness);
  appendFailing('rag', rag?.responseCompleteness);
  appendFailing('rag', rag?.relevance);
  appendFailing('quality', quality?.coherence);
  appendFailing('quality', quality?.fluency);
  appendFailing('agent', agent?.intentResolution);
  appendFailing('agent', agent?.toolCallAccuracy);
  appendFailing('agent', agent?.taskAdherence);

  const status: SessionEvaluation['summary']['status'] = failingMetrics.length === 0 && !safetySnapshot.flagged
    ? 'pass'
    : 'needs_review';

  return {
    rag,
    quality,
    agent,
    safety: safetySnapshot,
    summary: {
      status,
      failingMetrics,
      generatedAt: new Date().toISOString()
    }
  };
}
