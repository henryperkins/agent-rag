import type { ActivityStep } from '../types';

interface ActivityPanelProps {
  activity: ActivityStep[];
  status: string;
  critique?: { score?: number; reasoning?: string; action?: string };
}

export function ActivityPanel({ activity, status, critique }: ActivityPanelProps) {
  return (
    <section className="activity-panel">
      <header>
        <h3>Activity</h3>
        <span className="status">Status: {status}</span>
      </header>

      {activity.length === 0 ? (
        <p className="sidebar-empty">No retrieval activity yet.</p>
      ) : (
        <ol className="activity-timeline">
          {activity.map((step, index) => (
            <li key={`${step.type}-${index}`}>
              <div className="activity-type">{step.type}</div>
              <div className="activity-description">{step.description}</div>
              {step.timestamp && <div className="activity-time">{step.timestamp}</div>}
            </li>
          ))}
        </ol>
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
