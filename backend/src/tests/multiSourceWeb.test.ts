import { describe, it, expect, vi, beforeEach } from 'vitest';
import { multiSourceAcademicSearch } from '../tools/multiSourceWeb.js';

// Mock axios module
vi.mock('axios', () => ({
  default: {
    get: vi.fn()
  }
}));

import axios from 'axios';
const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> };

describe('Multi-Source Academic Search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('multiSourceAcademicSearch', () => {
    it('should fetch papers from Semantic Scholar and arXiv', async () => {
      // Mock Semantic Scholar response
      const semanticScholarResponse = {
        data: {
          data: [
            {
              paperId: 'test-123',
              title: 'Test Paper from Semantic Scholar',
              abstract: 'This is a test abstract from Semantic Scholar.',
              authors: [{ name: 'John Doe' }, { name: 'Jane Smith' }],
              year: 2024,
              citationCount: 150,
              influentialCitationCount: 25,
              fieldsOfStudy: ['Computer Science'],
              isOpenAccess: true,
              openAccessPdf: { url: 'https://example.com/paper.pdf' },
              url: 'https://www.semanticscholar.org/paper/test-123',
              venue: 'Test Conference'
            }
          ]
        }
      };

      // Mock arXiv response
      const arxivResponse = {
        data: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.12345v1</id>
    <title>Test Paper from arXiv</title>
    <summary>This is a test abstract from arXiv.</summary>
    <author><name>Alice Johnson</name></author>
    <published>2024-01-15T00:00:00Z</published>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.AI"/>
    <link href="http://arxiv.org/abs/2401.12345v1" rel="alternate" type="text/html"/>
    <link href="http://arxiv.org/pdf/2401.12345v1" rel="related" type="application/pdf"/>
  </entry>
</feed>`
      };

      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('semanticscholar.org')) {
          return Promise.resolve(semanticScholarResponse);
        } else if (url.includes('arxiv.org')) {
          return Promise.resolve(arxivResponse);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await multiSourceAcademicSearch({
        query: 'machine learning',
        maxResults: 10
      });

      expect(result.results).toHaveLength(2);
      expect(result.totalResults).toBe(2);
      expect(result.sources.semanticScholar).toBe(1);
      expect(result.sources.arxiv).toBe(1);

      const semanticScholarPaper = result.results.find((r) => r.source === 'Semantic Scholar');
      expect(semanticScholarPaper).toBeDefined();
      expect(semanticScholarPaper?.title).toBe('Test Paper from Semantic Scholar');
      expect(semanticScholarPaper?.citationCount).toBe(150);
      expect(semanticScholarPaper?.authorityScore).toBeGreaterThan(0.5);

      const arxivPaper = result.results.find((r) => r.source === 'arXiv');
      expect(arxivPaper).toBeDefined();
      expect(arxivPaper?.title).toBe('Test Paper from arXiv');
      expect(arxivPaper?.authorityScore).toBe(0.6);
    });

    it('should handle API errors gracefully', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const result = await multiSourceAcademicSearch({
        query: 'test query',
        maxResults: 5
      });

      expect(result.results).toHaveLength(0);
      expect(result.totalResults).toBe(0);
      expect(result.sources.semanticScholar).toBe(0);
      expect(result.sources.arxiv).toBe(0);
    });

    it('should deduplicate papers with same titles', async () => {
      const semanticScholarResponse = {
        data: {
          data: [
            {
              paperId: 'test-1',
              title: 'Duplicate Paper Title',
              abstract: 'Abstract 1',
              authors: [{ name: 'Author One' }],
              year: 2024,
              citationCount: 100,
              url: 'https://example.com/paper1'
            }
          ]
        }
      };

      const arxivResponse = {
        data: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <title>Duplicate Paper Title</title>
    <summary>Abstract 2</summary>
    <author><name>Author Two</name></author>
    <published>2024-01-01T00:00:00Z</published>
    <link href="http://arxiv.org/abs/2401.00001v1" rel="alternate"/>
  </entry>
</feed>`
      };

      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('semanticscholar.org')) {
          return Promise.resolve(semanticScholarResponse);
        } else if (url.includes('arxiv.org')) {
          return Promise.resolve(arxivResponse);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await multiSourceAcademicSearch({
        query: 'test',
        maxResults: 10
      });

      // Should only have 1 result after deduplication
      expect(result.results).toHaveLength(1);
      expect(result.totalResults).toBe(1);
    });

    it('should sort results by authority score', async () => {
      const semanticScholarResponse = {
        data: {
          data: [
            {
              paperId: 'low-citation',
              title: 'Low Citation Paper',
              abstract: 'Low citation abstract',
              citationCount: 5,
              url: 'https://example.com/low'
            },
            {
              paperId: 'high-citation',
              title: 'High Citation Paper',
              abstract: 'High citation abstract',
              citationCount: 500,
              url: 'https://example.com/high'
            }
          ]
        }
      };

      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('semanticscholar.org')) {
          return Promise.resolve(semanticScholarResponse);
        } else if (url.includes('arxiv.org')) {
          return Promise.resolve({ data: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>' });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await multiSourceAcademicSearch({
        query: 'test',
        maxResults: 10
      });

      // High citation paper should be first
      expect(result.results[0].title).toBe('High Citation Paper');
      expect(result.results[0].authorityScore).toBeGreaterThan(result.results[1].authorityScore);
    });

    it('should respect maxResults limit', async () => {
      const semanticScholarResponse = {
        data: {
          data: Array.from({ length: 10 }, (_, i) => ({
            paperId: `paper-${i}`,
            title: `Paper ${i}`,
            abstract: `Abstract ${i}`,
            url: `https://example.com/${i}`
          }))
        }
      };

      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('semanticscholar.org')) {
          return Promise.resolve(semanticScholarResponse);
        } else if (url.includes('arxiv.org')) {
          return Promise.resolve({ data: '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>' });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await multiSourceAcademicSearch({
        query: 'test',
        maxResults: 3
      });

      expect(result.results).toHaveLength(3);
      expect(result.totalResults).toBe(3);
    });
  });
});
