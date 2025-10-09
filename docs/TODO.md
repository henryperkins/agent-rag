# Implementation TODO

**Last Updated**: October 9, 2025  
**Tracking**: Short-term code and enhancement tasks  
**Related**: See [ROADMAP.md](ROADMAP.md) for strategic planning

---

## Overview

This document tracks **actionable implementation tasks** derived from planning documents. It serves as the bridge between high-level roadmap items and actual code changes.

**Status Key**:

- `[ ]` Not started
- `[-]` In progress
- `[x]` Completed

---

## High Priority (Next Sprint)

### Telemetry Enhancements

#### 1. Semantic Summary Telemetry Aggregation

**Status**: `[ ]` Not started  
**Priority**: Medium  
**Effort**: 2-3 hours  
**Source**: [semantic-summary-plan.md:11](semantic-summary-plan.md:11)

**Scope**: Add aggregate statistics for summary selection across sessions

**Files to Modify**:

- `backend/src/orchestrator/sessionTelemetryStore.ts`
  - Add counters: `totalSessions`, `modeBreakdown`, `totalDiscarded`, `errorCount`
  - Track score ranges over time (min/max/avg)
  - Store recent samples for trend analysis

**Implementation Details**:

```typescript
interface SummarySelectionAggregates {
  totalSessions: number;
  modeBreakdown: { semantic: number; recency: number };
  totalDiscarded: number;
  errorCount: number;
  scoreRanges: {
    semantic: { min: number; max: number; avg: number };
    recency: { min: number; max: number; avg: number };
  };
  recentSamples: Array<{
    sessionId: string;
    mode: string;
    selectedCount: number;
    discardedCount: number;
    timestamp: number;
  }>;
}
```

**Integration Points**:

- Update `createSessionRecorder` to aggregate stats
- Expose via `/admin/telemetry` endpoint
- Optional: Add `/admin/telemetry/summary` endpoint

**Validation**:

- Track for 24 hours with `ENABLE_SEMANTIC_SUMMARY=true`
- Verify counters increment correctly
- Check score calculations are accurate
- Ensure no memory leaks from sample storage

---

#### 2. Real-Time Summary Selection Stats Event

**Status**: `[ ]` Not started  
**Priority**: Low  
**Effort**: 30 minutes  
**Source**: Enhances observability

**Scope**: Emit explicit event for monitoring tools

**File to Modify**:

- `backend/src/orchestrator/index.ts:986`

**Implementation**:

```typescript
// After line 986, add:
emit?.('summary_selection_stats', summaryStats);
```

**Frontend Updates** (Optional):

- `frontend/src/hooks/useChatStream.ts` - Add event handler
- `frontend/src/components/PlanPanel.tsx` - Already displays stats ✅

**Validation**:

- Check SSE stream emits new event
- Verify frontend receives and can parse
- Confirm no duplicate data (already in telemetry event)

---

### Documentation Corrections

#### 3. Clarify Event Naming Convention

**Status**: `[ ]` Not started  
**Priority**: Low  
**Effort**: 15 minutes  
**Source**: Code review findings

**File to Modify**:

- `docs/responses-api.md:13-14`

**Current Text**:

```markdown
- Chat SSE: `POST /chat/stream` streams model output. The backend forwards Azure SSE events and emits:
  - `response.output_text.delta`, `response.output_text.done`, `response.completed`
```

**Updated Text**:

```markdown
- Chat SSE: `POST /chat/stream` streams model output. The backend forwards Azure SSE events and emits:
  - `response.output_text.delta`, `response.output_text.done`, `response.completed`

> **Event Naming**: Clients should listen for `token` events (singular). Internally, the orchestrator emits `tokens`, but the streaming service maps this to `token` for SSE clients. See `backend/src/services/chatStreamService.ts:20-23` for mapping logic.
```

**Cross-Reference**:

- `backend/src/orchestrator/index.ts:293` - Emits `'token'`
- `backend/src/services/chatStreamService.ts:20-23` - Maps `tokens` → `token`
- `frontend/src/hooks/useChatStream.ts:160-177` - Listens to `token`

---

### Future Feature Preparation

#### 4. API Client Upload Function Stub

**Status**: `[ ]` Not started  
**Priority**: Low  
**Effort**: 15 minutes  
**Source**: [architecture-map.md:198-206](architecture-map.md:198-206), [quickstart-pdf-upload.md](quickstart-pdf-upload.md)

