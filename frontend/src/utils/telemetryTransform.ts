import type { ChatResponse } from '../types';

export interface HealthMetrics {
  quality: {
    coverage: number;
    grounded: boolean;
    score: number;
  };
  performance: {
    total?: number; // ms
    planning?: number; // ms
    retrieval?: number; // ms
    synthesis?: number; // ms
  };
  cost: {
    context: number;
    generation?: number;
    total: number;
  };
  iterations: number;
}

function getNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

function getBoolean(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function sumContextTokens(contextBudget: Record<string, any> | undefined): number {
  if (!contextBudget) return 0;
  const history = getNumber(contextBudget.history_tokens ?? contextBudget.historyTokens);
  const summary = getNumber(contextBudget.summary_tokens ?? contextBudget.summaryTokens);
  const salience = getNumber(contextBudget.salience_tokens ?? contextBudget.salienceTokens);
  const web = getNumber((contextBudget as any).web_tokens ?? (contextBudget as any).webTokens);
  return history + summary + salience + web;
}

export function sumGenerationTokens(_responses: unknown): number | undefined {
  // Not currently available in metadata; placeholder for future integration.
  return undefined;
}

export function calculateQualityScore(metadata: ChatResponse['metadata'] | Record<string, any> | undefined): number {
  if (!metadata) return 0;
  const critic = (metadata as any).critic_report ?? (metadata as any).critic;
  const coverage = getNumber(critic?.coverage);
  const grounded = getBoolean(critic?.grounded);
  // Simple composite: 70% coverage + 30% groundedness
  const score = coverage * 70 + (grounded ? 30 : 0);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function calculateTotalTime(metadata: ChatResponse['metadata'] | Record<string, any> | undefined): number | undefined {
  if (!metadata) return undefined;
  const t = (metadata as any).retrieval_time_ms ?? (metadata as any).retrievalTimeMs;
  return typeof t === 'number' ? t : undefined;
}

export type StatusStamp = { stage: string; ts: number };

const PLANNING_STAGES = new Set([
  'intent_classification',
  'context',
  'complexity_assessment',
  'query_decomposition',
  'executing_subqueries',
  'planning',
  'plan'
]);
const RETRIEVAL_STAGES = new Set([
  'retrieval',
  'web_search',
  'reranking',
  'confidence_escalation'
]);
const SYNTHESIS_STAGES = new Set([
  'generating',
  'revising',
  'answer',
  'review',
  'synthesis'
]);

function isStage(name: string | undefined | null): name is string {
  return typeof name === 'string' && name.length > 0;
}

export function computeStageDurations(history?: StatusStamp[]): { planning?: number; retrieval?: number; synthesis?: number; total?: number } {
  if (!history || history.length < 2) return {};
  const ordered = [...history].sort((a, b) => a.ts - b.ts);
  let planning = 0;
  let retrieval = 0;
  let synthesis = 0;
  for (let i = 0; i < ordered.length - 1; i++) {
    const curr = ordered[i];
    const next = ordered[i + 1];
    const delta = Math.max(0, next.ts - curr.ts);
    const s = curr.stage;
    if (!isStage(s)) continue;
    if (PLANNING_STAGES.has(s)) planning += delta;
    else if (RETRIEVAL_STAGES.has(s)) retrieval += delta;
    else if (SYNTHESIS_STAGES.has(s)) synthesis += delta;
  }
  const total = Math.max(0, ordered[ordered.length - 1].ts - ordered[0].ts);
  return {
    planning: planning || undefined,
    retrieval: retrieval || undefined,
    synthesis: synthesis || undefined,
    total: total || undefined
  };
}

export function transformMetadataToMetrics(
  metadata: ChatResponse['metadata'] | Record<string, any> | undefined,
  statusHistory?: StatusStamp[]
): HealthMetrics {
  const critic = (metadata as any)?.critic_report ?? (metadata as any)?.critic ?? {};
  const qualityCoverage = getNumber(critic.coverage);
  const qualityGrounded = getBoolean(critic.grounded);
  const score = calculateQualityScore(metadata);

  const contextBudget = (metadata as any)?.context_budget ?? (metadata as any)?.contextBudget;
  const context = sumContextTokens(contextBudget);
  const generation = sumGenerationTokens((metadata as any)?.responses);

  const totalMeta = calculateTotalTime(metadata);
  const stageDurations = computeStageDurations(statusHistory);
  const total = totalMeta ?? stageDurations.total;

  return {
    quality: {
      coverage: Math.max(0, Math.min(100, Math.round(qualityCoverage * 100))) / 100, // normalize to 0-1 for UI rings
      grounded: qualityGrounded,
      score
    },
    performance: {
      total,
      planning: stageDurations.planning,
      retrieval: stageDurations.retrieval,
      synthesis: stageDurations.synthesis
    },
    cost: {
      context,
      generation,
      total: context + (generation ?? 0)
    },
    iterations: getNumber((metadata as any)?.critic_iterations, 1)
  };
}
