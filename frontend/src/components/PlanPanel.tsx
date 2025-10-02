interface PlanPanelProps {
  plan?: unknown;
  context?: { history?: string; summary?: string; salience?: string };
  telemetry?: Record<string, unknown> | undefined;
  trace?: Record<string, unknown> | undefined;
}

export function PlanPanel({ plan, context, telemetry, trace }: PlanPanelProps) {
  if (!plan && !context && !telemetry && !trace) {
    return null;
  }

  return (
    <section className="plan-panel">
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

      {trace && (
        <div className="plan-section">
          <h4>Trace</h4>
          <pre>{JSON.stringify(trace, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
