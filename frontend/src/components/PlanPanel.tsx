import type {
  EvaluationDimension,
  FeatureFlag,
  FeatureSelectionMetadata,
  RetrievalDiagnostics,
  RouteMetadata,
  SessionEvaluation,
  SummarySelectionStats
} from '../types';

interface CritiqueAttempt {
  attempt: number;
  grounded: boolean;
  coverage: number;
  action: 'accept' | 'revise';
  issues?: string[];
}

function isSummarySelectionStats(value: unknown): value is SummarySelectionStats {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const stats = value as SummarySelectionStats;
  return typeof stats.totalCandidates === 'number' && typeof stats.selectedCount === 'number';
}

function normalizeTelemetryMap(raw: Record<string, unknown>) {
  const normalized: Record<string, unknown> = { ...raw };

  if (raw.context_budget && !normalized.contextBudget) {
    normalized.contextBudget = raw.context_budget;
  }
  if (raw.summary_selection && !normalized.summarySelection) {
    normalized.summarySelection = raw.summary_selection;
  }
  if (raw.web_context && !normalized.webContext) {
    normalized.webContext = raw.web_context;
  }
  if (raw.query_decomposition && !normalized.queryDecomposition) {
    normalized.queryDecomposition = raw.query_decomposition;
  }
  if (raw.retrieval_mode && !normalized.retrievalMode) {
    normalized.retrievalMode = raw.retrieval_mode;
  }
  if (raw.lazy_summary_tokens !== undefined && normalized.lazySummaryTokens === undefined) {
    normalized.lazySummaryTokens = raw.lazy_summary_tokens;
  }
  if (raw.semantic_memory && !normalized.semanticMemory) {
    normalized.semanticMemory = raw.semantic_memory;
  }
  if (raw.metadata && typeof raw.metadata === 'object') {
    const metadata = raw.metadata as Record<string, unknown>;
    if (metadata.route && !normalized.route) {
      normalized.route = metadata.route;
    }
    if (metadata.evaluation && !normalized.evaluation) {
      normalized.evaluation = metadata.evaluation;
    }
  }

  return normalized;
}

interface PlanPanelProps {
  plan?: unknown;
  context?: { history?: string; summary?: string; salience?: string };
  telemetry?: Record<string, unknown> | undefined;
  trace?: Record<string, unknown> | undefined;
  critiqueHistory?: CritiqueAttempt[];
  webContext?: {
    text?: string;
    tokens?: number;
    trimmed?: boolean;
    results?: Array<{ id?: string; title?: string; url?: string; rank?: number }>;
  };
  route?: RouteMetadata;
  retrievalMode?: string;
  lazySummaryTokens?: number;
  retrieval?: RetrievalDiagnostics;
  responses?: Array<{ attempt: number; responseId?: string }>;
  evaluation?: SessionEvaluation;
  features?: FeatureSelectionMetadata;
}

const FEATURE_LABELS: Record<FeatureFlag, string> = {
  ENABLE_MULTI_INDEX_FEDERATION: 'Multi-index federation',
  ENABLE_LAZY_RETRIEVAL: 'Lazy retrieval',
  ENABLE_SEMANTIC_SUMMARY: 'Semantic summary selection',
  ENABLE_INTENT_ROUTING: 'Intent routing',
  ENABLE_SEMANTIC_MEMORY: 'Semantic memory',
  ENABLE_QUERY_DECOMPOSITION: 'Query decomposition',
  ENABLE_WEB_RERANKING: 'Web reranking',
  ENABLE_SEMANTIC_BOOST: 'Semantic boost',
  ENABLE_RESPONSE_STORAGE: 'Response storage',
  ENABLE_ADAPTIVE_RETRIEVAL: 'Adaptive retrieval'
};

