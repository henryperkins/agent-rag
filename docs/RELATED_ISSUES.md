# Related Issues Analysis

## Summary

This document identifies issues related to the GPT-5 reasoning token and Azure Search API compatibility fixes completed on 2025-10-19.

---

## 1. Token Cap Issues (GPT-5 Reasoning Tokens)

### Root Cause

GPT-5 uses extended reasoning mode, consuming 400-2000 reasoning tokens **before** emitting the JSON payload. Insufficient `max_output_tokens` caps cause truncation, leading to `SyntaxError: Unterminated string` or `Expected ',' or '}'` when parsing JSON.

### Already Fixed ✅

- **Intent Classifier** (`backend/src/config/app.ts:69`): 500 → 2000 tokens
- **Planner** (`backend/src/orchestrator/plan.ts:50`): 2000 → 4000 tokens

### Fixed ✅ (2025-10-19)

All high/medium risk calls have been updated with 2-3x safety margins:

| File                                    | Function              | Old Cap | New Cap  | Status   |
| --------------------------------------- | --------------------- | ------- | -------- | -------- |
| `azure/adaptiveRetrieval.ts:72`         | `assessCoverage()`    | 300     | **1000** | ✅ Fixed |
| `azure/adaptiveRetrieval.ts:179`        | `reformulateQuery()`  | 500     | **1500** | ✅ Fixed |
| `orchestrator/critique.ts:55`           | `evaluateAnswer()`    | 1500    | **3000** | ✅ Fixed |
| `orchestrator/queryDecomposition.ts:80` | `assessComplexity()`  | 500     | **1500** | ✅ Fixed |
| `orchestrator/CRAG.ts:97`               | `evaluateRetrieval()` | 1500    | **3000** | ✅ Fixed |
| `orchestrator/compact.ts:102`           | `summarizeHistory()`  | 1500    | **3000** | ✅ Fixed |
| `orchestrator/compact.ts:126`           | `extractSalience()`   | 1000    | **2500** | ✅ Fixed |

### Low Risk (No Changes Needed)

| File                                     | Function           | Current Cap | Reasoning Token Budget | Notes                |
| ---------------------------------------- | ------------------ | ----------- | ---------------------- | -------------------- |
| `orchestrator/queryDecomposition.ts:118` | `decomposeQuery()` | 2000        | ~400-800               | Adequate buffer      |
| `agents/critic.ts:23`                    | Legacy critic      | 1500        | ~300-500               | Deprecated, not used |
| `tools/index.ts:433`                     | `answerTool()`     | 3000        | ~600-1000              | Adequate buffer      |

### Recommended Actions (Post-Fix)

1. ✅ **All high/medium risk calls fixed** with 2-3x safety margins
2. **Monitor production logs** for JSON parse errors (should be eliminated)
3. **Add telemetry** to track `output_tokens_details.reasoning_tokens` per call (P1)
4. **Implement fallback parsing** using `response.output[0].content[0].json` instead of re-parsing text (P2)

---

## 2. Azure Search API Version Compatibility

### Root Cause

Using **preview-only** features with stable API version (`2025-08-01-preview`) causes 400 errors: `"The property 'X' does not exist on type 'Microsoft.Azure.Search.V2025_09_01.Y'"`

### Already Fixed ✅

- **filterMode** (`backend/src/azure/directSearch.ts:324-328`): Commented out for stable API compatibility

### Potentially At Risk ⚠️

Features that may be preview-only (requires API documentation review):

| Feature                     | File                            | Line                                 | Usage                       | Risk Level          |
| --------------------------- | ------------------------------- | ------------------------------------ | --------------------------- | ------------------- |
| **vectorCompression**       | `azure/indexSetup.ts:79-100`    | Scalar quantization                  | Used in production          | **Medium** ⚠️       |
| **knowledgeAgent controls** | `azure/indexSetup.ts:296-297`   | `maxSubQueries`, `alwaysQuerySource` | Used in production          | **Medium** ⚠️       |
| **semanticConfiguration**   | `azure/directSearch.ts:310-311` | Semantic ranking config              | Used in all hybrid searches | **Low** (likely GA) |
| **exhaustive** flag         | `azure/directSearch.ts:321`     | Vector exhaustive search             | Used in all vector queries  | **Low** (likely GA) |

