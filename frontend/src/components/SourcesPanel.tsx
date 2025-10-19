import DOMPurify from 'dompurify';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Citation, ChatMessage } from '../types';
import { ProgressBar } from './ProgressBar';

interface SourcesPanelProps {
  messages: ChatMessage[];
  isStreaming?: boolean;
  streamingCitations?: Citation[]; // Live citations from streaming hook
}

// Sanitize HTML highlights from Azure Search to prevent XSS
// Only allow <em> tags which are used for highlighting matched terms
function sanitizeHighlight(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['em'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
}

type CopyStatus = 'idle' | 'success' | 'error';

export function SourcesPanel({ messages, isStreaming, streamingCitations }: SourcesPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<Record<string, CopyStatus>>({});
  const timeoutRefs = useRef<Record<string, NodeJS.Timeout>>({});

  // Extract citations from all assistant messages + live streaming citations
  const citationsWithMessageId = useMemo(() => {
    const result: Array<{ citation: Citation; messageId: string; index: number }> = [];

    // Add citations from completed messages
    messages.forEach((msg) => {
      if (msg.role === 'assistant' && msg.citations && msg.citations.length > 0) {
        msg.citations.forEach((cit, idx) => {
          result.push({ citation: cit, messageId: msg.id, index: idx });
        });
      }
    });

    // Add live streaming citations with special "streaming" messageId
    if (isStreaming && streamingCitations && streamingCitations.length > 0) {
      streamingCitations.forEach((cit, idx) => {
        result.push({ citation: cit, messageId: 'streaming', index: idx });
      });
    }

    return result;
  }, [messages, isStreaming, streamingCitations]);

  // Calculate max score for normalization (Azure Search scores can exceed 1.0)
  const maxScore = useMemo(() => {
    const scores = citationsWithMessageId.map(c => c.citation.score).filter((s): s is number => typeof s === 'number' && s > 0);
    return scores.length > 0 ? Math.max(...scores) : 1;
  }, [citationsWithMessageId]);

  const copyCitation = useCallback(async (c: Citation, index: number, messageId: string) => {
    // Match the render key format to ensure status tracking is scoped per message
    // Always include messageId to prevent collisions across messages
    const key = `${messageId}-${c.id ?? index}`;
    const page = c.pageNumber ?? c.page_number;
    const text = `[${index + 1}] ${c.title ?? 'Untitled'}${page ? ` (p.${page})` : ''}${c.url ? ` - ${c.url}` : ''}`;

    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus((prev) => ({ ...prev, [key]: 'success' }));

      // Clear any existing timeout for this citation
      if (timeoutRefs.current[key]) {
        clearTimeout(timeoutRefs.current[key]);
      }

      // Reset status after 2 seconds
      timeoutRefs.current[key] = setTimeout(() => {
        setCopyStatus((prev) => ({ ...prev, [key]: 'idle' }));
        delete timeoutRefs.current[key];
      }, 2000);
    } catch {
      setCopyStatus((prev) => ({ ...prev, [key]: 'error' }));

      // Clear any existing timeout for this citation
      if (timeoutRefs.current[key]) {
        clearTimeout(timeoutRefs.current[key]);
      }

      // Reset error status after 3 seconds
      timeoutRefs.current[key] = setTimeout(() => {
        setCopyStatus((prev) => ({ ...prev, [key]: 'idle' }));
        delete timeoutRefs.current[key];
      }, 3000);
    }
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(timeoutRefs.current).forEach((timeout) => {
        if (timeout) clearTimeout(timeout);
      });
    };
  }, []);

  return (
    <aside className="sidebar">
      <header>
        <h3>Sources</h3>
        <span className="badge">{citationsWithMessageId.length}</span>
      </header>

      {citationsWithMessageId.length === 0 ? (
        <p className="sidebar-empty">{isStreaming ? 'Collecting references…' : 'No citations yet.'}</p>
      ) : (
        <div className="sources-list" style={{ display: 'grid', gap: 12 }}>
          {citationsWithMessageId.map(({ citation, messageId, index }) => {
            // Always include messageId in key to ensure uniqueness across messages
            // (same document may be cited in multiple turns with same citation.id)
            const key = `${messageId}-${citation.id ?? index}`;
            const isExpanded = !!expanded[key];
            const snippet = citation.content ?? '';
            const rawScore = citation.score;
            const normalizedScore = typeof rawScore === 'number' && rawScore > 0
              ? Math.round((rawScore / maxScore) * 100)
              : undefined;
            return (
              <div className="source-card" key={key} id={`source-${messageId}-${index + 1}`} data-source-index={index + 1}>
                <div className="source-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="source-index">[{index + 1}]</span>
                    <h4 className="source-title">{citation.title ?? `Reference ${index + 1}`}</h4>
                  </div>
                  {normalizedScore !== undefined && rawScore !== undefined && (
                    <div className="source-score" style={{ minWidth: 120 }}>
                      <ProgressBar
                        value={normalizedScore}
                        ariaLabel={`Relevance score ${rawScore.toFixed(3)} (${normalizedScore}% of max)`}
                      />
                    </div>
                  )}
                </div>
                <div className="source-meta">
                  {(citation.pageNumber ?? citation.page_number) && (
                    <span>Page {citation.pageNumber ?? citation.page_number}</span>
                  )}
                  {citation.url && (
                    <a href={citation.url} target="_blank" rel="noreferrer">View source</a>
                  )}
                </div>
                <div className="source-snippet" data-expanded={isExpanded}>
                  {snippet ? (isExpanded ? snippet : `${snippet.slice(0, 100)}${snippet.length > 100 ? '…' : ''}`) : '—'}
                </div>
                {citation.highlights?.page_chunk?.length ? (
                  <div className="source-highlights" style={{ marginTop: 8 }}>
                    {citation.highlights.page_chunk.map((highlight, highlightIndex) => (
                      <div
                        key={highlightIndex}
                        className="source-highlight"
                        dangerouslySetInnerHTML={{ __html: sanitizeHighlight(highlight) }}
                      />
                    ))}
                  </div>
                ) : null}
                {citation.captions && citation.captions.length > 0 && (
                  <div className="semantic-captions" style={{ marginTop: 8 }}>
                    <div className="caption-label">Relevant excerpts:</div>
                    {citation.captions.map((caption, captionIndex) => (
                      <div key={captionIndex} className="caption-snippet">
                        <div
                          className="caption-text"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeHighlight(caption.highlights || caption.text)
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div className="source-actions">
                  <button
                    onClick={() => copyCitation(citation, index, messageId)}
                    aria-label={`Copy citation ${index + 1}`}
                    disabled={copyStatus[key] === 'success'}
                    className={copyStatus[key] === 'error' ? 'error' : ''}
                  >
                    {copyStatus[key] === 'success'
                      ? '✓ Copied!'
                      : copyStatus[key] === 'error'
                      ? '✗ Copy failed'
                      : 'Copy Citation'}
                  </button>
                  <button
                    onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
                    aria-label={isExpanded ? `Collapse citation ${index + 1}` : `Expand citation ${index + 1}`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? 'Show Less' : 'Show More'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
