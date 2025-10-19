import React, { useEffect, useMemo, useState } from 'react';
import type {
  CriticReport,
  FeatureSelectionMetadata,
  RouteMetadata,
  SessionEvaluation,
  SummarySelectionStats,
  PlanSummary,
  PlanStep
} from '../types';
import type { CritiqueAttempt } from '../hooks/useChatStream';
import { ProgressBar } from './ProgressBar';

export enum TelemetryTab {
  Plan = 'plan',
  Context = 'context',
  Critique = 'critique',
  Features = 'features',
  Trace = 'trace'
}

const TAB_KEY = 'agent-rag:telemetry-tab';

export interface TelemetryDataBundle {
  plan?: PlanSummary;
  contextBudget?: Record<string, number>;
  critic?: CriticReport;
  summarySelection?: SummarySelectionStats;
  route?: RouteMetadata;
  critiqueHistory?: CritiqueAttempt[];
  features?: FeatureSelectionMetadata;
  evaluation?: SessionEvaluation;
  responses?: Array<{ attempt: number; responseId?: string }>;
  traceId?: string;
  trace?: Record<string, unknown>;
  webContext?: {
    text?: string;
    tokens?: number;
    trimmed?: boolean;
    results?: Array<{ id?: string; title?: string; url?: string; rank?: number }>;
  };
}

interface TelemetryDrawerProps {
  open: boolean;
  onClose: () => void;
  data?: TelemetryDataBundle;
}

function usePersistentTab() {
  const [tab, setTab] = useState<TelemetryTab>(() => {
    if (typeof window === 'undefined') return TelemetryTab.Plan;
    const saved = window.sessionStorage.getItem(TAB_KEY) as TelemetryTab | null;
    return saved ?? TelemetryTab.Plan;
  });
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(TAB_KEY, tab);
    }
  }, [tab]);
  return { tab, setTab } as const;
}

function bytes(n?: number) {
  if (typeof n !== 'number') return '0';
  return n.toLocaleString();
}

