# Next Steps Implementation Guide

**Created**: October 9, 2025  
**Last Updated**: October 18, 2025  
**Phase**: Post-Documentation Organization  
**Source**: Original comprehensive sweep analysis

---

## Phase 1 Complete ✅

Documentation organization tasks (1-4) are complete:

- ✅ ROADMAP.md created
- ✅ COMPREHENSIVE_AUDIT_REPORT.md references fixed
- ✅ INDEX.md catalog created
- ✅ TODO.md tracker created
- ✅ Redundant files removed

---

## Phase 2: Backend Telemetry Enhancements (Est. 2-3 hours)

### Task 5: Semantic Summary Telemetry Aggregation ✅ Completed

**Objective**: Close the TODO from [`semantic-summary-plan.md:11`](semantic-summary-plan.md:11)  
**Priority**: Medium  
**Files**: [`backend/src/orchestrator/sessionTelemetryStore.ts`](../backend/src/orchestrator/sessionTelemetryStore.ts)

#### Current State

The system currently captures per-session summary selection stats:

- Mode (semantic vs recency)
- Selected/total/discarded counts
- Score ranges (min/max/mean)
- Fallback usage

**Location**: [`sessionTelemetryStore.ts:365-366`](../backend/src/orchestrator/sessionTelemetryStore.ts:365-366) stores `summarySelection` per session.

**Status**: Implemented. Cross-session aggregates maintained in-memory and exposed at `/admin/telemetry`.

#### Implementation Notes

Aggregate state introduced and wired via `summary_selection_stats` events.

```typescript
// After: const sessionTelemetry: SessionTelemetryRecord[] = [];

interface SummarySelectionAggregates {
  totalSessions: number;
  modeBreakdown: {
    semantic: number;
    recency: number;
  };
  totalSelected: number;
  totalDiscarded: number;
  errorCount: number;
  scoreRanges: {
    semantic: {
      samples: number;
      minScore: number;
      maxScore: number;
      avgScore: number;
    };
    recency: {
      samples: number;
      minScore: number;
      maxScore: number;
      avgScore: number;
    };
  };
  recentSamples: Array<{
    sessionId: string;
    mode: 'semantic' | 'recency';
    selectedCount: number;
    discardedCount: number;
    usedFallback: boolean;
    timestamp: number;
  }>;
}

const summaryAggregates: SummarySelectionAggregates = {
  totalSessions: 0,
  modeBreakdown: { semantic: 0, recency: 0 },
  totalSelected: 0,
  totalDiscarded: 0,
  errorCount: 0,
  scoreRanges: {
    semantic: { samples: 0, minScore: Infinity, maxScore: -Infinity, avgScore: 0 },
    recency: { samples: 0, minScore: Infinity, maxScore: -Infinity, avgScore: 0 },
  },
  recentSamples: [],
};

const MAX_RECENT_SAMPLES = 50;
```

**Step 2: Add aggregation function**

```typescript
function aggregateSummarySelection(stats: SummarySelectionStats): void {
  summaryAggregates.totalSessions += 1;
  summaryAggregates.modeBreakdown[stats.mode] += 1;
  summaryAggregates.totalSelected += stats.selectedCount;
  summaryAggregates.totalDiscarded += stats.discardedCount;

  if (stats.error) {
    summaryAggregates.errorCount += 1;
  }

  const range = summaryAggregates.scoreRanges[stats.mode];
  if (stats.meanScore !== undefined) {
    range.samples += 1;
    range.minScore = Math.min(range.minScore, stats.minScore ?? stats.meanScore);
    range.maxScore = Math.max(range.maxScore, stats.maxScore ?? stats.meanScore);
    // Running average
    range.avgScore = (range.avgScore * (range.samples - 1) + stats.meanScore) / range.samples;
  }

  // Store recent sample
  summaryAggregates.recentSamples.unshift({
    sessionId: '', // Will be set by caller
    mode: stats.mode,
    selectedCount: stats.selectedCount,
    discardedCount: stats.discardedCount,
    usedFallback: stats.usedFallback,
    timestamp: Date.now(),
  });

  // Trim old samples
  if (summaryAggregates.recentSamples.length > MAX_RECENT_SAMPLES) {
    summaryAggregates.recentSamples.length = MAX_RECENT_SAMPLES;
  }
}
```

