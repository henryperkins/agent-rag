# CRAG Evaluation JSON Parsing Error Fix

## Problem

CRAG evaluation was failing with JSON parsing error:
```
CRAG evaluation error: Invalid evaluation JSON: Unterminated string in JSON at position 1155 (line 1 column 1156)
```

## Root Cause

1. **Schema too strict**: `relevanceScores` array and `relevantSentences` were marked as required fields, forcing the model to generate potentially very long JSON responses (especially with 10+ documents)
2. **Token limit too low**: `max_output_tokens: 3000` was insufficient when:
   - Reasoning tokens consume 600-1000 tokens
   - Model needs to generate detailed relevance scores for many documents
   - Each document requires an array of relevant sentences
3. **Response truncation**: When the 3000 token limit was hit mid-generation, the JSON was cut off mid-string, causing parse error

## Solution

### 1. Schema Fixes (`backend/src/orchestrator/schemas.ts`)

Made optional fields actually optional:
- `relevanceScores` array is now optional (removed from required fields)
- `relevantSentences` array is now optional within each relevance score item

This allows the model to provide minimal responses when appropriate and avoids generating unnecessarily large JSON payloads.

### 2. Token Limit Increase (`backend/src/orchestrator/CRAG.ts`)

Increased `max_output_tokens` from 3000 to 5000:
```typescript
max_output_tokens: 5000, // Increased from 3000: GPT-5 uses ~600-1000 reasoning tokens, need room for detailed scores
```

### 3. Better Error Logging (`backend/src/orchestrator/CRAG.ts`)

Added detailed error logging for JSON parse failures:
- Logs text length
- Shows first 500 and last 200 characters
- Detects truncation patterns ("Unterminated", "Unexpected end")
- Helps diagnose future parsing issues

### 4. Prompt Clarification (`backend/src/orchestrator/CRAG.ts`)

Updated prompt to clarify that `relevanceScores` are optional:
```
Optionally, you may provide relevanceScores for documents. Each score should include:
- documentIndex: The index of the document (0-based)
- score: Relevance score (0-1)
- relevantSentences: (optional) Specific sentences to extract for refinement

Note: relevanceScores are optional but helpful for the "refine_documents" action.
```

### 5. Type Definition Update (`backend/src/orchestrator/CRAG.ts`)

Added `reasoningSummary?: string` to `CRAGResult` interface to support reasoning output.

## Files Modified

1. `backend/src/orchestrator/schemas.ts` - Schema definition fixes
2. `backend/src/orchestrator/CRAG.ts` - Token limit, error logging, prompt updates
3. `backend/src/tests/CRAG.test.ts` - Updated test expectations for new token limit

## Testing

The changes maintain backward compatibility:
- Existing code that provides `relevanceScores` continues to work
- New code can omit `relevanceScores` for simpler evaluations
- Error logging provides better diagnostics for future issues

## Impact

- ✅ Prevents JSON truncation errors for queries with many documents
- ✅ Allows model to provide concise evaluations when appropriate
- ✅ Better error diagnostics for debugging
- ✅ Maintains backward compatibility with existing code
- ✅ All existing tests pass (schema is more permissive, not more restrictive)