**Scope**: Prepare frontend for document upload feature (not yet built)

**File to Modify**:

- `frontend/src/api/client.ts`

**Implementation**:

```typescript
/**
 * Upload document for indexing (PLANNED FEATURE - endpoint not yet implemented)
 *
 * @future This function is a stub for the planned document upload feature.
 * Backend endpoint `/documents/upload` needs to be created first.
 * See docs/quickstart-pdf-upload.md for implementation guide.
 */
export async function uploadDocument(file: File): Promise<{
  documentId: string;
  title: string;
  chunks: number;
  uploadedAt: string;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Upload failed');
  }

  return response.json();
}
```

**Dependencies**:

- Backend `POST /documents/upload` endpoint (not yet implemented)
- Backend document processing service (not yet implemented)
- See [enhancement-implementation-plan.md:136-370](enhancement-implementation-plan.md:136-370) for full implementation

---

## Medium Priority (Next Month)

### Azure Component Enhancements

#### 5. Web Quality Filtering

**Status**: `[ ]` Not started  
**Priority**: High impact  
**Effort**: 2-3 days  
**Source**: [azure-component-enhancements.md:1233-1479](azure-component-enhancements.md:1233-1479)

**Scope**: Filter low-quality web results by domain authority, semantic relevance, and KB redundancy

**Files to Create**:

- `backend/src/tools/webQualityFilter.ts`

**Implementation Checklist**:

- [ ] Domain authority scoring (trusted domains map)
- [ ] Semantic relevance calculation (embedding similarity)
- [ ] KB redundancy detection (avoid duplicate content)
- [ ] Filter thresholds configuration
- [ ] Integration in `backend/src/orchestrator/dispatch.ts:189`
- [ ] Telemetry for filtered count
- [ ] Unit tests

**Expected Impact**: 30-50% better web result quality

---

#### 6. Citation Usage Tracking

**Status**: `[ ]` Not started  
**Priority**: High impact  
**Effort**: 1-2 days  
**Source**: [azure-component-enhancements.md:695-800](azure-component-enhancements.md:695-800)

**Scope**: Track which retrieved documents are actually cited in answers

**Files to Create**:

- `backend/src/orchestrator/citationTracker.ts`

**Implementation Checklist**:

- [ ] Extract citation IDs from answer text (`[1]`, `[2]`, etc.)
- [ ] Mark which references were cited
- [ ] Calculate citation rate and density
- [ ] Feed patterns to semantic memory
- [ ] Integration in `backend/src/orchestrator/index.ts:914`
- [ ] Telemetry for citation rates
- [ ] Unit tests

**Expected Impact**: Learning loop for retrieval improvement

---

#### 7. Adaptive Query Reformulation

**Status**: `[ ]` Not started  
**Priority**: High impact  
**Effort**: 3-5 days  
**Source**: [azure-component-enhancements.md:436-689](azure-component-enhancements.md:436-689)

**Scope**: Assess retrieval quality and reformulate queries when insufficient

**Files to Create**:

- `backend/src/azure/adaptiveRetrieval.ts`

**Implementation Checklist**:

- [ ] Quality assessment (diversity, coverage, authority)
- [ ] Query reformulation prompt
- [ ] Recursive retry logic (max 3 attempts)
- [ ] Replace `retrieveTool` in `backend/src/tools/index.ts`
- [ ] Add config flags: `ENABLE_ADAPTIVE_RETRIEVAL`, thresholds
- [ ] Telemetry for reformulations
- [ ] Integration tests

**Expected Impact**: 30-50% reduction in "I do not know" responses

---

#### 8. Multi-Source Web Search

**Status**: `[ ]` Not started  
**Priority**: Medium  
**Effort**: 1 week  
**Source**: [azure-component-enhancements.md:1022-1229](azure-component-enhancements.md:1022-1229)

**Scope**: Add Semantic Scholar and arXiv APIs for academic papers

**Files to Create**:

- `backend/src/tools/multiSourceWeb.ts`

**Implementation Checklist**:

- [ ] Semantic Scholar API integration (free, 200M+ papers)
- [ ] arXiv API integration (free, latest preprints)
- [ ] Paper-to-WebResult conversion
- [ ] Parallel search execution
- [ ] Citation-based authority scoring
- [ ] Deduplication logic
- [ ] Integration in `backend/src/orchestrator/dispatch.ts`
- [ ] Unit tests

**Expected Impact**: Access to academic research corpus

---

#### 9. Incremental Web Loading