**Step 3: Call aggregation in recordEvent (around line 365)**

```typescript
case 'telemetry': {
  // ... existing code ...

  if (payload?.summarySelection) {
    state.summarySelection = clone(payload.summarySelection as SummarySelectionStats);
    // NEW: Aggregate stats
    try {
      const copied = summaryAggregates.recentSamples[0];
      if (copied) {
        copied.sessionId = state.sessionId;
      }
      aggregateSummarySelection(payload.summarySelection as SummarySelectionStats);
    } catch (error) {
      console.warn('Failed to aggregate summary selection stats:', error);
    }
  }
  // ... rest of telemetry handling
}
```

**Step 4: Expose aggregates via new export**

```typescript
// Add at end of file:
export function getSummaryAggregates(): SummarySelectionAggregates {
  return {
    ...summaryAggregates,
    recentSamples: summaryAggregates.recentSamples.map((s) => ({ ...s })),
  };
}

export function clearSummaryAggregates(): void {
  summaryAggregates.totalSessions = 0;
  summaryAggregates.modeBreakdown = { semantic: 0, recency: 0 };
  summaryAggregates.totalSelected = 0;
  summaryAggregates.totalDiscarded = 0;
  summaryAggregates.errorCount = 0;
  summaryAggregates.scoreRanges = {
    semantic: { samples: 0, minScore: Infinity, maxScore: -Infinity, avgScore: 0 },
    recency: { samples: 0, minScore: Infinity, maxScore: -Infinity, avgScore: 0 },
  };
  summaryAggregates.recentSamples = [];
}
```

**Step 5: Update admin telemetry endpoint**

**File**: [`backend/src/routes/index.ts`](../backend/src/routes/index.ts)

Find the `/admin/telemetry` route and update:

```typescript
import {
  getSessionTelemetry,
  clearSessionTelemetry,
  getSummaryAggregates,
} from '../orchestrator/sessionTelemetryStore.js';

// Update existing route:
app.get('/admin/telemetry', async () => {
  return {
    sessions: getSessionTelemetry(),
    summaryAggregates: getSummaryAggregates(), // NEW
  };
});

// Optional: Add dedicated endpoint
app.get('/admin/telemetry/summary-aggregates', async () => {
  return getSummaryAggregates();
});
```

#### Validation

```bash
# Start backend
cd backend && pnpm dev

# Enable semantic summary
# In .env: ENABLE_SEMANTIC_SUMMARY=true

# Run several queries
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test query"}]}'

# Check aggregates
curl http://localhost:8787/admin/telemetry | jq '.summaryAggregates'

# Expected output:
{
  "totalSessions": 5,
  "modeBreakdown": {"semantic": 4, "recency": 1},
  "totalSelected": 18,
  "totalDiscarded": 12,
  "errorCount": 0,
  "scoreRanges": {
    "semantic": {
      "samples": 4,
      "minScore": 0.45,
      "maxScore": 0.89,
      "avgScore": 0.67
    }
  },
  "recentSamples": [...]
}
```

---

### Task 6: Add summary_selection_stats Event Emission

**Objective**: Real-time visibility for monitoring tools  
**Priority**: Low  
**Files**: [`backend/src/orchestrator/index.ts`](../backend/src/orchestrator/index.ts:986)

#### Current State

Summary stats are included in the `telemetry` event payload at line 986:

```typescript
emit?.('telemetry', {
  traceId: options.sessionId,
  ...telemetrySnapshot, // includes summarySelection
});
```

