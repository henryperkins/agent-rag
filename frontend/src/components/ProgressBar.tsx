import React from 'react';

interface ProgressBarProps {
  value: number; // 0-100
  max?: number; // default 100
  color?: 'primary' | 'success' | 'warning' | 'error';
  ariaLabel?: string;
}

export function ProgressBar({ value, max = 100, color = 'primary', ariaLabel }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(100, (value / max) * 100));
  const colorMap: Record<string, string> = {
    primary: 'var(--color-primary)',
    success: 'var(--color-success)',
    warning: 'var(--color-warning)',
    error: 'var(--color-error)'
  };
  return (
    <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={ariaLabel}>
      <div className="progress-bar__fill" style={{ width: `${percent}%`, background: colorMap[color] }} />
    </div>
  );
}

