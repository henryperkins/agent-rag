import React, { PropsWithChildren, useState } from 'react';

interface MetricCardProps {
  title: string;
  value?: string | number;
  subtitle?: string;
  expandableContent?: React.ReactNode;
  className?: string;
}

export function MetricCard({ title, value, subtitle, expandableContent, className, children }: PropsWithChildren<MetricCardProps>) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`metric-card${className ? ` ${className}` : ''}`}>
      <h4>{title}</h4>
      {value !== undefined && <div className="metric-value">{value}</div>}
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}
      {children}
      {expandableContent && (
        <div className="metric-details">
          <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls={`metric-${title}-details`} style={{
            border: '1px solid #d1d5db', background: '#f9fafb', padding: '6px 10px', borderRadius: 8, fontWeight: 600, cursor: 'pointer'
          }}>
            {expanded ? 'Hide details' : 'Show details'}
          </button>
          {expanded && (
            <div id={`metric-${title}-details`} style={{ marginTop: 8 }}>
              {expandableContent}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

