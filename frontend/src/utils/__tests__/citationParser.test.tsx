import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { parseMessageWithCitations } from '../citationParser';
import type { Citation } from '../../types';

describe('parseMessageWithCitations', () => {
  const mockCitations: Citation[] = [
    {
      id: '1',
      title: 'First Source',
      content: 'Sample content 1',
      score: 0.9
    },
    {
      id: '2',
      title: 'Second Source',
      content: 'Sample content 2',
      score: 0.8
    },
    {
      id: '3',
      title: 'Third Source',
      content: 'Sample content 3',
      score: 0.7
    }
  ];

  it('returns plain text when no citations are present', () => {
    const content = 'This is a simple message without citations.';
    const result = parseMessageWithCitations(content);

    const { container } = render(<div>{result}</div>);
    expect(container).toHaveTextContent('This is a simple message without citations.');
  });

  it('parses single citation correctly', () => {
    const content = 'Azure provides search [1] capabilities.';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    expect(container).toHaveTextContent('Azure provides search');
    expect(container).toHaveTextContent('capabilities.');

    // Citation pill should be rendered
    const pill = screen.getByText('[1]');
    expect(pill).toBeInTheDocument();
  });

  it('parses multiple citations correctly', () => {
    const content = 'Azure provides search [1] with ranking [2] and filtering [3].';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    expect(container).toHaveTextContent('Azure provides search');
    expect(container).toHaveTextContent('with ranking');
    expect(container).toHaveTextContent('and filtering');

    // All citation pills should be rendered
    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.getByText('[2]')).toBeInTheDocument();
    expect(screen.getByText('[3]')).toBeInTheDocument();
  });

  it('handles consecutive citations', () => {
    const content = 'This is supported by evidence [1][2][3].';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    expect(container).toHaveTextContent('This is supported by evidence');

    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.getByText('[2]')).toBeInTheDocument();
    expect(screen.getByText('[3]')).toBeInTheDocument();
  });

  it('handles citation at the start of content', () => {
    const content = '[1] This starts with a citation.';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(container).toHaveTextContent('This starts with a citation.');
  });

  it('handles citation at the end of content', () => {
    const content = 'This ends with a citation [1]';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    expect(container).toHaveTextContent('This ends with a citation');
    expect(screen.getByText('[1]')).toBeInTheDocument();
  });

  it('handles empty content', () => {
    const content = '';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    expect(container.textContent).toBe('');
  });

  it('handles citations array with no citations provided', () => {
    const content = 'This has a reference [1] but no citations array.';
    const result = parseMessageWithCitations(content);

    const { container } = render(<div>{result}</div>);
    // Should still render the citation pill, but without citation data
    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(container).toHaveTextContent('This has a reference');
    expect(container).toHaveTextContent('but no citations array.');
  });

  it('handles citation number exceeding citations array length', () => {
    const content = 'This references citation [5] which does not exist.';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    // Should still render the pill even if citation doesn't exist
    expect(screen.getByText('[5]')).toBeInTheDocument();
    expect(container).toHaveTextContent('This references citation');
    expect(container).toHaveTextContent('which does not exist.');
  });

  it('ignores non-numeric brackets', () => {
    const content = 'This has [text] in brackets [1] which is valid.';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    // [text] should be treated as plain text
    expect(container).toHaveTextContent('This has [text] in brackets');
    // Only [1] should be a citation pill
    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.queryByText('[text]', { selector: 'button' })).not.toBeInTheDocument();
  });

  it('handles multi-digit citation numbers', () => {
    const largeCitationArray = Array.from({ length: 15 }, (_, i) => ({
      id: String(i + 1),
      title: `Source ${i + 1}`,
      content: `Content ${i + 1}`,
      score: 0.5
    }));

    const content = 'Reference [10] and [15] are valid.';
    const result = parseMessageWithCitations(content, largeCitationArray);

    const { container } = render(<div>{result}</div>);
    expect(screen.getByText('[10]')).toBeInTheDocument();
    expect(screen.getByText('[15]')).toBeInTheDocument();
    expect(container).toHaveTextContent('Reference');
    expect(container).toHaveTextContent('and');
    expect(container).toHaveTextContent('are valid.');
  });

  it('preserves text order and spacing', () => {
    const content = 'First sentence. [1] Second sentence [2]. Third sentence.';
    const result = parseMessageWithCitations(content, mockCitations);

    const { container } = render(<div>{result}</div>);
    expect(container).toHaveTextContent('First sentence.');
    expect(container).toHaveTextContent('Second sentence');
    expect(container).toHaveTextContent('. Third sentence.');
  });
});