**Status**: `[ ]` Not started  
**Priority**: Medium  
**Effort**: 3-5 days  
**Source**: [azure-component-enhancements.md:1483-1646](azure-component-enhancements.md:1483-1646)

**Scope**: Start with 3 results, add batches until coverage threshold met

**Files to Create**:

- `backend/src/tools/incrementalWebSearch.ts`

**Implementation Checklist**:

- [ ] Coverage assessment function
- [ ] Batch loading logic (initial 3, batches of 3)
- [ ] Target coverage threshold (default 0.7)
- [ ] Max total results limit (default 10)
- [ ] Integration in `backend/src/orchestrator/dispatch.ts`
- [ ] Config flags: `ENABLE_INCREMENTAL_WEB`, thresholds
- [ ] Telemetry for batch counts
- [ ] Unit tests

**Expected Impact**: 40-60% reduction in web API calls

---

#### 10. Multi-Stage Synthesis

**Status**: `[ ]` Not started  
**Priority**: Medium  
**Effort**: 1 week  
**Source**: [azure-component-enhancements.md:36-127](azure-component-enhancements.md:36-127)

**Scope**: Extract → Compress → Synthesize pipeline

**Files to Create**:

- `backend/src/orchestrator/multiStageSynthesis.ts`

**Implementation Checklist**:

- [ ] Snippet extraction from each document
- [ ] Compressed context building
- [ ] Synthesis from compressed snippets
- [ ] Integration in `backend/src/orchestrator/index.ts:289-298`
- [ ] Config flag: `ENABLE_MULTI_STAGE_SYNTHESIS`
- [ ] Token savings telemetry
- [ ] Unit tests

**Expected Impact**: 30-40% token savings, better citation precision

---

## User-Facing Features (Months 2-3)

### 11. PDF Upload & Processing

**Status**: `[ ]` Not started  
**Priority**: User-requested  
**Effort**: 2-3 weeks  
**Source**: [enhancement-implementation-plan.md:136-370](enhancement-implementation-plan.md:136-370), [quickstart-pdf-upload.md](quickstart-pdf-upload.md)

**Scope**: Full PDF upload, chunking, embedding, and indexing pipeline

**Dependencies**:

- `@fastify/multipart`
- `pdf-parse`

**Files to Create**:

- `backend/src/routes/documents.ts`
- `backend/src/services/documentService.ts`
- `backend/src/tools/documentProcessor.ts`
- `frontend/src/components/DocumentUpload.tsx`
- `frontend/src/api/documents.ts`

**Implementation Phases**:

1. Backend document processing (1 week)
2. Azure Search index updates (2 days)
3. Frontend upload UI (3 days)
4. Integration testing (2 days)

**Reference**: Step-by-step guide in [quickstart-pdf-upload.md](quickstart-pdf-upload.md)

---

### 12. Citation Export

**Status**: `[ ]` Not started  
**Priority**: Academic workflow  
**Effort**: 1 week  
**Source**: [enhancement-implementation-plan.md:375-523](enhancement-implementation-plan.md:375-523)

**Scope**: Format citations in APA, MLA, Chicago, BibTeX

**Files to Create**:

- `backend/src/services/citationFormatter.ts`
- Update `frontend/src/components/SourcesPanel.tsx`

**Implementation Checklist**:

- [ ] APA formatter
- [ ] MLA formatter
- [ ] Chicago formatter
- [ ] BibTeX formatter
- [ ] Export endpoint: `POST /citations/export`
- [ ] Frontend export buttons
- [ ] File download handling
- [ ] Unit tests for each format

---

### 13. User Sessions & Database

**Status**: `[ ]` Not started  
**Priority**: Multi-user support  
**Effort**: 3-4 weeks  
**Source**: [enhancement-implementation-plan.md:526-794](enhancement-implementation-plan.md:526-794)

**Scope**: Persistent storage with authentication

**Dependencies**:

- PostgreSQL or better-sqlite3
- `@fastify/jwt`
- `pg` (if using PostgreSQL)

**Files to Create**:

- `backend/src/services/databaseService.ts`
- `backend/src/middleware/auth.ts`
- `frontend/src/api/auth.ts`
- Database migration scripts

**Implementation Phases**:

1. Database schema design (3 days)
2. Authentication middleware (2 days)
3. Session persistence (3 days)
4. Query history (2 days)
5. Frontend integration (3 days)
6. Testing (2 days)

**Schema Tables**:

