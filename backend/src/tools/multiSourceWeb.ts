import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import type { WebResult } from '../../../shared/types.js';

// ============================================================================
// Types
// ============================================================================

export interface AcademicSearchOptions {
  query: string;
  maxResults?: number;
  fieldsOfStudy?: string[];
  yearFrom?: number;
  yearTo?: number;
}

export interface AcademicSearchResult {
  results: WebResult[];
  totalResults: number;
  sources: {
    semanticScholar: number;
    arxiv: number;
  };
}

interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract?: string;
  authors?: Array<{ name: string }>;
  year?: number;
  citationCount?: number;
  influentialCitationCount?: number;
  fieldsOfStudy?: string[];
  isOpenAccess?: boolean;
  openAccessPdf?: { url: string };
  url?: string;
  venue?: string;
  publicationDate?: string;
}

interface ArxivEntry {
  id: string[];
  title: string[];
  summary: string[];
  author?: Array<{ name: string[] }>;
  published: string[];
  updated?: string[];
  'arxiv:primary_category'?: Array<{ $: { term: string } }>;
  link?: Array<{ $: { href: string; type?: string; rel?: string } }>;
}

// ============================================================================
// Semantic Scholar API Integration
// ============================================================================

const SEMANTIC_SCHOLAR_BASE_URL = 'https://api.semanticscholar.org/graph/v1';

async function searchSemanticScholar(
  query: string,
  options: { limit?: number; fields?: string; fieldsOfStudy?: string[]; yearFrom?: number; yearTo?: number } = {}
): Promise<SemanticScholarPaper[]> {
  const params: Record<string, string | number> = {
    query,
    limit: options.limit || 10,
    fields:
      options.fields ||
      'paperId,title,abstract,authors,year,citationCount,influentialCitationCount,fieldsOfStudy,isOpenAccess,openAccessPdf,url,venue,publicationDate'
  };

  if (options.fieldsOfStudy && options.fieldsOfStudy.length > 0) {
    params.fieldsOfStudy = options.fieldsOfStudy.join(',');
  }

  if (options.yearFrom) {
    params.year = `${options.yearFrom}-`;
  }

  if (options.yearTo && options.yearFrom) {
    params.year = `${options.yearFrom}-${options.yearTo}`;
  } else if (options.yearTo) {
    params.year = `-${options.yearTo}`;
  }

  try {
    const response = await axios.get(`${SEMANTIC_SCHOLAR_BASE_URL}/paper/search`, {
      params,
      timeout: 10000,
      headers: {
        'User-Agent': 'AcademicRAG/1.0'
      }
    });

    return response.data.data || [];
  } catch (error: any) {
    console.error('Semantic Scholar API error:', error.message);
    return [];
  }
}

// ============================================================================
// arXiv API Integration
// ============================================================================

const ARXIV_API_BASE_URL = 'http://export.arxiv.org/api/query';

async function searchArxiv(
  query: string,
  options: { maxResults?: number; start?: number } = {}
): Promise<ArxivEntry[]> {
  const params = {
    search_query: `all:${encodeURIComponent(query)}`,
    start: options.start || 0,
    max_results: options.maxResults || 10
  };

  try {
    const response = await axios.get(ARXIV_API_BASE_URL, {
      params,
      timeout: 10000,
      headers: {
        'User-Agent': 'AcademicRAG/1.0'
      }
    });

    const parsed = await parseStringPromise(response.data, {
      explicitArray: true,
      mergeAttrs: false
    });

    const entries = parsed?.feed?.entry || [];
    return Array.isArray(entries) ? entries : [entries];
  } catch (error: any) {
    console.error('arXiv API error:', error.message);
    return [];
  }
}

// ============================================================================
// Paper-to-WebResult Conversion
// ============================================================================

