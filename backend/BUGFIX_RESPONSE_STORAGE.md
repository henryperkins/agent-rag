# P0 Bug Fix - Response Storage Guard

## Issue

**Severity**: P0 (Critical - Session Abort)
**Files**:

- `backend/src/orchestrator/index.ts:250`
- `backend/src/tools/index.ts:229`

### Description

When the critic requests a revision (or any retry occurs), the orchestrator passes `previous_response_id` to the Azure OpenAI Responses API. However, the Responses API only allows `previous_response_id` to reference responses that were stored with `store: true`.

**The Problem**:

- `ENABLE_RESPONSE_STORAGE` defaults to `false` (line 101 in `config/app.ts`)
- When `false`, responses are created with `store: false`
- These unstored responses cannot be referenced later via `previous_response_id`
- Attempting to do so returns a **404/NotFound error**
- This causes the entire session to abort when the critic triggers a revision

**Attack Surface**:

- Affects ALL sessions where the critic requests revisions
- Affects ALL retry paths
- Default configuration is broken - users experience failures out of the box

### Root Cause

Both streaming and sync answer generation were unconditionally sending `previous_response_id`:

```typescript
// BEFORE (BROKEN):
const response = await createResponse({
  // ... other params
  store: config.ENABLE_RESPONSE_STORAGE,
  previous_response_id: previousResponseId, // ❌ Sent even when storage disabled
});
```

When `ENABLE_RESPONSE_STORAGE = false`:

1. First synthesis: `store: false` → Response created but not stored
2. Critic requests revision
3. Second synthesis: `previous_response_id: <first-response-id>`, `store: false`
4. Azure API responds: **404 NotFound** (response ID doesn't exist)
5. Session aborts with error

## Fix Applied

### Changes

Gated `previous_response_id` parameter behind `ENABLE_RESPONSE_STORAGE` flag in both locations:

**1. Orchestrator (Streaming Mode)** - `orchestrator/index.ts:251`

```typescript
// AFTER (FIXED):
const reader = await createResponseStream({
  // ... other params
  store: config.ENABLE_RESPONSE_STORAGE,
  // Only send previous_response_id when storage is enabled
  ...(config.ENABLE_RESPONSE_STORAGE && previousResponseId
    ? { previous_response_id: previousResponseId }
    : {}),
});
```

**2. Answer Tool (Sync Mode)** - `tools/index.ts:230`

```typescript
// AFTER (FIXED):
const response = await createResponse({
  // ... other params
  store: config.ENABLE_RESPONSE_STORAGE,
  // Only send previous_response_id when storage is enabled
  ...(config.ENABLE_RESPONSE_STORAGE && args.previousResponseId
    ? { previous_response_id: args.previousResponseId }
    : {}),
});
```

### Behavior Matrix

| ENABLE_RESPONSE_STORAGE | Revision Attempt         | Previous Behavior            | Fixed Behavior                            |
| ----------------------- | ------------------------ | ---------------------------- | ----------------------------------------- |
| `false` (default)       | Critic triggers revision | ❌ 404 error → Session abort | ✅ No previous_response_id sent → Success |
| `false`                 | Manual retry             | ❌ 404 error → Session abort | ✅ No previous_response_id sent → Success |
| `true`                  | Critic triggers revision | ✅ Works                     | ✅ Works                                  |
| `true`                  | Manual retry             | ✅ Works                     | ✅ Works                                  |

### Logic

```typescript
// Only include previous_response_id when BOTH conditions are true:
// 1. Storage is enabled (responses are being stored)
// 2. A previous response ID exists (not the first attempt)

if (config.ENABLE_RESPONSE_STORAGE && previousResponseId) {
  // Include previous_response_id in request
} else {
  // Omit previous_response_id from request
}
```

## Verification

### Manual Testing

#### Test Case 1: Storage Disabled (Default)

1. Ensure `.env` has `ENABLE_RESPONSE_STORAGE=false` (or is unset - defaults to false)
2. Send a query that triggers critic revision:
   ```json
   { "messages": [{ "role": "user", "content": "Tell me about quantum computing" }] }
   ```
3. Verify in logs:
   - First synthesis completes
   - Critic requests revision (action: 'revise')
   - **Second synthesis succeeds** (no 404 error)
   - Final answer returned

#### Test Case 2: Storage Enabled

1. Set `.env` with `ENABLE_RESPONSE_STORAGE=true`
2. Send same query
3. Verify in logs:
   - First synthesis returns a response ID
   - Critic requests revision
   - Second synthesis includes `previous_response_id`
   - Azure API accepts it (response was stored)
   - Final answer returned

#### Test Case 3: Verify Response IDs

```bash
# Check telemetry endpoint after a revision
curl http://localhost:8787/admin/telemetry | jq '.[-1].metadata.responses'

# Expected output:
[
  { "attempt": 0, "responseId": "resp_xxx" },  // First attempt
  { "attempt": 1, "responseId": "resp_yyy" }   // Revision (only if storage enabled)
]
```

### Code Review Checklist

- [x] `previous_response_id` gated in orchestrator streaming path
- [x] `previous_response_id` gated in answerTool sync path
- [x] Conditional spread syntax used correctly
- [x] TypeScript compilation passes
- [x] No other usages of `previous_response_id` in codebase

## Additional Notes

### Why This Matters

Azure OpenAI Responses API has two modes:

1. **Ephemeral** (`store: false`): Responses are not persisted, cannot be referenced later
2. **Stored** (`store: true`): Responses are persisted for 60 minutes, can be referenced

The `previous_response_id` parameter is **only valid for stored responses**. This enables:

- Revision tracking
- A/B testing
- Cost analysis
- Audit trails

### When to Enable Storage

Set `ENABLE_RESPONSE_STORAGE=true` when you need:

- Response versioning across critic iterations
- Azure AI Foundry telemetry integration
- Long-term response auditing
- Multi-turn refinement tracking

**Trade-offs**:

- ✅ Better observability and debugging
- ✅ Revision context preservation
- ❌ Responses stored for 60 minutes (Azure quota)
- ❌ Potential PII retention concerns

### Default Recommendation

Keep `ENABLE_RESPONSE_STORAGE=false` for:

- Development environments
- PII-sensitive deployments
- High-volume production (quota management)

Enable `ENABLE_RESPONSE_STORAGE=true` for:

- Staging/testing environments
- Audit-required production
- Research/analysis workloads

## References

- [Azure OpenAI Responses API Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/response-management)
- Issue location: `orchestrator/index.ts:245-253`, `tools/index.ts:228-230`
- Config: `config/app.ts:101`

---

**Fixed**: 2025-10-08
**Status**: ✅ Resolved
**Impact**: Critical - Prevents session aborts during critic revisions
