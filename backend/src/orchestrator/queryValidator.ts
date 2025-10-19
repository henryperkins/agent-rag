/**
 * Query Quality Validator
 *
 * Detects low-quality queries that are likely to produce poor reranker scores
 * and provides fallback strategies (lower threshold, skip semantic ranking, etc.)
 */

export interface QueryQualityAssessment {
  quality: 'high' | 'medium' | 'low';
  suggestedThreshold: number;
  reasons: string[];
}

export function assessQueryQuality(query: string): QueryQualityAssessment {
  const trimmed = query.trim();
  const wordCount = trimmed.split(/\s+/).length;
  const charCount = trimmed.length;
  const reasons: string[] = [];
  let quality: 'high' | 'medium' | 'low' = 'high';
  let suggestedThreshold = 2.5;

  // Too short
  if (wordCount === 1 || charCount < 5) {
    quality = 'low';
    suggestedThreshold = 1.5;
    reasons.push('Query too short (1 word or <5 chars)');
  }

  // Generic/conversational
  const genericPatterns = /^(hi|hello|hey|what|who|where|when|why|how|test|ok|yes|no)$/i;
  if (genericPatterns.test(trimmed)) {
    quality = 'low';
    suggestedThreshold = 1.5;
    reasons.push('Generic conversational query');
  }

  // Very long (likely narrative/rambling)
  if (wordCount > 50) {
    quality = 'medium';
    suggestedThreshold = 2.0;
    reasons.push('Query very long (>50 words)');
  }

  // Mostly punctuation/special chars
  const alphanumericCount = (trimmed.match(/[a-z0-9]/gi) || []).length;
  if (alphanumericCount < charCount * 0.5) {
    quality = 'low';
    suggestedThreshold = 1.5;
    reasons.push('Query contains mostly non-alphanumeric characters');
  }

  // Well-formed informational query
  if (wordCount >= 3 && wordCount <= 20 && quality === 'high') {
    reasons.push('Well-formed informational query');
  }

  return { quality, suggestedThreshold, reasons };
}

/**
 * Example usage:
 *
 * const assessment = assessQueryQuality(userQuery);
 * if (assessment.quality === 'low') {
 *   console.warn(`Low quality query detected: ${assessment.reasons.join(', ')}`);
 *   // Use lower threshold
 *   options.rerankerThreshold = assessment.suggestedThreshold;
 * }
 */