- `users`
- `sessions`
- `conversations`
- `memory_summaries`
- `salience_notes`
- `query_history`

---

## Research Techniques (Months 3-6)

### 14. CRAG Evaluator (Self-Grading Retrieval)

**Status**: `[ ]` Not started  
**Priority**: High ROI  
**Effort**: 3-5 days  
**Source**: [2025-agentic-rag-techniques-deepdive.md:380-650](2025-agentic-rag-techniques-deepdive.md:380-650)

**Scope**: Retrieval quality assessment with web fallback

**Files to Create**:

- `backend/src/orchestrator/CRAG.ts`

**Implementation Checklist**:

- [ ] Retrieval evaluator (confidence: correct/ambiguous/incorrect)
- [ ] Knowledge refinement for ambiguous results
- [ ] Web search fallback for incorrect results
- [ ] Integration in `backend/src/orchestrator/dispatch.ts`
- [ ] Config flag: `ENABLE_CRAG`
- [ ] Telemetry for CRAG actions
- [ ] Unit tests

**Expected Impact**: 30-50% hallucination reduction

---

### 15. Self-RAG Reflection Tokens

**Status**: `[ ]` Not started  
**Priority**: Quality improvement  
**Effort**: 2-3 days  
**Source**: [2025-agentic-rag-techniques-deepdive.md:39-339](2025-agentic-rag-techniques-deepdive.md:39-339)

**Scope**: [ISREL], [ISSUP], [ISUSE] filtering

**Files to Create**:

- `backend/src/orchestrator/selfRAG.ts`

**Implementation Checklist**:

- [ ] [ISREL] document relevance evaluator
- [ ] [ISSUP] generation support verifier
- [ ] [ISUSE] utility scorer (1-5)
- [ ] Integration in `backend/src/orchestrator/dispatch.ts`
- [ ] Config flags: `ENABLE_SELF_RAG`, thresholds
- [ ] Telemetry for reflection scores
- [ ] Unit tests

**Expected Impact**: 52% hallucination reduction (benchmark)

---

### 16. HyDE Retrieval

**Status**: `[ ]` Not started  
**Priority**: Semantic matching improvement  
**Effort**: 1 week  
**Source**: [2025-agentic-rag-techniques-deepdive.md:653-816](2025-agentic-rag-techniques-deepdive.md:653-816)

**Scope**: Hypothetical answer generation for better embedding matching

**Files to Create**:

- `backend/src/azure/hydeRetrieval.ts`

**Implementation Checklist**:

- [ ] Generate hypothetical answers (3 variants with temp variance)
- [ ] Embed hypothetical answers
- [ ] Search with hypothetical embeddings
- [ ] Merge and deduplicate results
- [ ] Rerank by average score
- [ ] Config flag: `ENABLE_HYDE`, `HYDE_NUM_HYPOTHETICALS`
- [ ] Integration as retrieval strategy option
- [ ] Unit tests

**Expected Impact**: Better recall for vague queries

**Trade-offs**:

- ⚠️ Adds LLM generation step (higher latency + cost)
- ⚠️ Requires LLM knowledge of topic

---

### 17. RAPTOR Hierarchical Summarization

**Status**: `[ ]` Not started  
**Priority**: Long document support  
**Effort**: 1-2 weeks  
**Source**: [2025-agentic-rag-techniques-deepdive.md:819-1027](2025-agentic-rag-techniques-deepdive.md:819-1027)

**Scope**: Build tree of summaries for multi-level retrieval

**Files to Create**:

- `backend/src/orchestrator/raptor.ts`
- `backend/scripts/buildRaptorIndex.ts`

**Implementation Checklist**:

- [ ] Clustering algorithm (K-means or GMM)
- [ ] Recursive summarization
- [ ] Tree building from base chunks
- [ ] Multi-level retrieval
- [ ] Pre-build script for index creation
- [ ] Config flag: `ENABLE_RAPTOR`, `RAPTOR_TREE_PATH`
- [ ] Storage overhead management (3-5x base chunks)
- [ ] Unit tests

**Expected Impact**: 20% improvement on QuALITY benchmark (GPT-4)

**Best For**:

- Long documents (>10k tokens)
- Multi-step reasoning queries
- Hierarchical document structures

---

## Completed Items

### Documentation Organization

