/**
 * Freshness Detection Utility
 *
 * Analyzes queries to detect when fresh/current web data is needed
 * vs when static knowledge base content is sufficient.
 */

export interface FreshnessAnalysis {
  needsFreshData: boolean;
  confidence: number;
  signals: string[];
  temporalContext?: {
    year?: number;
    month?: string;
    timeframe?: 'current' | 'recent' | 'specific';
  };
}

/**
 * Temporal keywords indicating need for fresh data
 */
const TEMPORAL_KEYWORDS = {
  immediate: ['now', 'today', 'currently', 'current', 'live', 'real-time'],
  recent: ['latest', 'newest', 'recent', 'new', 'updated', 'modern'],
  specific: ['2025', '2024', 'this year', 'this month', 'this week'],
  comparative: ['vs', 'versus', 'compared to', 'difference between']
};

/**
 * Domain keywords that typically need fresh data
 */
const FRESH_DOMAINS = [
  'pricing', 'price', 'cost',
  'release', 'version', 'update',
  'news', 'announcement',
  'availability', 'available',
  'feature', 'capability',
  'support', 'compatibility'
];

/**
 * Keywords indicating static/historical content is OK
 */
const STATIC_KEYWORDS = [
  'history', 'historical', 'origin',
  'definition', 'what is', 'explain',
  'concept', 'theory', 'principle',
  'architecture', 'design', 'structure'
];

/**
 * Analyzes a query to determine if fresh web data is needed
 */
export function analyzeFreshness(query: string, conversationContext?: string[]): FreshnessAnalysis {
  const lowerQuery = query.toLowerCase();
  const signals: string[] = [];
  let score = 0;

  // Check temporal keywords
  for (const [category, keywords] of Object.entries(TEMPORAL_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerQuery.includes(keyword)) {
        signals.push(`temporal:${category}:${keyword}`);
        score += category === 'immediate' ? 3 : category === 'recent' ? 2 : 1;
      }
    }
  }

  // Check fresh domain keywords
  for (const keyword of FRESH_DOMAINS) {
    if (lowerQuery.includes(keyword)) {
      signals.push(`domain:${keyword}`);
      score += 1.5;
    }
  }

  // Check static keywords (negative signals)
  for (const keyword of STATIC_KEYWORDS) {
    if (lowerQuery.includes(keyword)) {
      signals.push(`static:${keyword}`);
      score -= 1;
    }
  }

  // Check for year mentions
  const currentYear = new Date().getFullYear();
  const yearMatch = lowerQuery.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    if (year >= currentYear - 1) {
      signals.push(`year:${year}`);
      score += 2;
    }
  }

  // Check conversation context for temporal patterns
  if (conversationContext && conversationContext.length > 0) {
    const recentContext = conversationContext.slice(-3).join(' ').toLowerCase();
    if (recentContext.includes('latest') || recentContext.includes('current')) {
      signals.push('context:temporal');
      score += 1;
    }
  }

  // Determine temporal context
  let temporalContext: FreshnessAnalysis['temporalContext'];
  if (yearMatch) {
    temporalContext = {
      year: parseInt(yearMatch[1]),
      timeframe: 'specific'
    };
  } else if (signals.some(s => s.includes('immediate'))) {
    temporalContext = { timeframe: 'current' };
  } else if (signals.some(s => s.includes('recent'))) {
    temporalContext = { timeframe: 'recent' };
  }

  // Normalize confidence to 0-1 range
  const confidence = Math.min(Math.max(score / 10, 0), 1);
  const needsFreshData = confidence > 0.3;

  return {
    needsFreshData,
    confidence,
    signals,
    temporalContext
  };
}

/**
 * Determines the optimal freshness threshold based on query type
 */
export function getFreshnessThreshold(queryType?: string): number {
  switch (queryType) {
    case 'factual_lookup':
      return 0.4; // Moderate threshold
    case 'research':
      return 0.3; // Lower threshold (more likely to need fresh data)
    case 'conversational':
      return 0.6; // Higher threshold (less likely to need fresh data)
    default:
      return 0.4; // Default moderate threshold
  }
}

/**
 * Determines if results should prefer fresh sources over KB sources
 */
export function shouldPreferFreshSources(
  freshnessAnalysis: FreshnessAnalysis,
  kbLastUpdated?: Date
): boolean {
  if (!freshnessAnalysis.needsFreshData) {
    return false;
  }

  // Always prefer fresh if confidence is high
  if (freshnessAnalysis.confidence > 0.7) {
    return true;
  }

  // Prefer fresh if KB is outdated
  if (kbLastUpdated) {
    const daysSinceUpdate = (Date.now() - kbLastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > 90 && freshnessAnalysis.confidence > 0.4) {
      return true;
    }
  }

  return false;
}
