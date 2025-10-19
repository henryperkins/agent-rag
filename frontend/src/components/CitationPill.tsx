import React from 'react';
import type { Citation } from '../types';

interface CitationPillProps {
  number: number; // 1-based index
  citation?: Citation;
  messageId?: string; // Optional message ID for scoped targeting
}

export function CitationPill({ number, citation, messageId }: CitationPillProps) {
  const title = citation ? `${citation.title ?? 'Source'}${citation.url ? ` • ${citation.url}` : ''}` : `Source ${number}`;

  const scrollToSource = () => {
    // Try message-scoped ID first, then fallback to global ID
    const scopedId = messageId ? `source-${messageId}-${number}` : null;
    const globalId = `source-${number}`;

    const el = (scopedId && document.getElementById(scopedId)) || document.getElementById(globalId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('source-card--highlight');
      setTimeout(() => el.classList.remove('source-card--highlight'), 1600);
    }
  };

  return (
    <span
      role="button"
      tabIndex={0}
      title={title}
      className="citation-pill"
      onClick={scrollToSource}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && scrollToSource()}
      aria-label={`Show source ${number}`}
    >
      [{number}]
    </span>
  );
}