- [x] Create `docs/ROADMAP.md` - Consolidated roadmap (Oct 9, 2025)
- [x] Fix `docs/COMPREHENSIVE_AUDIT_REPORT.md` broken references (Oct 9, 2025)
- [x] Create `docs/INDEX.md` - Documentation catalog (Oct 9, 2025)
- [x] Create `docs/TODO.md` - This file (Oct 9, 2025)

### Core Features (v1.0.0 - v2.0.1)

- [x] Unified orchestrator pattern
- [x] Multi-pass critic loop
- [x] Lazy retrieval with summary-first
- [x] Intent routing with adaptive model selection
- [x] Query decomposition for complex queries
- [x] Semantic memory store (SQLite-backed)
- [x] RRF reranking (Azure + web)
- [x] Context engineering pipeline
- [x] OpenTelemetry integration
- [x] SSE streaming architecture
- [x] Feature flags system (7 flags)
- [x] Comprehensive test coverage (41 tests)
- [x] SSE timeout fix (v2.0.1)
- [x] Sanitization error handling (v2.0.1)

---

## Backlog (Months 6-12)

### Advanced Research Techniques

#### GraphRAG Knowledge Graphs

**Effort**: 2-3 months  
**Complexity**: Very High  
**Source**: [2025-agentic-rag-techniques-deepdive.md:1069-1257](2025-agentic-rag-techniques-deepdive.md:1069-1257)

**Scope**: Entity extraction, graph construction, community detection

**Best For**: Relationship-heavy queries, multi-hop reasoning

---

#### Multi-Modal Embeddings

**Effort**: 1-2 months  
**Complexity**: High  
**Source**: [2025-agentic-rag-techniques-deepdive.md:1278-1447](2025-agentic-rag-techniques-deepdive.md:1278-1447)

**Scope**: Text + image + table embeddings for PDFs

**Dependencies**: GPT-4V, CLIP, or Voyage-multimodal-3

---

### User Experience Enhancements

#### Collection Management

**Effort**: 3-4 weeks  
**Source**: [enhancement-implementation-plan.md:908-1147](enhancement-implementation-plan.md:908-1147)

**Scope**: Save and organize research materials

**Features**:

- Create collections
- Add items with tags
- Search across collections
- Share collections (optional)

---

#### Browser Extension

**Effort**: 6-8 weeks  
**Source**: [liner-comparison-analysis.md:913-957](liner-comparison-analysis.md:913-957)

**Scope**: Chrome/Firefox extension for web highlighting and search

**Features**:

- Text highlighting on web pages
- Save highlights to collections
- Quick search from browser
- Sync with main application

---

## Deferred / Not Planned

### Low Priority Items

- Mobile applications (iOS/Android) - Not planned
- Research workflow templates - Defer to user needs
- Integration with Zotero/Mendeley - Community contribution

---

## Notes

### Implementation Guidelines

1. **Feature Flags**: All new features must be behind config flags (default: `false`)
2. **Testing**: Unit tests required before merge (target: >80% coverage)
3. **Documentation**: Update ROADMAP.md and IMPLEMENTED_VS_PLANNED.md
4. **Telemetry**: Add observability for all new operations
5. **Cost Impact**: Document token/API cost implications

### Cross-Cutting Concerns

- All enhancements should integrate with existing telemetry
- Maintain type safety through `shared/types.ts`
- Follow repository coding conventions (AGENTS.md)
- Add OpenTelemetry spans for new operations
- Update `.env.example` for new config options

---

## Tracking Workflow

### Moving Tasks

**From TODO → In Progress**:

1. Create feature branch
2. Update status to `[-]` in this file
3. Commit: `Start: <task name>`

**From In Progress → Complete**:

1. Update status to `[x]` in this file
2. Add completion date
3. Update ROADMAP.md if major milestone
4. Update CHANGELOG.md
5. Commit: `Complete: <task name>`

### When to Create New Tasks

- Feature requests from users
- Issues discovered during implementation
- Research findings with clear ROI
- Dependency upgrades requiring code changes

---

## Related Documents

- [ROADMAP.md](ROADMAP.md) - Strategic planning and priorities
- [PRIORITIZED_ACTION_PLAN.md](PRIORITIZED_ACTION_PLAN.md) - Immediate actions
- [IMPLEMENTED_VS_PLANNED.md](IMPLEMENTED_VS_PLANNED.md) - Feature status
- [INDEX.md](INDEX.md) - Complete documentation catalog

---

**Maintained by**: Development Team  
**Update Frequency**: Weekly during active development, bi-weekly during maintenance  
**Next Review**: October 16, 2025