export function PlanPanel({
  plan,
  context,
  telemetry,
  trace,
  critiqueHistory,
  webContext,
  route,
  retrievalMode,
  lazySummaryTokens,
  retrieval,
  responses,
  evaluation: evaluationProp,
  features
}: PlanPanelProps) {
  const hasCritique = Boolean(critiqueHistory && critiqueHistory.length);
  const hasWeb = Boolean(webContext?.text || webContext?.results?.length);

  const normalizedTelemetry = telemetry && typeof telemetry === 'object'
    ? normalizeTelemetryMap(telemetry as Record<string, unknown>)
    : undefined;

  const summarySelectionValue = normalizedTelemetry?.summarySelection;
  const summarySelection = isSummarySelectionStats(summarySelectionValue) ? summarySelectionValue : undefined;

  const cleanedTelemetry = normalizedTelemetry
    ? Object.fromEntries(
        Object.entries(normalizedTelemetry).filter(([key]) => key !== 'summarySelection' && key !== 'evaluation')
      )
    : undefined;

  const hasTelemetry = cleanedTelemetry ? Object.keys(cleanedTelemetry).length > 0 : false;
  const hasRouting = Boolean(route || retrievalMode || typeof lazySummaryTokens === 'number');
  const hasRetrieval = Boolean(retrieval);
  const hasResponses = Boolean(responses && responses.length > 0);
  const telemetryEvaluation = normalizedTelemetry?.evaluation;
  const evaluation = isSessionEvaluation(evaluationProp)
    ? evaluationProp
    : isSessionEvaluation(telemetryEvaluation)
      ? telemetryEvaluation
      : undefined;
  const activeFeatures = features?.resolved
    ? Object.entries(features.resolved)
        .filter(([flag, enabled]) => enabled && FEATURE_LABELS[flag as FeatureFlag])
        .map(([flag]) => flag as FeatureFlag)
    : [];
  const hasFeatures = activeFeatures.length > 0;

  if (!plan && !context && !hasTelemetry && !summarySelection && !trace && !hasCritique && !hasWeb && !hasRouting && !hasRetrieval && !hasResponses && !evaluation && !hasFeatures) {
    return null;
  }

  return (
    <section className="plan-panel">
      {hasCritique && critiqueHistory && (
        <div className="plan-section">
          <h4>Critique History ({critiqueHistory.length} iteration{critiqueHistory.length > 1 ? 's' : ''})</h4>
          <div className="critique-timeline">
            {critiqueHistory.map((critique, idx) => (
              <div key={idx} className={`critique-attempt critique-${critique.action}`}>
                <div className="critique-header">
                  <span className="critique-attempt-number">Attempt {critique.attempt + 1}</span>
                  <span className={`critique-badge critique-badge-${critique.action}`}>
                    {critique.action === 'accept' ? '✓ Accepted' : '↻ Revise'}
                  </span>
                  <span className="critique-coverage">
                    Coverage: {(critique.coverage * 100).toFixed(0)}%
                  </span>
                  <span className={`critique-grounded ${critique.grounded ? 'grounded-yes' : 'grounded-no'}`}>
                    {critique.grounded ? '✓ Grounded' : '⚠ Not grounded'}
                  </span>
                </div>
                {critique.issues && critique.issues.length > 0 && (
                  <div className="critique-issues">
                    <strong>Issues:</strong>
                    <ul>
                      {critique.issues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {plan != null && (
        <div className="plan-section">
          <h4>Plan</h4>
          <pre>{JSON.stringify(plan, null, 2)}</pre>
        </div>
      )}

      {context && (
        <div className="plan-section">
          <h4>Context Snapshot</h4>
          {context.history && (
            <details>
              <summary>History</summary>
              <pre>{context.history}</pre>
            </details>
          )}
          {context.summary && (
            <details>
              <summary>Summary</summary>
              <pre>{context.summary}</pre>
            </details>
          )}
          {context.salience && (
            <details>
              <summary>Salience</summary>
              <pre>{context.salience}</pre>
            </details>
          )}
        </div>
      )}

      {hasFeatures && (
        <div className="plan-section">
          <h4>Active Features</h4>
          <ul className="feature-list">
            {activeFeatures.map((flag) => (
              <li key={flag}>
                <span>{FEATURE_LABELS[flag]}</span>
                {features?.sources?.[flag] && (
                  <span className={`feature-source feature-source-${features.sources[flag]}`}>
                    {features.sources[flag] === 'override'
                      ? 'Override'
                      : features.sources[flag] === 'persisted'
                        ? 'Session'
                        : 'Default'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {summarySelection && (
        <div className="plan-section">
          <h4>Summary Selection</h4>
          <div className="summary-selection-grid">
            <StatBlock label="Mode" value={summarySelection.mode === 'semantic' ? 'Semantic' : 'Recency'} />
            <StatBlock
              label="Selected"
              value={`${summarySelection.selectedCount}/${summarySelection.totalCandidates}`}
            />
            <StatBlock
              label="Discarded"
              value={summarySelection.discardedCount.toString()}
            />
            <StatBlock
              label="Fallback"
              value={summarySelection.usedFallback ? 'Yes' : 'No'}
            />
            {summarySelection.meanScore !== undefined && (
              <StatBlock
                label="Mean Score"
                value={summarySelection.meanScore.toFixed(2)}
              />
            )}
            {summarySelection.maxSelectedScore !== undefined && (
              <StatBlock
                label="Top Score"
                value={summarySelection.maxSelectedScore.toFixed(2)}
              />
            )}
            {summarySelection.minSelectedScore !== undefined && (
              <StatBlock
                label="Lowest Selected"
                value={summarySelection.minSelectedScore.toFixed(2)}
              />
            )}
          </div>
          {summarySelection.error && (
            <div className="summary-selection-error">Fallback reason: {summarySelection.error}</div>
          )}
        </div>
      )}

      {hasRouting && (
        <div className="plan-section">
          <h4>Routing & Retrieval</h4>
          {route && (
            <div className="summary-selection-grid">
              <StatBlock
                label="Intent"
                value={`${route.intent}${typeof route.confidence === 'number' ? ` (${Math.round(route.confidence * 100)}%)` : ''}`}
              />
              <StatBlock label="Model" value={route.model} />
              <StatBlock label="Retriever" value={route.retrieverStrategy} />
              <StatBlock label="Max Tokens" value={route.maxTokens.toString()} />
            </div>
          )}
          {route?.insights && route.insights.length > 0 && (
            <div className="plan-routing-meta">
              <strong>Classifier Insight:</strong>
              <ul className="plan-insight-list">
                {route.insights.map((insight, idx) => (
                  <li key={`${insight}-${idx}`}>{insight}</li>
                ))}
              </ul>
            </div>
          )}
          {retrievalMode && (
            <div className="plan-routing-meta">Retrieval Mode: {retrievalMode === 'lazy' ? 'Lazy (summaries first)' : 'Direct'}</div>
          )}
          {typeof lazySummaryTokens === 'number' && (
            <div className="plan-routing-meta">Lazy Summary Tokens: {lazySummaryTokens}</div>
          )}
        </div>
      )}

      {hasRetrieval && retrieval && (
        <div className="plan-section">
          <h4>Retrieval Diagnostics</h4>
          <div className="summary-selection-grid">
            <StatBlock label="Mode" value={retrieval.attempted} />
            <StatBlock label="Status" value={retrieval.succeeded ? 'Success' : 'Failed'} />
            <StatBlock label="Documents" value={retrieval.documents.toString()} />
            {typeof retrieval.highlightedDocuments === 'number' && (
              <StatBlock label="Highlighted" value={retrieval.highlightedDocuments.toString()} />
            )}
            {typeof retrieval.meanScore === 'number' && (
              <StatBlock label="Mean Score" value={retrieval.meanScore.toFixed(3)} />
            )}
            {typeof retrieval.minScore === 'number' && (
              <StatBlock label="Min Score" value={retrieval.minScore.toFixed(3)} />
            )}
            {typeof retrieval.maxScore === 'number' && (
              <StatBlock label="Max Score" value={retrieval.maxScore.toFixed(3)} />
            )}
            {typeof retrieval.thresholdUsed === 'number' && (
              <StatBlock label="Threshold" value={retrieval.thresholdUsed.toFixed(2)} />
            )}
            {retrieval.escalated && <StatBlock label="Escalated" value="Yes" />}
            {typeof retrieval.summaryTokens === 'number' && (
              <StatBlock label="Summary Tokens" value={retrieval.summaryTokens.toString()} />
            )}
          </div>
          {retrieval.fallbackReason && (
            <div className="plan-routing-meta" style={{ marginTop: '0.5rem' }}>
              Fallback Reason: {retrieval.fallbackReason.replace(/_/g, ' ')}
            </div>
          )}
        </div>
      )}

      {hasResponses && responses && (
        <div className="plan-section">
          <h4>Response History ({responses.length} attempt{responses.length > 1 ? 's' : ''})</h4>
          <div className="responses-list">
            {responses.map((response, idx) => (
              <div key={idx} className="response-entry">
                <span className="response-attempt">Attempt {response.attempt + 1}</span>
                {response.responseId ? (
                  <div className="response-actions">
                    <code className="response-id" title={response.responseId}>
                      {response.responseId.slice(0, 12)}...
                    </code>
                    <button
                      className="response-action-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(response.responseId!);
                      }}
                      title="Copy Response ID"
                    >
                      Copy
                    </button>
                  </div>
                ) : (
                  <span className="response-no-id">No ID</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {cleanedTelemetry && Object.keys(cleanedTelemetry).length > 0 && (
        <div className="plan-section">
          <h4>Telemetry</h4>
          <pre>{JSON.stringify(cleanedTelemetry, null, 2)}</pre>
        </div>
      )}

      {evaluation && (
        <div className="plan-section">
          <h4>Evaluation Summary</h4>
          <div className="summary-selection-grid">
            <StatBlock label="Status" value={evaluation.summary.status === 'pass' ? 'Pass' : 'Needs Review'} />
            <StatBlock label="Generated" value={formatTimestamp(evaluation.summary.generatedAt)} />
            <StatBlock label="Failures" value={evaluation.summary.failingMetrics.length.toString()} />
          </div>
          {evaluation.summary.failingMetrics.length > 0 && (
            <div className="evaluation-failures">
              <strong>Failing Metrics:</strong>
              <ul>
                {evaluation.summary.failingMetrics.map((metric) => (
                  <li key={metric}>{metric}</li>
                ))}
              </ul>
            </div>
          )}
          <EvaluationGroup title="RAG" snapshot={evaluation.rag as Record<string, EvaluationDimension | undefined> | undefined} />
          <EvaluationGroup title="Quality" snapshot={evaluation.quality as Record<string, EvaluationDimension | undefined> | undefined} />
          <EvaluationGroup title="Agent" snapshot={evaluation.agent as Record<string, EvaluationDimension | undefined> | undefined} />
          {evaluation.safety && (
            <div className="evaluation-group">
              <h5>Safety</h5>
              <p>{evaluation.safety.flagged ? '⚠ Flags detected' : '✓ Clear'}</p>
              {evaluation.safety.categories.length > 0 && (
                <ul>
                  {evaluation.safety.categories.map((category) => (
                    <li key={category}>{category}</li>
                  ))}
                </ul>
              )}
              {evaluation.safety.reason && <p>{evaluation.safety.reason}</p>}
            </div>
          )}
        </div>
      )}

      {hasWeb && webContext && (
        <div className="plan-section">
          <h4>Web Evidence</h4>
          <div className="plan-web-meta">
            {webContext.tokens !== undefined && <span>Tokens: {webContext.tokens}</span>}
            {webContext.trimmed && <span className="plan-web-trimmed">Trimmed</span>}
          </div>
          {webContext.results?.length ? (
            <ul className="plan-web-list">
              {webContext.results.map((result, index) => (
                <li key={result.id ?? result.url ?? index}>
                  <strong>{result.title ?? `Result ${index + 1}`}</strong>
                  {result.url && (
                    <div>
                      <a href={result.url} target="_blank" rel="noreferrer">
                        {result.url}
                      </a>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {webContext.text && (
            <details>
              <summary>Context Text</summary>
              <pre>{webContext.text}</pre>
            </details>
          )}
        </div>
      )}

      {trace && (
        <div className="plan-section">
          <h4>Trace</h4>
          <pre>{JSON.stringify(trace, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}

interface StatBlockProps {
  label: string;
  value: string;
}

function StatBlock({ label, value }: StatBlockProps) {
  return (
    <div className="summary-selection-item">
      <span className="summary-selection-label">{label}</span>
      <span className="summary-selection-value">{value}</span>
    </div>
  );
}

function isEvaluationDimension(value: unknown): value is EvaluationDimension {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as EvaluationDimension).metric === 'string' &&
    typeof (value as EvaluationDimension).score === 'number'
  );
}

function isSessionEvaluation(value: unknown): value is SessionEvaluation {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as SessionEvaluation).summary === 'object' &&
    typeof (value as SessionEvaluation).summary.status === 'string'
  );
}

function formatMetricName(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTimestamp(value: string) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}

function EvaluationGroup({
  title,
  snapshot
}: {
  title: string;
  snapshot: Record<string, EvaluationDimension | undefined> | undefined;
}) {
  if (!snapshot) {
    return null;
  }

  const entries = Object.entries(snapshot).filter(([, value]) => isEvaluationDimension(value)) as Array<[
    string,
    EvaluationDimension
  ]>;

  if (!entries.length) {
    return null;
  }

  return (
    <div className="evaluation-group">
      <h5>{title}</h5>
      <ul className="evaluation-metrics">
        {entries.map(([key, dimension]) => (
          <li key={key}>
            <span className="evaluation-metric-name">{formatMetricName(key)}</span>
            <span className="evaluation-metric-score">
              {dimension.score} / {dimension.threshold} {dimension.passed ? '✓' : '⚠'}
            </span>
            <div className="evaluation-metric-reason">{dimension.reason}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
