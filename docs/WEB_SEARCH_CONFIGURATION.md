# Web Search Configuration Guide

**Date**: October 18, 2025
**Issue**: Web search not being triggered despite Google Search API being configured
**Solution**: Understand and configure the multi-layer decision system

---

## How Web Search is Triggered

Web search happens when **ANY** of these conditions are met:

```
┌─────────────────────────────────────────────┐
│  Web Search Trigger Conditions (OR logic)  │
├─────────────────────────────────────────────┤
│ 1. Planner requests 'web_search' or 'both' │
│ 2. Low confidence triggers escalation      │
│ 3. CRAG triggers web fallback              │
└─────────────────────────────────────────────┘
```

### Condition 1: Planner Decision (Autonomous)

The planner analyzes the query and decides the retrieval strategy:

**System Prompt** (line 38-40, `plan.ts`):

```
"You decide the retrieval strategy for a grounded QA assistant."
```

**Available Actions**:

- `vector_search` - Only Azure AI Search
- `web_search` - Only Google Search
- `both` - Both sources
- `answer` - No retrieval needed

**Problem**: The planner is **too conservative** and prefers vector_search only.

---

### Condition 2: Confidence Escalation (Configurable)

**File**: `backend/src/orchestrator/dispatch.ts:150-151`

```typescript
const confidence = plan.confidence; // From planner (0-1)
const threshold = config.PLANNER_CONFIDENCE_DUAL_RETRIEVAL; // Default: 0.45
const escalated = confidence < threshold; // Triggers dual retrieval
```

**Current Behavior**:

```
Query: "What causes city lights?"
├─ Planner confidence: 0.5
├─ Threshold: 0.45
├─ 0.5 < 0.45? NO
└─ Escalation: ❌ NOT TRIGGERED
```

**Fix**: Lower threshold to trigger more often

```bash
# Add to backend/.env
PLANNER_CONFIDENCE_DUAL_RETRIEVAL=0.6  # Was: 0.45

# New behavior:
# 0.5 < 0.6? YES → Escalation triggered → Web search!
```

---

### Condition 3: CRAG Web Fallback (Configurable)

**File**: `backend/src/orchestrator/CRAG.ts`

CRAG evaluates retrieved documents and returns:

- `correct` → Use documents
- `ambiguous` → Refine documents
- `incorrect` → **Trigger web search** ✅

**File**: `backend/src/orchestrator/dispatch.ts:230-232`

```typescript
if (cragResult.shouldTriggerWebSearch) {
  cragTriggeredWebSearch = true; // Forces web search
}
```

**Current Behavior**:

```
CRAG Evaluation:
├─ Retrieved: 2 documents
├─ Confidence: "ambiguous" (likely)
├─ Action: "refine_documents"
└─ Web fallback: ❌ NOT TRIGGERED
```

**Fix**: Make CRAG stricter

```bash
# Add to backend/.env
CRAG_MIN_CONFIDENCE_FOR_USE=correct  # Was: ambiguous (default)

# New behavior:
# "ambiguous" docs → Web fallback triggered!
```

---

## Configuration Strategies

### Strategy 1: Always Use Web Search (Most Aggressive)

```bash
# backend/.env
PLANNER_CONFIDENCE_DUAL_RETRIEVAL=1.0  # Always escalate
ENABLE_CRAG=false  # Skip CRAG to avoid blocking

# Result: Every query gets both vector + web search
# Cost: Highest (2x Google API calls)
# Quality: Best coverage
```

### Strategy 2: Balanced Approach (Recommended)

```bash
# backend/.env
PLANNER_CONFIDENCE_DUAL_RETRIEVAL=0.6   # Lower threshold
ENABLE_CRAG=true                         # Keep CRAG
CRAG_MIN_CONFIDENCE_FOR_USE=correct     # Stricter CRAG

# Result: Web search when confidence < 0.6 OR docs rated ambiguous/incorrect
# Cost: Medium (selective web usage)
# Quality: Good balance
```

### Strategy 3: CRAG-Only Fallback (Conservative)

```bash
# backend/.env
PLANNER_CONFIDENCE_DUAL_RETRIEVAL=0.3   # Very low threshold
ENABLE_CRAG=true                         # Keep CRAG
CRAG_MIN_CONFIDENCE_FOR_USE=ambiguous   # Default strictness

# Result: Web search only when CRAG deems docs insufficient
# Cost: Lowest (minimal web usage)
# Quality: May miss some web-only content
```

---

## Implementation Guide

### Quick Fix (Apply Immediately)

```bash
# 1. Backup current config
cp backend/.env backend/.env.backup-$(date +%Y%m%d-%H%M%S)

# 2. Add/update these lines in backend/.env
echo "" >> backend/.env
echo "# Web Search Configuration (Updated Oct 18, 2025)" >> backend/.env
echo "PLANNER_CONFIDENCE_DUAL_RETRIEVAL=0.6" >> backend/.env
echo "CRAG_MIN_CONFIDENCE_FOR_USE=correct" >> backend/.env

# 3. Restart backend
pm2 restart agent-rag-backend

# 4. Test with a query
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "What causes global warming?"}]}'
```

### Verify Web Search is Working

Check telemetry in logs:

```bash
# Before fix:
'agent.web.results': 0  ← NO WEB

# After fix:
'agent.web.results': 6  ← SUCCESS!
```

---

## Advanced: Modify Planner Prompt

For permanent "always use web" behavior, modify the planner:

**File**: `backend/src/orchestrator/plan.ts:38-40`

```typescript
// BEFORE:
content: 'You decide the retrieval strategy for a grounded QA assistant.';

// AFTER:
content: 'You decide the retrieval strategy for a grounded QA assistant. ' +
  'Prefer "both" action to use vector search AND web search together for comprehensive coverage.';
```

**Trade-offs**:

- ✅ More comprehensive answers
- ✅ Better coverage of recent/external info
- ❌ Higher latency (extra Google API call)
- ❌ Higher cost ($5/1000 queries for Google)

---

## Debugging

### Check if Google Search is Working

```bash
# Test Google Custom Search API directly
curl "https://customsearch.googleapis.com/customsearch/v1?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_ENGINE_ID}&q=test" | jq .searchInformation
```

### Monitor Web Search Telemetry

```bash
# Watch logs for web search activity
pm2 logs agent-rag-backend | grep "agent.web.results"

# Check telemetry endpoint
curl http://localhost:8787/admin/telemetry | jq '.sessions[-1] | {web_results: .web_results}'
```

---

## Summary Table

| Configuration              | Escalation Trigger | CRAG Fallback | Web Usage | Cost   | Quality |
| -------------------------- | ------------------ | ------------- | --------- | ------ | ------- |
| **Default**                | 0.45               | ambiguous     | Rare      | Low    | Low     |
| **Balanced** (Recommended) | 0.6                | correct       | Moderate  | Medium | High    |
| **Aggressive**             | 1.0                | disabled      | Always    | High   | Highest |
| **Conservative**           | 0.3                | ambiguous     | Minimal   | Lowest | Medium  |

---

## Related Files

- `backend/src/orchestrator/dispatch.ts:242` - Web search trigger logic
- `backend/src/orchestrator/plan.ts:38-40` - Planner system prompt
- `backend/src/orchestrator/CRAG.ts:229-232` - CRAG web fallback
- `backend/src/config/app.ts:58` - PLANNER_CONFIDENCE_DUAL_RETRIEVAL default

**Last Updated**: October 18, 2025
**Author**: Claude Code (Sonnet 4.5)