**Current API Version**: `2025-08-01-preview` (stable) in `backend/.env:8`

### Recommended Actions

1. **Review Azure AI Search changelog** for 2025-08-01-preview feature support
2. **Test vector compression** with stable API (may require `2024-11-01-preview` or later)
3. **Test knowledge agent controls** (`maxSubQueries`, `alwaysQuerySource`)
4. **Add API version validation** to warn about preview feature usage with stable APIs
5. **Consider conditional feature usage** based on API version detection

---

## 3. TypeScript Build Errors (Pre-Existing)

### Current Status

Tests pass (145/145) but `tsc` compilation fails with 24 errors across 5 files.

### Affected Files

#### `orchestrator/critique.ts:90`

```
error TS2322: Type 'string' is not assignable to type '"accept" | "revise"'.
```

**Root Cause**: Variable `action` (line 90) inferred as `string` instead of literal union type.
**Fix**: Add explicit type annotation or use type assertion.

#### `orchestrator/dispatch.ts:226`

```
error TS7006: Parameter 'step' implicitly has an 'any' type.
```

**Root Cause**: Arrow function parameter missing type in `.some()` callback.
**Fix**: Add type annotation `(step: ActivityStep) => ...`

#### `scripts/inspectIndex.ts:36,45-47,58,60,70,72,79` (10 errors)

```
error TS18046: 'indexSchema' is of type 'unknown'.
error TS18046: 'stats' is of type 'unknown'.
error TS18046: 'searchResult' is of type 'unknown'.
```

**Root Cause**: JSON response types not narrowed from `unknown`.
**Fix**: Add type guards or explicit type assertions after validation.

#### `tests/documentProcessor.test.ts:17`

```
error TS2503: Cannot find namespace 'vi'.
```

**Root Cause**: Vitest types not imported.
**Fix**: Add `import { vi } from 'vitest'` or `import type { Mock } from 'vitest'`.

#### `tests/tools.test.ts:50,78,104,130,154,183` (6 errors)

```
error TS7006: Parameter 'a' implicitly has an 'any' type.
```

**Root Cause**: `.sort()` comparator missing type annotations.
**Fix**: Add `(a: Reference, b: Reference) => ...` type annotations.

#### `tools/index.ts:106-107`

```
error TS2304: Cannot find name 'AgenticRetrievalResponse'.
```

**Root Cause**: Type not imported or defined.
**Fix**: Import from `shared/types.ts` or define locally.

### Impact

- **Runtime**: None (code executes correctly via `tsx` and `vitest`)
- **Production builds**: May fail in CI/CD if `tsc` is part of build pipeline
- **Type safety**: Reduced IDE autocomplete and type checking benefits

### Recommended Actions

1. **Fix high-priority errors** in production code (`critique.ts`, `dispatch.ts`, `tools/index.ts`)
2. **Fix test files** to improve developer experience
3. **Add `tsc --noEmit` to CI** to catch regressions
4. **Consider `strict: true`** in `tsconfig.json` after fixing existing errors

---

## 4. Observability Gaps

### Missing Telemetry for Token Cap Issues

Current implementation lacks visibility into:

- **Reasoning token usage** per structured output call
- **Truncation events** (incomplete JSON responses)
- **Fallback trigger frequency** (router/planner/critic defaults)

### Recommended Instrumentation

```typescript
// backend/src/orchestrator/router.ts (example)
const response = await createResponse({ ... });

// Log reasoning token usage
if (response.usage?.output_tokens_details?.reasoning_tokens) {
  console.warn(
    `Intent classification used ${response.usage.output_tokens_details.reasoning_tokens} reasoning tokens`,
    { total: response.usage.total_tokens, reasoning: response.usage.output_tokens_details.reasoning_tokens }
  );
}

// Detect truncation
if (response.status === 'incomplete' && response.incomplete_reason === 'max_output_tokens') {
  console.error('Intent classification truncated due to token cap', {
    cap: config.INTENT_CLASSIFIER_MAX_TOKENS,
    reasoning_tokens: response.usage?.output_tokens_details?.reasoning_tokens
  });
}
```

