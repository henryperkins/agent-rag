interface CritiqueAttempt {
  attempt: number;
  grounded: boolean;
  coverage: number;
  action: 'accept' | 'revise';
  issues?: string[];
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

  if (!plan && !context && !telemetry && !trace && !hasCritique && !hasWeb) {
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

      {telemetry && Object.keys(telemetry).length > 0 && (
        <div className="plan-section">
          <h4>Telemetry</h4>
          <pre>{JSON.stringify(telemetry, null, 2)}</pre>
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