function semanticScholarToWebResult(paper: SemanticScholarPaper): WebResult {
  const authorNames = paper.authors?.map((a) => a.name).join(', ') || 'Unknown';
  const citationScore = paper.citationCount || 0;
  const influentialScore = paper.influentialCitationCount || 0;

  // Authority score based on citations (normalized to 0-1 range)
  // High-impact papers: 100+ citations = 1.0, 50+ = 0.8, 10+ = 0.5
  const authorityScore = Math.min(1.0, Math.log10(citationScore + 1) / 2.5);

  const snippet = paper.abstract
    ? paper.abstract.slice(0, 300) + (paper.abstract.length > 300 ? '...' : '')
    : '';

  return {
    title: paper.title || 'Untitled',
    url: paper.url || `https://www.semanticscholar.org/paper/${paper.paperId}`,
    snippet,
    content: paper.abstract || snippet,
    source: 'Semantic Scholar',
    publishedDate: paper.publicationDate || `${paper.year || 'Unknown'}`,
    authors: authorNames,
    citationCount: citationScore,
    influentialCitationCount: influentialScore,
    authorityScore,
    venue: paper.venue,
    isOpenAccess: paper.isOpenAccess,
    pdfUrl: paper.openAccessPdf?.url
  };
}

function arxivToWebResult(entry: ArxivEntry): WebResult {
  const id = entry.id?.[0] || '';
  const title = entry.title?.[0]?.trim().replace(/\s+/g, ' ') || 'Untitled';
  const abstract = entry.summary?.[0]?.trim().replace(/\s+/g, ' ') || '';
  const snippet = abstract.slice(0, 300) + (abstract.length > 300 ? '...' : '');

  const authorNames =
    entry.author
      ?.map((a) => a.name?.[0])
      .filter(Boolean)
      .join(', ') || 'Unknown';

  const published = entry.published?.[0] || '';
  const category = entry['arxiv:primary_category']?.[0]?.$?.term || 'Unknown';

  const pdfLink = entry.link?.find((l) => l.$?.type === 'application/pdf')?.$?.href;
  const absLink = entry.link?.find((l) => l.$?.rel === 'alternate')?.$?.href || id;

  // arXiv papers are preprints - moderate authority (0.6)
  const authorityScore = 0.6;

  return {
    title,
    url: absLink,
    snippet,
    content: abstract,
    source: 'arXiv',
    publishedDate: published.split('T')[0],
    authors: authorNames,
    authorityScore,
    category,
    isOpenAccess: true,
    pdfUrl: pdfLink
  };
}

// ============================================================================
// Deduplication Logic
// ============================================================================

function deduplicateResults(results: WebResult[]): WebResult[] {
  const seen = new Set<string>();
  const deduplicated: WebResult[] = [];

  for (const result of results) {
    // Normalize title for comparison (lowercase, remove punctuation)
    const normalizedTitle = result.title.toLowerCase().replace(/[^\w\s]/g, '');

    if (!seen.has(normalizedTitle)) {
      seen.add(normalizedTitle);
      deduplicated.push(result);
    }
  }

  return deduplicated;
}

// ============================================================================
// Multi-Source Search
// ============================================================================

export async function multiSourceAcademicSearch(
  options: AcademicSearchOptions
): Promise<AcademicSearchResult> {
  const maxPerSource = Math.ceil((options.maxResults || 10) / 2);

  // Execute searches in parallel
  const [semanticScholarPapers, arxivEntries] = await Promise.all([
    searchSemanticScholar(options.query, {
      limit: maxPerSource,
      fieldsOfStudy: options.fieldsOfStudy,
      yearFrom: options.yearFrom,
      yearTo: options.yearTo
    }),
    searchArxiv(options.query, { maxResults: maxPerSource })
  ]);

  // Convert to WebResult format
  const semanticScholarResults = semanticScholarPapers.map(semanticScholarToWebResult);
  const arxivResults = arxivEntries.map(arxivToWebResult);

  // Combine and deduplicate
  const allResults = [...semanticScholarResults, ...arxivResults];
  const deduplicatedResults = deduplicateResults(allResults);

  // Sort by authority score (citation-based + source reputation)
  const sortedResults = deduplicatedResults.sort((a, b) => {
    const scoreA = a.authorityScore || 0;
    const scoreB = b.authorityScore || 0;
    return scoreB - scoreA;
  });

  // Limit to requested max
  const limitedResults = sortedResults.slice(0, options.maxResults || 10);

  return {
    results: limitedResults,
    totalResults: limitedResults.length,
    sources: {
      semanticScholar: limitedResults.filter((r) => r.source === 'Semantic Scholar').length,
      arxiv: limitedResults.filter((r) => r.source === 'arXiv').length
    }
  };
}