### Recommended Metrics

1. **reasoning_tokens_percentile** (p50, p95, p99) per function
2. **truncation_rate** per structured output call
3. **fallback_frequency** for router/planner/critic
4. **parse_error_rate** for JSON extraction

---

## 5. Configuration Validation Gaps

### Missing Runtime Checks

The application doesn't validate:

1. **Token caps vs. model limits** (e.g., GPT-5 max output: 128K tokens)
2. **API version vs. feature compatibility** (e.g., `filterMode` requires preview API)
3. **Reasoning token overhead** (e.g., warn if cap < 2x expected reasoning tokens)

### Recommended Validation

```typescript
// backend/src/config/app.ts
export function validateConfig(config: Config): void {
  // Validate token caps
  const MIN_REASONING_BUFFER = 1000;
  if (config.INTENT_CLASSIFIER_MAX_TOKENS < MIN_REASONING_BUFFER) {
    console.warn(
      `INTENT_CLASSIFIER_MAX_TOKENS (${config.INTENT_CLASSIFIER_MAX_TOKENS}) may be too low for GPT-5 reasoning mode`,
    );
  }

  // Validate API version compatibility
  if (config.AZURE_SEARCH_DATA_PLANE_API_VERSION === '2025-08-01-preview') {
    console.info(
      'Using stable Azure Search API - some preview features disabled (e.g., filterMode)',
    );
  }

  // Validate feature flags
  if (config.ENABLE_LAZY_RETRIEVAL && !config.ENABLE_INTENT_ROUTING) {
    console.warn('Lazy retrieval works best with intent routing enabled');
  }
}
```

---

## 6. Testing Gaps

### Scenarios Not Covered

1. **Token cap truncation** tests for each structured output call
2. **API version feature compatibility** tests
3. **Reasoning token usage** regression tests
4. **Fallback behavior** when JSON parsing fails

### Recommended Test Cases

```typescript
// backend/src/tests/router.test.ts (example)
it('handles truncated JSON from insufficient token cap', async () => {
  mockCreateResponse.mockResolvedValueOnce({
    id: 'test',
    status: 'incomplete',
    incomplete_reason: 'max_output_tokens',
    output_text: '{"intent":"researc', // Truncated JSON
    usage: {
      total_tokens: 2000,
      output_tokens_details: { reasoning_tokens: 1800 },
    },
  });

  const result = await classifyIntent('test question');

  // Should fall back to default
  expect(result.intent).toBe('research');
  expect(result.confidence).toBeLessThan(1);
});
```

---

## Priority Recommendations

### Immediate (P0) - ✅ ALL COMPLETE

1. ✅ Fix intent classifier token cap (500 → 2000)
2. ✅ Fix planner token cap (2000 → 4000)
3. ✅ Guard filterMode assignment (commented out for stable API)
4. ✅ Fix adaptiveRetrieval.ts token caps (300 → 1000, 500 → 1500)
5. ✅ Fix critique.ts token cap (1500 → 3000)
6. ✅ Fix CRAG.ts token cap (1500 → 3000)
7. ✅ Fix compact.ts token caps (1500 → 3000, 1000 → 2500)
8. ✅ Fix queryDecomposition.ts token cap (500 → 1500)

### Short-term (P1)

1. Add reasoning token telemetry to all structured output calls
2. Fix TypeScript build errors in production code
3. Validate vector compression compatibility with `2025-08-01-preview` API
4. Add token cap truncation tests

### Medium-term (P2)

1. Implement config validation at startup
2. Add metrics for truncation/fallback rates
3. Fix remaining TypeScript errors in tests/scripts
4. Document API version feature compatibility matrix

### Long-term (P3)

1. Migrate to native JSON output mode (`response.output[0].content[0].json`)
2. Implement dynamic token cap adjustment based on reasoning token usage
3. Create alerting for production truncation events
4. Add comprehensive integration tests for API version compatibility