**Issue**: Monitoring tools may want dedicated event for filtering/alerting.

#### Implementation

**Add after line 986**:

```typescript
// Line 987 - NEW: Emit dedicated summary selection stats event
if (summaryStats && (summaryStats.selectedCount > 0 || summaryStats.error)) {
  emit?.('summary_selection_stats', summaryStats);
}
```

#### Frontend Updates (Optional)

If you want frontend to display this separately:

**File**: [`frontend/src/hooks/useChatStream.ts`](../frontend/src/hooks/useChatStream.ts)

Add handler around line 171:

```typescript
case 'summary_selection_stats': {
  const stats = parsed as SummarySelectionStats;
  // Could update separate state if needed
  // For now, already captured in telemetry event
  break;
}
```

**Note**: Frontend already displays these stats via the `telemetry` event in [`PlanPanel.tsx:188-228`](../frontend/src/components/PlanPanel.tsx:188-228), so this is optional.

#### Validation

```bash
# Start backend in dev mode
cd backend && pnpm dev

# Test streaming endpoint
curl -N -X POST http://localhost:8787/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}]}'

# Look for new event in SSE stream:
# event: summary_selection_stats
# data: {"mode":"semantic","totalCandidates":10,"selectedCount":6,...}
```

---

### Task 7: Update API Documentation

**Objective**: Clarify event naming convention for SSE clients  
**Priority**: Low  
**Files**: [`docs/responses-api.md`](responses-api.md)

#### Current Documentation (Line 13-14)

```markdown
- Chat SSE: `POST /chat/stream` streams model output. The backend forwards Azure SSE events and emits:
  - `response.output_text.delta`, `response.output_text.done`, `response.completed`
```

#### Issue

The orchestrator internally uses `'tokens'` (plural) but the streaming service maps this to `'token'` (singular) for clients. This mapping happens in:

- [`backend/src/services/chatStreamService.ts:20-23`](../backend/src/services/chatStreamService.ts:20-23)

Frontend correctly listens to `'token'`:

- [`frontend/src/hooks/useChatStream.ts:160-177`](../frontend/src/hooks/useChatStream.ts:160-177)

#### Implementation

Replace lines 12-15 with:

```markdown
## Streaming

Chat SSE (`POST /chat/stream`) streams model output via Server-Sent Events. The backend forwards Azure SSE events and emits custom orchestrator events.

**Event Naming Convention**:

- Clients should subscribe to `token` events (singular) for streamed answer content
- Internally, the orchestrator emits `tokens` events, which the streaming service maps to `token` for SSE clients
- See [`backend/src/services/chatStreamService.ts:20-23`](../backend/src/services/chatStreamService.ts:20-23) for mapping logic

**Core SSE Events**:

- `status` - Execution stage updates (context, planning, retrieval, generating, review)
- `route` - Intent classification result with model/retriever strategy
- `plan` - Query analysis and retrieval strategy
- `context` - Context budget breakdown (history, summary, salience)
- `tool` - Tool execution updates (references count, web results count)
- `citations` - Retrieved references with metadata
- `activity` - Execution steps timeline
- `token` - Answer tokens (streamed progressively) ⚠️ Listen to 'token' not 'tokens'
- `critique` - Critic evaluation (grounding, coverage, issues)
- `complete` - Final answer with full metadata
- `telemetry` - Performance metrics and diagnostics
- `trace` - Session trace object
- `done` - Stream completion signal

**Advanced Events** (when features enabled):

- `semantic_memory` - Recalled memories (when `ENABLE_SEMANTIC_MEMORY=true`)
- `complexity` - Query complexity assessment (when `ENABLE_QUERY_DECOMPOSITION=true`)
- `decomposition` - Sub-queries generated (when `ENABLE_QUERY_DECOMPOSITION=true`)
- `web_context` - Web search context info (when web search used)
- `reranking` - RRF reranking details (when `ENABLE_WEB_RERANKING=true`)
- `summary_selection_stats` - Summary selection metrics (future enhancement)

**Azure API Events** (forwarded from Azure OpenAI):

- `response.output_text.delta` - Partial text chunks from Azure
- `response.output_text.done` - Complete text from Azure
- `response.completed` - Azure response completion
- `response.usage` - Token usage (when `RESPONSES_STREAM_INCLUDE_USAGE=true`)
```

