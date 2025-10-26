import type { Reference, CitationDiagnostics } from '../../../shared/types.js';

/**
 * F-001: Enhanced citation validation result with unused detection
 */
export interface CitationValidationResult {
  isValid: boolean;
  error?: string;
  diagnostics: CitationDiagnostics;
}

/**
 * F-001: Validation options
 */
export interface CitationValidationOptions {
  failOnUnused?: boolean; // Default: false
  unusedThreshold?: number; // Default: 0.3 (30%)
}

function resolveReferenceText(reference: Reference | undefined): string {
  if (!reference) {
    return '';
  }
  const candidates: Array<unknown> = [
    reference.content,
    reference.chunk,
    (reference as { summary?: unknown }).summary,
    reference.metadata && (reference.metadata as Record<string, unknown>).snippet,
    reference.title
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return '';
}

/**
 * F-001: Build diagnostics from citation usage analysis
 */
function buildDiagnostics(
  citations: Reference[],
  usedCitations: Set<number>,
  citationMap?: Map<number, { source: 'retrieval' | 'web'; index: number }>
): CitationDiagnostics {
  const allIndices = Array.from({ length: citations.length }, (_, i) => i + 1);
  const unusedCitations = allIndices.filter(idx => !usedCitations.has(idx));
  const unusedRatio = citations.length > 0 ? unusedCitations.length / citations.length : 0;

  let sourceBreakdown = undefined;
  if (citationMap) {
    const breakdown = {
      retrieval: { total: 0, used: 0 },
      web: { total: 0, used: 0 }
    };

    citationMap.forEach((meta, idx) => {
      breakdown[meta.source].total++;
      if (usedCitations.has(idx)) {
        breakdown[meta.source].used++;
      }
    });

    sourceBreakdown = breakdown;
  }

  return {
    totalCitations: citations.length,
    usedCitations,
    unusedCitations,
    unusedRatio,
    sourceBreakdown
  };
}

/**
 * Legacy function signature (backward compatibility)
 * @deprecated Use validateCitationIntegrityEnhanced for detailed diagnostics
 */
export function validateCitationIntegrity(answer: string, citations: Reference[]): boolean {
  const result = validateCitationIntegrityEnhanced(answer, citations);
  return result.isValid;
}

/**
 * F-001: Enhanced citation validator with unused detection and source tracking
 * Validates that all citation numbers in the answer reference valid positions in the citations array.
 * Citation format: [1], [2], etc. (1-indexed)
 *
 * @param answer - The answer text containing citations
 * @param citations - Array of citation references
 * @param citationMap - Optional map tracking source of each citation (retrieval vs web)
 * @param options - Validation options (unused threshold, fail behavior)
 */
export function validateCitationIntegrityEnhanced(
  answer: string,
  citations: Reference[],
  citationMap?: Map<number, { source: 'retrieval' | 'web'; index: number }>,
  options: CitationValidationOptions = {}
): CitationValidationResult {
  const { failOnUnused = false, unusedThreshold = 0.3 } = options;
  const matches = [...answer.matchAll(/\[(\d+)\]/g)];
  const usedCitations = new Set<number>();

  // Allow answers without citation markers (lenient mode)
  if (!matches.length) {
    return {
      isValid: true,
      diagnostics: buildDiagnostics(citations, usedCitations, citationMap)
    };
  }

  // Validate each citation
  for (const match of matches) {
    const rawId = match[1];
    const citationId = Number.parseInt(rawId, 10);

    // Check valid number
    if (Number.isNaN(citationId) || citationId < 1) {
      return {
        isValid: false,
        error: `Invalid citation number: [${rawId}]`,
        diagnostics: buildDiagnostics(citations, usedCitations, citationMap)
      };
    }

    // Check range
    if (citationId > citations.length) {
      return {
        isValid: false,
        error: `Invalid citation index: [${citationId}] (valid range: 1-${citations.length})`,
        diagnostics: buildDiagnostics(citations, usedCitations, citationMap)
      };
    }

    const reference = citations[citationId - 1];
    if (!reference) {
      return {
        isValid: false,
        error: `Citation [${citationId}] references missing reference`,
        diagnostics: buildDiagnostics(citations, usedCitations, citationMap)
      };
    }

    // Check reference has content
    const referenceText = resolveReferenceText(reference);
    if (!referenceText) {
      return {
        isValid: false,
        error: `Citation [${citationId}] references empty content`,
        diagnostics: buildDiagnostics(citations, usedCitations, citationMap)
      };
    }

    // Check unified grounding IDs if present
    const metadata = reference.metadata as Record<string, unknown> | undefined;
    if (metadata && 'unifiedGroundingIds' in metadata) {
      const rawIds = metadata['unifiedGroundingIds'];
      const ids = Array.isArray(rawIds)
        ? rawIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
        : [];
      if (!ids.length) {
        return {
          isValid: false,
          error: `Citation [${citationId}] has empty grounding IDs`,
          diagnostics: buildDiagnostics(citations, usedCitations, citationMap)
        };
      }
    }

    usedCitations.add(citationId);
  }

  // Calculate unused citations
  const allIndices = Array.from({ length: citations.length }, (_, i) => i + 1);
  const unusedCitations = allIndices.filter(idx => !usedCitations.has(idx));
  const unusedRatio = citations.length > 0 ? unusedCitations.length / citations.length : 0;

  // Check unused threshold
  if (failOnUnused && unusedRatio > unusedThreshold) {
    return {
      isValid: false,
      error: `High unused citation ratio: ${(unusedRatio * 100).toFixed(1)}% (threshold: ${(unusedThreshold * 100)}%)`,
      diagnostics: buildDiagnostics(citations, usedCitations, citationMap)
    };
  }

  return {
    isValid: true,
    diagnostics: buildDiagnostics(citations, usedCitations, citationMap)
  };
}
