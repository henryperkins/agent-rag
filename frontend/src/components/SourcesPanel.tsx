import DOMPurify from 'dompurify';
import type { Citation } from '../types';

interface SourcesPanelProps {
  citations: Citation[];
  isStreaming?: boolean;
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

export function SourcesPanel({ citations, isStreaming }: SourcesPanelProps) {
  return (
    <aside className="sidebar">
      <header>
        <h3>Sources</h3>
        <span className="badge">{citations.length}</span>
      </header>

      {citations.length === 0 ? (
        <p className="sidebar-empty">
          {isStreaming ? 'Collecting references…' : 'No citations yet.'}
        </p>
      ) : (
        <ul className="sources-list">
          {citations.map((citation, index) => (
            <li key={citation.id ?? index} className="source-item">
              <div className="source-title">
                <span className="source-index">[{index + 1}]</span>
                <span>{citation.title ?? `Reference ${index + 1}`}</span>
              </div>
              {(citation.pageNumber ?? citation.page_number) && (
                <div className="source-meta">Page {citation.pageNumber ?? citation.page_number}</div>
              )}
              {citation.score !== undefined && (
                <div className="source-meta">Score {citation.score.toFixed(3)}</div>
              )}
              <p className="source-snippet">
                {citation.content?.slice(0, 160)}
                {citation.content && citation.content.length > 160 ? '…' : ''}
              </p>
              {citation.highlights?.page_chunk?.length ? (
                <div className="source-highlights">
                  {citation.highlights.page_chunk.map((highlight, highlightIndex) => (
                    <div
                      key={highlightIndex}
                      className="source-highlight"
                      dangerouslySetInnerHTML={{ __html: sanitizeHighlight(highlight) }}
                    />
                  ))}
                </div>
              ) : null}
              {citation.url && (
                <a href={citation.url} target="_blank" rel="noreferrer" className="source-link">
                  View source →
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