---

## Phase 3: Frontend Preparation (Est. 30 minutes)

### Task 8: API Client Upload Function Stub

**Objective**: Prepare for planned document upload feature  
**Priority**: Low  
**Files**: [`frontend/src/api/client.ts`](../frontend/src/api/client.ts)

#### Current Client

The client is basic axios with JSON-only support:

```typescript
// frontend/src/api/client.ts (current)
export const apiClient = axios.create({
  baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});
```

#### Enhancement Needed

Add multipart upload capability for future document upload.

#### Implementation

**Add to `frontend/src/api/client.ts`**:

```typescript
/**
 * Upload document for indexing
 *
 * @status Implemented in backend/src/routes/documents.ts (Fastify multipart endpoint)
 * @see docs/quickstart-pdf-upload.md for pipeline walkthrough
 * @see docs/architecture-map.md:198-206 for planned flow
 * @see docs/enhancement-implementation-plan.md:136-370 for full spec
 *
 * @param file PDF or document file to upload
 * @returns Upload result with document ID, title, chunk count
 * @throws Error if upload fails or backend endpoint is unreachable
 */
export async function uploadDocument(file: File): Promise<{
  success: boolean;
  documentId: string;
  title: string;
  filename: string;
  chunks: number;
  uploadedAt: string;
}> {
  // Validate file type
  if (!file.type.match(/^application\/(pdf|vnd\..*|octet-stream)$/)) {
    throw new Error('Only PDF files are supported');
  }

  // Validate file size (10MB limit)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    throw new Error(`File size exceeds ${MAX_SIZE / 1024 / 1024}MB limit`);
  }

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData,
    // Note: Don't set Content-Type - browser sets it with boundary for multipart
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({
      error: `HTTP ${response.status}`,
    }));
    throw new Error(errorData.error || errorData.message || 'Upload failed');
  }

  return response.json();
}

/**
 * Get list of user's uploaded documents (future feature)
 * @future Requires authentication and database implementation
 */
export async function getUserDocuments(): Promise<
  Array<{
    documentId: string;
    title: string;
    filename: string;
    chunks: number;
    uploadedAt: string;
  }>
> {
  const response = await apiClient.get('/documents');
  return response.data;
}

/**
 * Delete uploaded document (future feature)
 * @future Requires authentication and database implementation
 */
export async function deleteDocument(documentId: string): Promise<void> {
  await apiClient.delete(`/documents/${documentId}`);
}
```

#### Backend Reference

The server implementation lives in `backend/src/routes/documents.ts`. For a detailed walkthrough or customization tips, see:

- **Step-by-step**: [`docs/quickstart-pdf-upload.md`](quickstart-pdf-upload.md)
- **Architecture flow**: [`docs/architecture-map.md:198-206`](architecture-map.md:198-206)
- **Full specification**: [`docs/enhancement-implementation-plan.md:136-370`](enhancement-implementation-plan.md:136-370)

**Dependencies**:

```bash
cd backend
pnpm add @fastify/multipart pdf-parse
pnpm add -D @types/pdf-parse
```

**Backend files to create**:

- `backend/src/routes/documents.ts`
- `backend/src/services/documentService.ts`
- `backend/src/tools/documentProcessor.ts`

**Frontend files to create**:

- `frontend/src/components/DocumentUpload.tsx`
- `frontend/src/api/documents.ts` (imports from client.ts)

---

## Phase 4: Consistency & Hygiene (Optional)

### Task 9: Config Flag Comments

