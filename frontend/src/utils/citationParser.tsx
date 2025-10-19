import React from 'react';
import type { Citation } from '../types';
import { CitationPill } from '../components/CitationPill';

// Parses text like: "Azure provides search [1] with ranking [2]."
// Returns an array of React nodes with CitationPill components for bracketed numbers.
export function parseMessageWithCitations(content: string, citations?: Citation[], messageId?: string) {
  const nodes: React.ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const start = match.index;
    const end = regex.lastIndex;
    const numStr = match[1];
    const num = parseInt(numStr, 10);
    if (start > lastIndex) {
      nodes.push(content.slice(lastIndex, start));
    }
    const citation = citations && citations[num - 1];
    nodes.push(<CitationPill key={`cit-${start}-${num}`} number={num} citation={citation} messageId={messageId} />);
    lastIndex = end;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }
  return nodes;
}