export function TelemetryDrawer({ open, onClose, data }: TelemetryDrawerProps) {
  const { tab, setTab } = usePersistentTab();

  // Keyboard navigation: Close drawer on Escape key
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  const contextParts = useMemo(() => {
    const budget = data?.contextBudget ?? {};
    const history = budget.history_tokens ?? (budget as any).historyTokens ?? 0;
    const summary = budget.summary_tokens ?? (budget as any).summaryTokens ?? 0;
    const salience = budget.salience_tokens ?? (budget as any).salienceTokens ?? 0;
    const web = (budget as any).web_tokens ?? (budget as any).webTokens ?? 0;
    const total = history + summary + salience + web;
    return { history, summary, salience, web, total };
  }, [data?.contextBudget]);

  const className = `telemetry-drawer${open ? ' open' : ''}`;

  const copyJSON = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ ...data }, null, 2));
    } catch {
      // ignore
    }
  };

  const downloadJSON = () => {
    const blob = new Blob([JSON.stringify({ ...data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'telemetry.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className={className} aria-hidden={!open} aria-label="Telemetry drawer">
      <div className="telemetry-header">
        <div className="telemetry-tabs" role="tablist" aria-label="Telemetry tabs">
          {Object.values(TelemetryTab).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`telemetry-tab${tab === t ? ' active' : ''}`}
              onClick={() => setTab(t as TelemetryTab)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <div className="telemetry-actions">
          {data?.traceId && (
            <button onClick={() => navigator.clipboard.writeText(String(data.traceId))}>Copy Trace ID</button>
          )}
          <button onClick={copyJSON}>Copy JSON</button>
          <button onClick={downloadJSON}>Export</button>
          <button onClick={onClose} aria-label="Close telemetry">Close</button>
        </div>
      </div>

      <div className="telemetry-body">
        {tab === TelemetryTab.Plan && (
          <div className="telemetry-panel">
            {data?.route && (
              <div className="plan-routing-meta" style={{ display: 'grid', gap: 8 }}>
                <div>
                  Intent: <strong>{data.route.intent}</strong>
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span>Confidence</span>
                    <span>{(data.route.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <ProgressBar value={Math.max(0, Math.min(100, data.route.confidence * 100))} />
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
                  {data.route.model && <span>Model: {data.route.model}</span>}
                  {data.route.retrieverStrategy && <span>Strategy: {data.route.retrieverStrategy}</span>}
                  {typeof data.route.maxTokens === 'number' && <span>Max tokens: {data.route.maxTokens}</span>}
                </div>
                {data.route.reasoning && (
                  <details>
                    <summary>Reasoning</summary>
                    <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{data.route.reasoning}</p>
                  </details>
                )}
              </div>
            )}
            {data?.plan && (
              <div style={{ display: 'grid', gap: 8 }}>
                <h4 style={{ margin: '8px 0 0' }}>Steps</h4>
                <PlanChips plan={data.plan as any} />
                <details>
                  <summary>Raw Plan JSON</summary>
                  <pre>{JSON.stringify(data.plan, null, 2)}</pre>
                </details>
              </div>
            )}
          </div>
        )}

        {tab === TelemetryTab.Context && (
          <div className="telemetry-panel">
            <div style={{ display: 'grid', gap: 8 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span>Context Budget</span>
                  <span>{bytes(contextParts.total)} tokens</span>
                </div>
                <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>History</span><span>{bytes(contextParts.history)}</span>
                    </div>
                    <ProgressBar value={contextParts.total ? (contextParts.history / contextParts.total) * 100 : 0} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>Summary</span><span>{bytes(contextParts.summary)}</span>
                    </div>
                    <ProgressBar value={contextParts.total ? (contextParts.summary / contextParts.total) * 100 : 0} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>Salience</span><span>{bytes(contextParts.salience)}</span>
                    </div>
                    <ProgressBar value={contextParts.total ? (contextParts.salience / contextParts.total) * 100 : 0} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                      <span>Web</span><span>{bytes(contextParts.web)}</span>
                    </div>
                    <ProgressBar value={contextParts.total ? (contextParts.web / contextParts.total) * 100 : 0} />
                  </div>
                </div>
              </div>
              {data?.summarySelection && (
                <details>
                  <summary>Summary Selection</summary>
                  <pre>{JSON.stringify(data.summarySelection, null, 2)}</pre>
                </details>
              )}
              {data?.webContext && (
                <details>
                  <summary>Web Context</summary>
                  <pre>{JSON.stringify(data.webContext, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        )}

        {tab === TelemetryTab.Critique && (
          <div className="telemetry-panel">
            {data?.critic && (
              <div className={`critique-attempt critique-${data.critic.action}`}>
                <div className="critique-header">
                  <span className="critique-attempt-number">Latest</span>
                  <span className={`critique-badge critique-badge-${data.critic.action}`}>
                    {data.critic.action === 'accept' ? '✓ Accepted' : '↻ Revise'}
                  </span>
                  <span className="critique-coverage">Coverage: {(data.critic.coverage * 100).toFixed(0)}%</span>
                  <span className={`critique-grounded ${data.critic.grounded ? 'grounded-yes' : 'grounded-no'}`}>
                    {data.critic.grounded ? '✓ Grounded' : '⚠ Not grounded'}
                  </span>
                </div>
                {data.critic.issues?.length ? (
                  <div className="critique-issues">
                    <strong>Issues:</strong>
                    <ul>
                      {data.critic.issues.map((i, idx) => (
                        <li key={idx}>{i}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
            {data?.critiqueHistory && Array.isArray(data.critiqueHistory) && (
              <div className="critique-timeline" style={{ marginTop: 12 }}>
                {data.critiqueHistory.map((c: any, idx: number) => (
                  <div key={idx} className={`critique-attempt critique-${c.action}`}>
                    <div className="critique-header">
                      <span className="critique-attempt-number">Attempt {c.attempt + 1}</span>
                      <span className={`critique-badge critique-badge-${c.action}`}>
                        {c.action === 'accept' ? '✓ Accepted' : '↻ Revise'}
                      </span>
                      <span className="critique-coverage">Coverage: {(c.coverage * 100).toFixed(0)}%</span>
                      <span className={`critique-grounded ${c.grounded ? 'grounded-yes' : 'grounded-no'}`}>
                        {c.grounded ? '✓ Grounded' : '⚠ Not grounded'}
                      </span>
                    </div>
                    {c.issues?.length ? (
                      <div className="critique-issues">
                        <strong>Issues:</strong>
                        <ul>
                          {c.issues.map((issue: string, i: number) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === TelemetryTab.Features && (
          <div className="telemetry-panel">
            {data?.features?.resolved ? (
              <ul className="feature-list">
                {Object.entries(data.features.resolved).map(([k, v]) => (
                  <li key={k}>
                    <span>{k}</span>
                    <span>
                      {v ? 'Enabled' : 'Disabled'}
                      {data.features?.sources?.[k as keyof typeof data.features.sources] && (
                        <span className={`feature-source feature-source-${data.features.sources[k as keyof typeof data.features.sources]}`} style={{ marginLeft: 8 }}>
                          {String(data.features.sources[k as keyof typeof data.features.sources])}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sidebar-empty">No feature metadata</p>
            )}
          </div>
        )}

        {tab === TelemetryTab.Trace && (
          <div className="telemetry-panel">
            <div style={{ display: 'grid', gap: 8 }}>
              {data?.traceId && (
                <div>Trace ID: <code>{data.traceId}</code></div>
              )}
              {data?.evaluation && (
                <div>
                  <h4 style={{ margin: '4px 0 8px' }}>Evaluation Summary</h4>
                  <div className="evaluation-group">
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        Status: <strong>{data.evaluation.summary.status}</strong>
                      </div>
                      {data.evaluation.summary.failingMetrics?.length ? (
                        <div className="evaluation-failures">
                          <strong>Failing</strong>
                          <ul>
                            {data.evaluation.summary.failingMetrics.map((m, i) => (
                              <li key={i}>{m}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {data.evaluation.rag && (
                    <div className="evaluation-group">
                      <h5>RAG</h5>
                      <ul className="evaluation-metrics">
                        {Object.entries(data.evaluation.rag).map(([key, dim]: any, i) => (
                          dim && typeof dim === 'object' && 'score' in dim ? (
                            <li key={i}>
                              <div className="evaluation-metric-name">{dim.metric ?? key} {dim.passed === false ? '✗' : '✓'}</div>
                              <div className="evaluation-metric-score">Score {dim.score} / Threshold {dim.threshold}</div>
                              {dim.reason && <div className="evaluation-metric-reason">{dim.reason}</div>}
                            </li>
                          ) : null
                        ))}
                      </ul>
                    </div>
                  )}

                  {data.evaluation.quality && (
                    <div className="evaluation-group">
                      <h5>Quality</h5>
                      <ul className="evaluation-metrics">
                        {Object.entries(data.evaluation.quality).map(([key, dim]: any, i) => (
                          dim && typeof dim === 'object' && 'score' in dim ? (
                            <li key={i}>
                              <div className="evaluation-metric-name">{dim.metric ?? key} {dim.passed === false ? '✗' : '✓'}</div>
                              <div className="evaluation-metric-score">Score {dim.score} / Threshold {dim.threshold}</div>
                              {dim.reason && <div className="evaluation-metric-reason">{dim.reason}</div>}
                            </li>
                          ) : null
                        ))}
                      </ul>
                    </div>
                  )}

                  {data.evaluation.agent && (
                    <div className="evaluation-group">
                      <h5>Agent</h5>
                      <ul className="evaluation-metrics">
                        {Object.entries(data.evaluation.agent).map(([key, dim]: any, i) => (
                          dim && typeof dim === 'object' && 'score' in dim ? (
                            <li key={i}>
                              <div className="evaluation-metric-name">{dim.metric ?? key} {dim.passed === false ? '✗' : '✓'}</div>
                              <div className="evaluation-metric-score">Score {dim.score} / Threshold {dim.threshold}</div>
                              {dim.reason && <div className="evaluation-metric-reason">{dim.reason}</div>}
                            </li>
                          ) : null
                        ))}
                      </ul>
                    </div>
                  )}

                  {data.evaluation.safety && (
                    <div className="evaluation-group">
                      <h5>Safety</h5>
                      <div className="evaluation-metrics">
                        <div className="evaluation-metric-name">Flagged: {data.evaluation.safety.flagged ? 'Yes' : 'No'}</div>
                        {data.evaluation.safety.categories?.length ? (
                          <div className="evaluation-metric-reason">Categories: {data.evaluation.safety.categories.join(', ')}</div>
                        ) : null}
                        {data.evaluation.safety.reason && (
                          <div className="evaluation-metric-reason">{data.evaluation.safety.reason}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {data?.trace && (
                <details>
                  <summary>Trace Events</summary>
                  <pre>{JSON.stringify(data.trace, null, 2)}</pre>
                </details>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function getStepIcon(action: PlanStep['action']): string {
  switch (action) {
    case 'vector_search':
      return '🧭';
    case 'web_search':
      return '🌐';
    case 'both':
      return '🔀';
    case 'answer':
      return '✍️';
    default:
      return '•';
  }
}

function PlanChips({ plan }: { plan: PlanSummary }) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (steps.length === 0) {
    return <p className="sidebar-empty">No plan steps</p>;
  }

  return (
    <div className="plan-chips">
      {steps.map((s, idx) => {
        const icon = getStepIcon(s.action);
        const label =
          s.action === 'vector_search' ? 'Vector Search' :
          s.action === 'web_search' ? 'Web Search' :
          s.action === 'both' ? 'Hybrid' :
          s.action === 'answer' ? 'Answer' : s.action;
        const query = s.query ?? '';
        const title = query ? `${label}: ${query}` : label;
        const k = typeof s.k === 'number' ? s.k : undefined;
        return (
          <div key={idx} className={`plan-chip plan-${s.action}`} title={title}>
            <span className="plan-chip-index">{idx + 1}</span>
            <span className="plan-chip-icon" aria-hidden>{icon}</span>
            <span className="plan-chip-label">{label}</span>
            {k !== undefined && <span className="plan-chip-k">k={k}</span>}
            {query && (
              <span className="plan-chip-query">{query.length > 80 ? `${query.slice(0, 80)}…` : query}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
