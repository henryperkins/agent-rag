import type { AppConfig } from './app.js';
import { config } from './app.js';

export type ReasoningEffort = 'low' | 'medium' | 'high';
export type ReasoningSummary = 'auto' | 'concise' | 'detailed';

export interface ReasoningOptions {
  effort?: ReasoningEffort;
  summary?: ReasoningSummary;
}

export type ReasoningStage =
  | 'intent'
  | 'planner'
  | 'decomposition'
  | 'compaction'
  | 'critic'
  | 'crag'
  | 'adaptive'
  | 'synthesis';

const stageConfigKeys: Record<
  ReasoningStage,
  { effort: keyof AppConfig; summary: keyof AppConfig }
> = {
  intent: {
    effort: 'REASONING_INTENT_EFFORT',
    summary: 'REASONING_INTENT_SUMMARY'
  },
  planner: {
    effort: 'REASONING_PLANNER_EFFORT',
    summary: 'REASONING_PLANNER_SUMMARY'
  },
  decomposition: {
    effort: 'REASONING_DECOMPOSITION_EFFORT',
    summary: 'REASONING_DECOMPOSITION_SUMMARY'
  },
  compaction: {
    effort: 'REASONING_COMPACTION_EFFORT',
    summary: 'REASONING_COMPACTION_SUMMARY'
  },
  critic: {
    effort: 'REASONING_CRITIC_EFFORT',
    summary: 'REASONING_CRITIC_SUMMARY'
  },
  crag: {
    effort: 'REASONING_CRAG_EFFORT',
    summary: 'REASONING_CRAG_SUMMARY'
  },
  adaptive: {
    effort: 'REASONING_ADAPTIVE_EFFORT',
    summary: 'REASONING_ADAPTIVE_SUMMARY'
  },
  synthesis: {
    effort: 'REASONING_SYNTHESIS_EFFORT',
    summary: 'REASONING_SYNTHESIS_SUMMARY'
  }
};

export function getReasoningOptions(stage: ReasoningStage): ReasoningOptions | undefined {
  const keys = stageConfigKeys[stage];
  if (!keys) {
    return undefined;
  }

  const effort = config[keys.effort] as ReasoningEffort | undefined;
  const summary = config[keys.summary] as ReasoningSummary | undefined;

  const resolvedEffort = effort ?? config.REASONING_DEFAULT_EFFORT;
  const resolvedSummary = summary ?? config.REASONING_DEFAULT_SUMMARY;

  const options: ReasoningOptions = {};
  if (resolvedEffort) {
    options.effort = resolvedEffort;
  }
  if (resolvedSummary) {
    options.summary = resolvedSummary;
  }

  if (!options.effort && !options.summary) {
    return undefined;
  }

  return options;
}
