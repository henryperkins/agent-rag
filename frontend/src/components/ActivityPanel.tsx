import type { ActivityStep } from '../types';

interface ActivityPanelProps {
  activity: ActivityStep[];
  status: string;
  critique?: { score?: number; reasoning?: string; action?: string };
  isStreaming?: boolean;
}

function getStatusIcon(status: 'complete' | 'running' | 'waiting' | 'failed') {
  switch (status) {
    case 'complete':
      return '✓';
    case 'running':
      return '⚙';
    case 'waiting':
      return '⏳';
    case 'failed':
      return '✗';
    default:
      return '•';
  }
}

export function ActivityPanel({ activity, status, critique, isStreaming }: ActivityPanelProps) {
  const items = activity;
  return (
    <section className="activity-panel">
      <header>
        <h3>Activity</h3>
        <span className="status">Status: {status}</span>
      </header>

      {items.length === 0 ? (
        <p className="sidebar-empty">No retrieval activity yet.</p>
      ) : (
        <div className="timeline">
          {items.map((step, idx) => {
            const isLast = idx === items.length - 1;
            const derivedStatus: 'complete' | 'running' | 'waiting' | 'failed' = isLast && (isStreaming || status === 'loading' || status === 'starting') ? 'running' : 'complete';
            const isInsight = step.type === 'insight';
            const marker = isInsight ? '💭' : getStatusIcon(derivedStatus);
            const headingLabel = isInsight ? 'Thought' : step.type.replace(/_/g, ' ');
            return (
              <div className={`timeline-item status-${derivedStatus}${isInsight ? ' timeline-item-insight' : ''}`} key={`${step.type}-${idx}`}>
                <div className="timeline-marker" aria-hidden>{marker}</div>
                <div className="timeline-content">
                  <h4 style={{ margin: 0, fontSize: 13, textTransform: isInsight ? 'none' : 'capitalize' }}>{headingLabel}</h4>
                  <div className={`activity-description${isInsight ? ' activity-description-insight' : ''}`}>{step.description}</div>
                  {step.timestamp && <div className="activity-time">{step.timestamp}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {critique && (
        <div className="critique-card">
          <h4>Quality Check</h4>
          <p><strong>Action:</strong> {critique.action ?? 'n/a'}</p>
          {critique.score !== undefined && <p><strong>Score:</strong> {critique.score.toFixed(2)}</p>}
          {critique.reasoning && <p className="critique-reason">{critique.reasoning}</p>}
        </div>
      )}
    </section>
  );
}