**Objective**: Self-documenting configuration  
**Priority**: Low  
**File**: [`backend/src/config/app.ts`](../backend/src/config/app.ts)

#### Implementation

Add one-line comments matching `.env.example` phrasing:

```typescript
// Around lines 55-90 (feature flags section):

// Summary-first document loading: saves 40-50% retrieval tokens
ENABLE_LAZY_RETRIEVAL: z.coerce.boolean().default(true),

// Adaptive model selection: saves 20-30% by routing to cheaper models
ENABLE_INTENT_ROUTING: z.coerce.boolean().default(true),

// Embedding-based context selection: +$20-30/month
ENABLE_SEMANTIC_SUMMARY: z.coerce.boolean().default(false),

// Persistent cross-session context: +$50-100/month
ENABLE_SEMANTIC_MEMORY: z.coerce.boolean().default(false),

// Complex multi-step query handling: +2-3x tokens for complex queries
ENABLE_QUERY_DECOMPOSITION: z.coerce.boolean().default(false),

// Unified Azure + web results via RRF: minimal cost impact
ENABLE_WEB_RERANKING: z.coerce.boolean().default(false),

// Embedding similarity boost in reranking: minimal cost impact
ENABLE_SEMANTIC_BOOST: z.coerce.boolean().default(false),

// Multi-pass quality assurance: standard cost, always recommended
ENABLE_CRITIC: z.coerce.boolean().default(true),
```

---

## Summary: Remaining Work from Original Analysis

### ✅ Completed (Phase 1)

1. ROADMAP.md consolidation
2. COMPREHENSIVE_AUDIT_REPORT.md fix
3. INDEX.md catalog
4. TODO.md tracker
5. Redundant file cleanup

### 📋 Remaining (Phases 2-4)

**Backend Actions**:

- [x] Task 5: Semantic summary telemetry aggregation ✅ (done)
- [x] Task 6: Add summary_selection_stats event ✅ (done)
- [ ] Task 7: Update responses-api.md documentation (15 min)
- [ ] Task 9: Add config flag comments (30 min)

**Frontend Actions**:

- [ ] Task 8: API client upload stub (15 min)
- [x] Task 10: Verify PlanPanel displays stats ✅ (already complete)

**Total Remaining**: ~3-4 hours

---

## Quick Command Reference

### Run Tests After Changes

```bash
cd backend
pnpm test                 # Run all tests
pnpm test:watch          # Watch mode
pnpm test:coverage       # With coverage
```

### Verify Telemetry

```bash
# Start backend
cd backend && pnpm dev

# Query API
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is Azure AI Search?"}]}'

# Check telemetry (dev only)
curl http://localhost:8787/admin/telemetry | jq '.'

# Check summary aggregates (after Task 5)
curl http://localhost:8787/admin/telemetry | jq '.summaryAggregates'
```

### Lint & Build

```bash
cd backend
pnpm lint                # Check code quality
pnpm lint --fix          # Auto-fix issues
pnpm build              # Compile TypeScript
```

---

## Implementation Order Recommendation

**Phase 2 (Backend)**: Do in sequence

1. Task 5 first (aggregation) - Provides foundation
2. Task 6 second (event) - Uses aggregation
3. Task 7 third (docs) - Documents new behavior
4. Task 9 last (comments) - Nice-to-have polish

**Phase 3 (Frontend)**: Independent

- Task 8 anytime - Just adds stub function

**Total time**: ~3-4 hours for all remaining tasks

---

## References

- **Original Analysis**: User-provided comprehensive sweep
- **TODO Tracker**: [`docs/TODO.md`](TODO.md) - Items 1-4
- **Roadmap**: [`docs/ROADMAP.md`](ROADMAP.md) - Strategic context
- **Source TODO**: [`docs/semantic-summary-plan.md:11`](semantic-summary-plan.md:11)

---

**Created**: October 9, 2025  
**Phase**: Post-Documentation  
**Next Review**: After backend telemetry implementation
