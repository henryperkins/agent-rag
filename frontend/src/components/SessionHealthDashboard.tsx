import React, { useMemo } from 'react';
import type { ActivityStep, ChatResponse } from '../types';
import { MetricCard } from './MetricCard';
import { ProgressBar } from './ProgressBar';
import { transformMetadataToMetrics } from '../utils/telemetryTransform';

interface SessionHealthDashboardProps {
  metadata?: ChatResponse['metadata'] | Record<string, any>;
  activity?: ActivityStep[];
  isStreaming?: boolean;
  statusHistory?: Array<{ stage: string; ts: number }>;
}

function pctColor(p: number): 'success' | 'warning' | 'error' {
  if (p >= 80) return 'success';
  if (p >= 60) return 'warning';
  return 'error';
}

export function SessionHealthDashboard({ metadata, activity: _activity, isStreaming, statusHistory }: SessionHealthDashboardProps) {
  const metrics = useMemo(() => transformMetadataToMetrics(metadata, statusHistory), [metadata, statusHistory]);

  const qualityPct = Math.round(metrics.quality.score);

  return (
    <section className="health-dashboard" aria-label="Session health metrics">
      <MetricCard
        title="Quality"
        value={`${qualityPct}%`}
        subtitle={metrics.quality.grounded ? 'Grounded' : 'Needs grounding'}
      >
        <ProgressBar value={qualityPct} color={pctColor(qualityPct)} ariaLabel="Quality score" />
      </MetricCard>

      <MetricCard
        title="Speed"
        value={metrics.performance.total != null ? `${Math.round(metrics.performance.total)} ms` : '—'}
        subtitle={isStreaming ? 'Live' : 'Last run'}
        expandableContent={(
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Planning: {metrics.performance.planning != null ? `${Math.round(metrics.performance.planning)} ms` : '—'}</li>
            <li>Retrieval: {metrics.performance.retrieval != null ? `${Math.round(metrics.performance.retrieval)} ms` : '—'}</li>
            <li>Synthesis: {metrics.performance.synthesis != null ? `${Math.round(metrics.performance.synthesis)} ms` : '—'}</li>
          </ul>
        )}
      />

      <MetricCard
        title="Cost"
        value={`${metrics.cost.total?.toLocaleString?.() ?? metrics.cost.total}`}
        subtitle={`Context ${metrics.cost.context?.toLocaleString?.() ?? metrics.cost.context}${metrics.cost.generation ? ` · Gen ${metrics.cost.generation.toLocaleString?.() ?? metrics.cost.generation}` : ''}`}
      />
    </section>
  );
}
