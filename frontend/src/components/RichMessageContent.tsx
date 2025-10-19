import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Citation } from '../types';
import { CitationPill } from './CitationPill';

interface RichMessageContentProps {
  content: string;
  citations?: Citation[];
  messageId?: string;
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const CITATION_TAG_REGEX = /<cite[^>]*data-citation=["'](\d+)["'][^>]*>(?:\s*<\/cite>)?/gi;
const CITATION_SELF_CLOSING_REGEX = /<cite[^>]*data-citation=["'](\d+)["'][^>]*\/>/gi;

function normalizeCitationPlaceholders(raw: string): string {
  return raw
    .replace(CITATION_TAG_REGEX, (_match, num: string) => `[${num}]`)
    .replace(CITATION_SELF_CLOSING_REGEX, (_match, num: string) => `[${num}]`);
}

export function RichMessageContent({ content, citations, messageId }: RichMessageContentProps) {
  const [copiedBlocks, setCopiedBlocks] = useState<Record<number, boolean>>({});

  const normalizedContent = useMemo(() => normalizeCitationPlaceholders(content), [content]);

  const handleCopyCode = async (code: string, blockIndex: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedBlocks((prev) => ({ ...prev, [blockIndex]: true }));
      setTimeout(() => {
        setCopiedBlocks((prev) => ({ ...prev, [blockIndex]: false }));
      }, 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  const renderCitationsInText = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    const citationRegex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = citationRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      const citationNum = parseInt(match[1], 10);
      const citation = citations && citations[citationNum - 1];

      parts.push(
        <CitationPill
          key={`cite-${match.index}-${citationNum}`}
          number={citationNum}
          citation={citation}
          messageId={messageId}
        />
      );

      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  };

  const renderCitationsInNode = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === 'string') {
      return renderCitationsInText(node);
    }

    if (Array.isArray(node)) {
      return node.map((child) => renderCitationsInNode(child));
    }

    if (React.isValidElement(node) && node.props?.children) {
      return React.cloneElement(node, {
        ...node.props,
        children: renderCitationsInNode(node.props.children)
      });
    }

    return node;
  };

  let codeBlockIndex = 0;

  return (
    <div className="rich-message-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom code block renderer with syntax highlighting
          code: ({ inline, className, children, ...props }: CodeBlockProps) => {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const rawCode = String(children);
            const code = rawCode.replace(/\n$/, '');
            const containsLineBreak = rawCode.includes('\n');
            const isBlock = inline === false || Boolean(language) || containsLineBreak;

            if (isBlock) {
              const currentBlockIndex = codeBlockIndex++;
              const headerLabel = language || 'text';

              return (
                <div className="code-block-wrapper">
                  <div className="code-block-header">
                    <span className="code-block-language">{headerLabel}</span>
                    <button
                      className="code-block-copy"
                      onClick={() => handleCopyCode(code, currentBlockIndex)}
                      aria-label="Copy code"
                    >
                      {copiedBlocks[currentBlockIndex] ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  {language ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus}
                      language={language}
                      PreTag="div"
                      className="code-block-content"
                      {...props}
                    >
                      {code}
                    </SyntaxHighlighter>
                  ) : (
                    <pre className="code-block-content">
                      <code>{code}</code>
                    </pre>
                  )}
                </div>
              );
            }

            return (
              <code className={`inline-code${className ? ` ${className}` : ''}`} {...props}>
                {children}
              </code>
            );
          },

          // Custom paragraph renderer to handle citation markers [1], [2], etc.
          p: ({ node: _node, children, ...props }) => (
            <p {...props}>{renderCitationsInNode(children)}</p>
          ),

          li: ({ node: _node, children, ...props }) => (
            <li {...props}>{renderCitationsInNode(children)}</li>
          ),

          td: ({ node: _node, children, ...props }) => (
            <td {...props}>{renderCitationsInNode(children)}</td>
          ),

          th: ({ node: _node, children, ...props }) => (
            <th {...props}>{renderCitationsInNode(children)}</th>
          ),

          // Style headings
          h1: ({ node: _node, children, className, ...props }) => (
            <h1 {...props} className={`markdown-h1${className ? ` ${className}` : ''}`}>
              {renderCitationsInNode(children)}
            </h1>
          ),
          h2: ({ node: _node, children, className, ...props }) => (
            <h2 {...props} className={`markdown-h2${className ? ` ${className}` : ''}`}>
              {renderCitationsInNode(children)}
            </h2>
          ),
          h3: ({ node: _node, children, className, ...props }) => (
            <h3 {...props} className={`markdown-h3${className ? ` ${className}` : ''}`}>
              {renderCitationsInNode(children)}
            </h3>
          ),
          h4: ({ node: _node, children, className, ...props }) => (
            <h4 {...props} className={`markdown-h4${className ? ` ${className}` : ''}`}>
              {renderCitationsInNode(children)}
            </h4>
          ),

          // Style links
          a: ({ node: _node, href, children, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="markdown-link"
            >
              {renderCitationsInNode(children)}
            </a>
          ),

          // Style blockquotes
          blockquote: ({ node: _node, children, className, ...props }) => (
            <blockquote
              {...props}
              className={`markdown-blockquote${className ? ` ${className}` : ''}`}
            >
              {renderCitationsInNode(children)}
            </blockquote>
          ),

          // Style tables
          table: ({ node: _node, children }) => (
            <div className="markdown-table-wrapper">
              <table className="markdown-table">{children}</table>
            </div>
          ),

          // Style lists
          ul: ({ node: _node, children, className, ...props }) => (
            <ul {...props} className={`markdown-list${className ? ` ${className}` : ''}`}>
              {children}
            </ul>
          ),
          ol: ({ node: _node, children, className, ...props }) => (
            <ol
              {...props}
              className={`markdown-list markdown-list-ordered${className ? ` ${className}` : ''}`}
            >
              {children}
            </ol>
          )
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
}
