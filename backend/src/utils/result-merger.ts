/**
 * Result Merger Utility
 *
 * Merges and deduplicates references from multiple sources
 * (Azure AI Search KB + Web Search) with intelligent scoring.
 */

import type { Reference } from '../../../shared/types.js';
import { createHash } from 'node:crypto';

export interface MergeOptions {
  /**
   * Sources to merge with their priorities
   */
  sources: Array<{
    references: Reference[];
    source: 'kb' | 'web' | 'knowledge_agent';
    priority: number; // 1-10, higher = more important
  }>;

  /**
   * Maximum number of results to return
   */
  maxResults?: number;

  /**
   * Prefer fresh sources over KB sources
   */
  preferFresh?: boolean;

  /**
   * Deduplication strategy
   */
  deduplicateBy?: Array<'url' | 'contentHash' | 'title'>;

  /**
   * Minimum score threshold (0-1)
   */
  minScore?: number;
}

export interface MergedResult {
  references: Reference[];
  stats: {
    totalInput: number;
    duplicatesRemoved: number;
    belowThreshold: number;
    sources: Record<string, number>;
  };
}

/**
 * Generates a content hash for duplicate detection
 */
function generateContentHash(content: string): string {
  const normalized = content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500); // Use first 500 chars for hash

  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Checks if two references are duplicates based on strategy
 */
function isDuplicate(
  ref1: Reference,
  ref2: Reference,
  strategy: Array<'url' | 'contentHash' | 'title'>
): boolean {
  for (const method of strategy) {
    switch (method) {
      case 'url':
        if (ref1.url && ref2.url) {
          // Normalize URLs for comparison
          const url1 = ref1.url.toLowerCase().replace(/\/$/, '');
          const url2 = ref2.url.toLowerCase().replace(/\/$/, '');
          if (url1 === url2) return true;
        }
        break;

      case 'contentHash':
        if (ref1.content && ref2.content) {
          const hash1 = generateContentHash(ref1.content);
          const hash2 = generateContentHash(ref2.content);
          if (hash1 === hash2) return true;
        }
        break;

      case 'title':
        if (ref1.title && ref2.title) {
          const title1 = ref1.title.toLowerCase().trim();
          const title2 = ref2.title.toLowerCase().trim();
          if (title1 === title2) return true;
        }
        break;
    }
  }

  return false;
}

/**
 * Calculates a composite score for ranking
 */
function calculateCompositeScore(
  ref: Reference,
  sourcePriority: number,
  preferFresh: boolean
): number {
  let score = 0;

  // Base score from reranker/relevance
  if (typeof ref.score === 'number') {
    score += ref.score * 0.4; // 40% weight
  }

  // Source priority
  score += (sourcePriority / 10) * 0.3; // 30% weight

  // Freshness boost if preferred
  if (preferFresh && ref.metadata?.fetchedAt && typeof ref.metadata.fetchedAt === 'string') {
    const fetchedDate = new Date(ref.metadata.fetchedAt);
    const daysSinceFetch = (Date.now() - fetchedDate.getTime()) / (1000 * 60 * 60 * 24);

    // Boost recent content (last 7 days)
    if (daysSinceFetch < 7) {
      score += 0.2; // 20% boost
    } else if (daysSinceFetch < 30) {
      score += 0.1; // 10% boost
    }
  }

  // Length bonus (longer content often more valuable)
  if (ref.content) {
    const contentLength = ref.content.length;
    if (contentLength > 2000) {
      score += 0.1; // 10% bonus for substantial content
    }
  }

  return Math.min(score, 1); // Cap at 1.0
}

/**
 * Merges references from multiple sources with intelligent deduplication and scoring
 */
export function mergeReferences(options: MergeOptions): MergedResult {
  const {
    sources,
    maxResults = 10,
    preferFresh = false,
    deduplicateBy = ['url', 'contentHash'],
    minScore = 0
  } = options;

  const stats = {
    totalInput: 0,
    duplicatesRemoved: 0,
    belowThreshold: 0,
    sources: {} as Record<string, number>
  };

  // Flatten all references with source metadata
  const allReferences: Array<Reference & { _sourcePriority: number; _source: string }> = [];

  for (const { references, source, priority } of sources) {
    stats.totalInput += references.length;
    stats.sources[source] = references.length;

    for (const ref of references) {
      allReferences.push({
        ...ref,
        _sourcePriority: priority,
        _source: source
      });
    }
  }

  // Deduplicate
  const deduplicated: typeof allReferences = [];

  for (const ref of allReferences) {
    // Check if this reference is a duplicate
    const existing = deduplicated.find((existingRef) =>
      isDuplicate(existingRef, ref, deduplicateBy)
    );

    if (existing) {
      // Keep the one with higher priority
      if (ref._sourcePriority > existing._sourcePriority) {
        // Replace existing with higher priority version
        const index = deduplicated.indexOf(existing);
        deduplicated[index] = ref;
      }
      stats.duplicatesRemoved++;
    } else {
      deduplicated.push(ref);
    }
  }

  // Calculate composite scores
  const scored = deduplicated.map((ref) => ({
    ...ref,
    _compositeScore: calculateCompositeScore(ref, ref._sourcePriority, preferFresh)
  }));

  // Filter by minimum score
  const filtered = scored.filter((ref) => {
    const effectiveMinScore = ref._source === 'web' && ref.score === undefined ? Math.min(minScore, 0.1) : minScore;
    if (ref._compositeScore < effectiveMinScore) {
      stats.belowThreshold++;
      return false;
    }
    return true;
  });

  // Sort by composite score (descending)
  filtered.sort((a, b) => b._compositeScore - a._compositeScore);

  // Take top N results
  const final = filtered.slice(0, maxResults);

  // Clean up internal properties
  const cleanedReferences: Reference[] = final.map((ref) => {
    const { _sourcePriority, _source, _compositeScore, ...cleanRef } = ref;

    // Add source metadata to reference
    return {
      ...cleanRef,
      metadata: {
        ...cleanRef.metadata,
        mergedFrom: _source,
        compositeScore: _compositeScore
      }
    };
  });

  return {
    references: cleanedReferences,
    stats
  };
}

/**
 * Helper to merge KB and web results specifically
 */
export function mergeKBAndWebResults(
  kbResults: Reference[],
  webResults: Reference[],
  options: {
    preferFresh?: boolean;
    maxResults?: number;
  } = {}
): MergedResult {
  return mergeReferences({
    sources: [
      {
        references: kbResults,
        source: 'kb',
        priority: options.preferFresh ? 5 : 8 // KB gets higher priority unless fresh is preferred
      },
      {
        references: webResults,
        source: 'web',
        priority: options.preferFresh ? 9 : 6 // Web gets higher priority if fresh is preferred
      }
    ],
    maxResults: options.maxResults,
    preferFresh: options.preferFresh,
    deduplicateBy: ['url', 'contentHash'],
    minScore: 0.2 // Minimum quality threshold
  });
}
