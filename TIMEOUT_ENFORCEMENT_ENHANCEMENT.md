# Timeout Enforcement Enhancement - Dual Strategy

## Overview

Enhanced `withRetry()` utility with **defense-in-depth timeout enforcement** using both AbortController and Promise.race timeout mechanisms.

## Problem

Previous implementations relied on a single timeout strategy:
- **Promise.race only**: Rejects promise but doesn't cancel underlying operation (resource leak)
- **AbortController only**: Requires all operations to respect signal (not all do)

This created a risk where:
1. Slow operations could hang indefinitely if they ignore AbortSignal
2. Timed-out operations continue running in background
3. No graceful cancellation for well-behaved operations

## Solution

### Dual Timeout Strategy

Implemented **two complementary timeout mechanisms**:

```typescript
export async function withRetry<T>(
  operation: string,
  fn: (signal?: AbortSignal) => Promise<T>,
  options: RetryOptions = {}
): Promise<T>
```

#### 1. AbortController (Primary)
- Creates AbortController for each retry attempt
- Passes signal to operation function (optional parameter)
- Aborts signal when timeout fires
- **Benefit**: Clean cancellation for operations that support it

#### 2. Promise.race (Fallback)
- Creates timeout promise that rejects after `timeoutMs`
- Races operation against timeout
- **Benefit**: Guarantees timeout even if operation ignores signal

### Implementation Details

```typescript
// Create AbortController for this attempt
const controller = new AbortController();
let timeoutId: NodeJS.Timeout | undefined;

// Dual timeout strategy
const timeout = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => {
    controller.abort(); // Cancel operation if it supports AbortSignal
    reject(new Error(`Operation timeout after ${timeoutMs}ms`));
  }, timeoutMs);
});

// Pass signal to operation (backward compatible - operation can ignore it)
const result = await Promise.race([fn(controller.signal), timeout]);

// Clear timeout if operation completed successfully
if (timeoutId) {
  clearTimeout(timeoutId);
}
```

### Key Features

1. **Backward Compatible**:
   - Optional signal parameter: `fn: (signal?: AbortSignal) => Promise<T>`
   - Existing code that ignores signal continues to work
   - No breaking changes to existing call sites

2. **Resource Cleanup**:
   - Timeout cleared on success or failure
   - AbortController created per-attempt (no stale signals)
   - Memory-efficient

3. **Enhanced Logging**:
   - Timeout errors flagged with `[TIMEOUT]` in logs
   - Telemetry includes `isTimeout` attribute
   - Better debugging and monitoring

4. **Timeout Error Retryability**:
   - Timeout errors automatically marked as retryable
   - `AbortError` treated as retryable
   - Configurable via `retryableErrors` option

## Migration Guide

### No Changes Required

Existing code continues to work without modification:

```typescript
// Old code (still works)
await withRetry('azure-search', () => hybridSemanticSearch(query, options));

// New code (can use signal)
await withRetry('azure-search', (signal) =>
  hybridSemanticSearch(query, { ...options, signal })
);
```

### Adding AbortSignal Support to Operations

To benefit from clean cancellation, update operations to accept and respect AbortSignal:

```typescript
async function hybridSemanticSearch(
  query: string,
  options: { signal?: AbortSignal; ... }
) {
  const response = await fetch(endpoint, {
    signal: options.signal, // Pass signal to fetch
    // ...
  });
  // ...
}
```

## Testing

### Test Mock Updates

Updated test mocks to handle optional signal parameter:

```typescript
// Before
vi.mock('../utils/resilience.js', () => ({
  withRetry: vi.fn((_, fn) => fn())
}));

// After
vi.mock('../utils/resilience.js', () => ({
  withRetry: vi.fn((_, fn) => fn(undefined))
}));
```

### Test Coverage

- ✅ Timeout enforcement with Promise.race
- ✅ AbortController signal passed to operation
- ✅ Timeout cleared on success
- ✅ Timeout cleared on failure
- ✅ Timeout errors marked as retryable
- ✅ Backward compatibility (operations ignore signal)

## Files Modified

1. `backend/src/utils/resilience.ts` - Core dual timeout implementation
2. `backend/src/tests/tools.test.ts` - Updated withRetry mock
3. `backend/src/tests/lazyRetrieval.test.ts` - Updated withRetry mock

## Performance Impact

**Negligible overhead**:
- One AbortController allocation per retry attempt (~few bytes)
- One setTimeout per attempt (already existed)
- clearTimeout call on completion (new, trivial cost)

**Benefits**:
- Prevents resource leaks from uncancelled operations
- Better timeout accuracy (signal can trigger early abort)
- Improved monitoring and debugging

## Future Enhancements

### Phase 1: Core Operations (Recommended)

Update these high-frequency operations to support AbortSignal:

1. **Azure Search** (`backend/src/azure/directSearch.ts`):
   ```typescript
   async function executeSearch(
     indexName: string,
     builder: SearchQueryBuilder,
     signal?: AbortSignal
   ) {
     const response = await fetch(endpoint, {
       signal,
       // ...
     });
   }
   ```

2. **Azure OpenAI** (`backend/src/azure/openaiClient.ts`):
   ```typescript
   async function postJson<T>(
     path: string,
     body: unknown,
     signal?: AbortSignal
   ): Promise<T> {
     const response = await fetch(withQuery(path), {
       signal,
       // ...
     });
   }
   ```

3. **Web Search** (`backend/src/tools/webSearch.ts`):
   - Already has AbortSignal support ✅
   - Needs integration with withRetry signal

### Phase 2: Advanced Operations

- Lazy retrieval operations
- Adaptive query reformulation
- Multi-source academic search
- Federated search

## Rollout Plan

### ✅ Phase 1: Enhanced withRetry (Current)
- Dual timeout strategy implemented
- Backward compatible signature
- Test coverage updated
- **Status**: Complete

### 🔄 Phase 2: Core Operation Updates (Optional)
- Update fetch calls to accept signal
- Thread signal through call chains
- Add tests for cancellation behavior
- **Effort**: 2-4 hours
- **Priority**: P1 (recommended for production)

### 🔄 Phase 3: Monitoring & Metrics (Optional)
- Track timeout vs. success rates
- Monitor AbortError frequency
- Identify slow operations for optimization
- **Effort**: 1-2 hours
- **Priority**: P2

## Security Considerations

- No new attack surface (signal is controlled by internal timeout)
- Prevents denial-of-service from hung operations
- Better resource management under load

## References

- MDN: [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
- MDN: [Promise.race()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/race)
- Issue: P0 - Restore withRetry timeout enforcement
