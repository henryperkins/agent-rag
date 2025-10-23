const FAST_PATH_PATTERNS = [
  // Simple definitional queries: "what is X?", "what are Y?"
  /^(what|where|when|who|which)\s+(is|are|was|were)\s+.+[?]?$/i,

  // Show/display commands: "show me X", "display the Y"
  /^(show|display|find)\s+(me\s+)?(the\s+)?.+$/i,

  // List commands: "list all X", "list the Y"
  /^list\s+(all\s+)?(the\s+)?.+$/i,

  // Definition requests: "definition of X", "meaning of Y"
  /^(definition|meaning|explanation)\s+of\s+.+$/i,

  // Simple how queries: "how to X" (without complex phrasing)
  /^how\s+to\s+[\w\s]{3,50}[?]?$/i,

  // Direct entity lookups: "X overview", "Y summary"
  /^[\w\s]{3,50}\s+(overview|summary|definition|details)[?]?$/i,

  // Yes/no questions about single entities: "does X have Y?"
  /^(does|do|is|are)\s+[\w\s]+\s+(have|contain|include|support|orbit)\s+.+[?]?$/i
];

const COMPLEXITY_KEYWORDS = [
  'compare', 'difference', 'versus', 'vs', 'better', 'worse', 'advantage', 'disadvantage',
  'analyze', 'evaluate', 'assess', 'explain why', 'how does', 'why do',
  'trend', 'evolution', 'history', 'timeline', 'over time',
  'because', 'cause', 'reason', 'result in', 'lead to',
  'and', 'or', 'both', 'either', 'neither'
];

function hasComplexityKeyword(query) {
  const lowerQuery = query.toLowerCase();

  for (const keyword of COMPLEXITY_KEYWORDS) {
    // For multi-word keywords, check as substring
    if (keyword.includes(' ')) {
      if (lowerQuery.includes(keyword.toLowerCase())) {
        return keyword;
      }
      continue;
    }

    // For single-word keywords, check as whole word using word boundaries
    const wordPattern = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'i');
    if (wordPattern.test(lowerQuery)) {
      return keyword;
    }
  }

  return null;
}

const testQueries = [
  'What is an aurora?',
  'when was it discovered',
  'does earth have a magnetic field?',
  'is aurora visible in summer?',
  'What is the capital of France?',
  'What is better: X or Y?',
  'show me: data'
];

console.log('Testing Fast Path Patterns:\n');

for (const query of testQueries) {
  console.log(`\nQuery: "${query}"`);

  // Check complexity keywords with whole-word matching
  const complexityKeywordFound = hasComplexityKeyword(query);
  if (complexityKeywordFound) {
    console.log(`  ❌ Blocked by complexity keyword: "${complexityKeywordFound}"`);
    continue;
  }

  // Check pattern matches
  let matched = false;
  for (let i = 0; i < FAST_PATH_PATTERNS.length; i++) {
    const pattern = FAST_PATH_PATTERNS[i];
    if (pattern.test(query)) {
      console.log(`  ✅ Matched pattern ${i}: ${pattern}`);
      matched = true;
      break;
    }
  }

  if (!matched) {
    console.log(`  ❌ No pattern matched`);
    // Try each pattern individually to see why
    FAST_PATH_PATTERNS.forEach((p, i) => {
      console.log(`    Pattern ${i}: ${p.test(query) ? 'MATCH' : 'no match'}`);
    });
  }
}
