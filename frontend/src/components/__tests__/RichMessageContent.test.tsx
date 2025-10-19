import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { RichMessageContent } from '../RichMessageContent';
import type { Citation } from '../../types';

describe('RichMessageContent', () => {
  it('renders plain text without citations', () => {
    const content = 'This is a simple message without citations.';
    render(<RichMessageContent content={content} />);

    expect(screen.getByText(content)).toBeInTheDocument();
  });

  it('renders citation pills for [1], [2] markers', () => {
    const content = 'Azure provides search [1] with ranking [2].';
    const citations: Citation[] = [
      {
        id: 'doc1',
        title: 'First Source',
        content: 'First source content',
        score: 0.95
      },
      {
        id: 'doc2',
        title: 'Second Source',
        content: 'Second source content',
        score: 0.85
      }
    ];

    render(<RichMessageContent content={content} citations={citations} messageId="msg-1" />);

    // Check that text before and after citations is rendered
    expect(screen.getByText(/Azure provides search/)).toBeInTheDocument();
    expect(screen.getByText(/with ranking/)).toBeInTheDocument();

    // Check that citation pills are rendered (CitationPill component renders the number)
    const citationButtons = screen.getAllByRole('button', { name: /Show source/ });
    expect(citationButtons).toHaveLength(2);
  });

  it('renders markdown headers with proper styling', () => {
    const content = '# Heading 1\n## Heading 2\n### Heading 3';
    const { container } = render(<RichMessageContent content={content} />);

    expect(container.querySelector('.markdown-h1')).toBeInTheDocument();
    expect(container.querySelector('.markdown-h2')).toBeInTheDocument();
    expect(container.querySelector('.markdown-h3')).toBeInTheDocument();
  });

  it('renders code blocks with syntax highlighting', () => {
    const content = '```javascript\nconst x = 42;\n```';
    const { container } = render(<RichMessageContent content={content} />);

    expect(container.querySelector('.code-block-wrapper')).not.toBeNull();
    expect(screen.getByText('javascript')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });

  it('renders inline code with styling', () => {
    const content = 'Use the `console.log()` function to debug.';
    const { container } = render(<RichMessageContent content={content} />);

    const inlineCode = container.querySelector('.inline-code');
    expect(inlineCode).toBeInTheDocument();
    expect(inlineCode).toHaveTextContent('console.log()');
  });

  it('renders markdown lists', () => {
    const content = '- Item 1\n- Item 2\n- Item 3';
    const { container } = render(<RichMessageContent content={content} />);

    expect(container.querySelector('.markdown-list')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
    expect(screen.getByText('Item 3')).toBeInTheDocument();
  });

  it('renders markdown links with proper attributes', () => {
    const content = 'Visit [OpenAI](https://openai.com) for more info.';
    render(<RichMessageContent content={content} />);

    const link = screen.getByRole('link', { name: /OpenAI/ });
    expect(link).toHaveAttribute('href', 'https://openai.com');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders blockquotes with styling', () => {
    const content = '> This is a quote';
    const { container } = render(<RichMessageContent content={content} />);

    expect(container.querySelector('.markdown-blockquote')).toBeInTheDocument();
    expect(screen.getByText('This is a quote')).toBeInTheDocument();
  });

  it('handles citations within markdown formatted text', () => {
    const content = '**Bold text** with citation [1] and *italic* text.';
    const citations: Citation[] = [
      {
        id: 'doc1',
        title: 'Source',
        content: 'Source content',
        score: 0.95
      }
    ];

    const { container } = render(<RichMessageContent content={content} citations={citations} messageId="msg-2" />);

    // Check that markdown formatting is preserved
    expect(container.querySelector('strong')).toBeInTheDocument();
    expect(container.querySelector('em')).toBeInTheDocument();

    // Check that citation pill is rendered
    expect(screen.getAllByRole('button', { name: /Show source/ })).toHaveLength(1);
  });

  it('renders citation pills inside list items', () => {
    const content = '- Fact with source [1]\n- Another item';
    const citations: Citation[] = [
      {
        id: 'doc1',
        title: 'List Source',
        content: 'List source content',
        score: 0.95
      }
    ];

    render(<RichMessageContent content={content} citations={citations} messageId="msg-3" />);

    const pills = screen.getAllByRole('button', { name: /Show source/ });
    expect(pills).toHaveLength(1);
    expect(screen.getByText(/Fact with source/)).toBeInTheDocument();
  });

  it('converts cite placeholders into citation pills', () => {
    const content = 'Insight<cite data-citation="1"></cite> with placeholder.';
    const citations: Citation[] = [
      {
        id: 'doc1',
        title: 'Placeholder Source',
        content: 'Placeholder source',
        score: 0.9
      }
    ];

    render(<RichMessageContent content={content} citations={citations} messageId="msg-4" />);

    expect(screen.getByRole('button', { name: /Show source 1/ })).toBeInTheDocument();
    expect(screen.queryByText(/<cite/)).not.toBeInTheDocument();
  });

  it('renders fenced code blocks without language as multi-line blocks', () => {
    const content = '```\nplain code\nline two\n```';
    const { container } = render(<RichMessageContent content={content} />);

    const codeBlock = container.querySelector('pre.code-block-content');
    expect(codeBlock).not.toBeNull();
    if (codeBlock) {
      expect(codeBlock).toHaveTextContent(/plain code/);
    }
  });
});
