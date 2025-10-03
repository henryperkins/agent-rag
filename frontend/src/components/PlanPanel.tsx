import type { SummarySelectionStats } from '../types';

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
}

export function PlanPanel({ plan, context, telemetry, trace, critiqueHistory, webContext }: PlanPanelProps) {
  const hasCritique = Boolean(critiqueHistory && critiqueHistory.length);
  const hasWeb = Boolean(webContext?.text || webContext?.results?.length);

  const rawSummarySelection = telemetry && typeof telemetry === 'object'
    ? ((telemetry as Record<string, unknown>).summarySelection ?? (telemetry as Record<string, unknown>).summary_selection)
    : undefined;

  const summarySelection = isSummarySelectionStats(rawSummarySelection) ? rawSummarySelection : undefined;

  const cleanedTelemetry = telemetry && typeof telemetry === 'object'
    ? Object.fromEntries(
        Object.entries(telemetry as Record<string, unknown>).filter(
          ([key]) => key !== 'summarySelection' && key !== 'summary_selection'
        )
      )
    : telemetry;

  const hasTelemetry = cleanedTelemetry && Object.keys(cleanedTelemetry).length > 0;

  if (!plan && !context && !hasTelemetry && !summarySelection && !trace && !hasCritique && !hasWeb) {
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

      {cleanedTelemetry && Object.keys(cleanedTelemetry).length > 0 && (
        <div className="plan-section">
          <h4>Telemetry</h4>
          <pre>{JSON.stringify(cleanedTelemetry, null, 2)}</pre>
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
