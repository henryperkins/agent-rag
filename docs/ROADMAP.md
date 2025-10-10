# Agent-RAG Development Roadmap

**Last Updated**: October 9, 2025  
**Current Version**: 2.0.1  
**Status**: Production-Ready with Enhancement Pipeline

---

## Overview

This roadmap consolidates planning information across multiple strategy documents into a single navigation hub. It provides clear visibility into completed work, active priorities, and future enhancements.

**Key Documents**:

- [PRIORITIZED_ACTION_PLAN.md](PRIORITIZED_ACTION_PLAN.md) - Immediate actions (Weeks 1-4)
- [enhancement-implementation-plan.md](enhancement-implementation-plan.md) - User-facing features
- [azure-component-enhancements.md](azure-component-enhancements.md) - Azure optimizations
- [2025-agentic-rag-techniques-deepdive.md](2025-agentic-rag-techniques-deepdive.md) - Research techniques
- [architecture-map.md](architecture-map.md) - System design & planned features

---

## Current Status (v2.0.1)

### ✅ Production-Ready Core

**Infrastructure** (100% Complete):

- Unified orchestrator pattern (`runSession` entry point)
- Direct Azure AI Search integration (hybrid semantic search)
- Azure OpenAI Responses API with streaming support
- OpenTelemetry distributed tracing
- 41/41 tests passing, zero compilation errors

**Quality Assurance** (100% Complete):

- Multi-pass critic loop with revision guidance
- Grounding verification and coverage scoring
- Critique history tracking in telemetry
- SSE timeout fix (v2.0.1)

**Retrieval** (100% Complete):

- Lazy retrieval with summary-first pattern
- 3-level fallback chain (hybrid → lowered threshold → pure vector)
- RRF reranking combining Azure + web results
- Query decomposition for complex queries

**Context Management** (100% Complete):

- History compaction with token budgeting
- Semantic summary selection with embedding similarity
- Semantic memory store (SQLite-backed, cross-session)
- Salience tracking across conversation turns

**Configuration** (100% Complete):

- Comprehensive `.env.example` (174 lines)
- README.md warnings and progressive enablement guide
- 7 feature flags with cost/risk documentation
- 77 configurable environment variables

### ⚠️ Feature Flags Status

| Flag                         | Default | Status      | Recommendation            |
| ---------------------------- | ------- | ----------- | ------------------------- |
| `ENABLE_CRITIC`              | `true`  | ✅ Active   | Always enabled            |
| `ENABLE_LAZY_RETRIEVAL`      | `false` | ⚠️ Disabled | Enable for 40-50% savings |
| `ENABLE_INTENT_ROUTING`      | `false` | ⚠️ Disabled | Enable for 20-30% savings |
| `ENABLE_WEB_RERANKING`       | `false` | ⚠️ Disabled | Enable with web search    |
| `ENABLE_SEMANTIC_SUMMARY`    | `false` | ⚠️ Disabled | Optional quality boost    |
| `ENABLE_SEMANTIC_MEMORY`     | `false` | ⚠️ Disabled | Optional cross-session    |
| `ENABLE_QUERY_DECOMPOSITION` | `false` | ⚠️ Disabled | Power users only          |

**Note**: Features are disabled by default for cost control. See [PRIORITIZED_ACTION_PLAN.md](PRIORITIZED_ACTION_PLAN.md) for progressive enablement strategy.

---

## Immediate Priorities (Weeks 1-4)

### Week 1: Documentation & Validation

**Status**: 🔄 In Progress  
**Source**: [PRIORITIZED_ACTION_PLAN.md:10-153](PRIORITIZED_ACTION_PLAN.md:10-153)

- [x] Create `.env.example` template (COMPLETED v2.0.1)
- [x] Update README.md with feature flag warnings (COMPLETED v2.0.1)
- [x] Apply SSE timeout fix (COMPLETED v2.0.1)
- [x] Apply sanitization error fix (COMPLETED v2.0.1)
- [ ] Create consolidated ROADMAP.md (THIS FILE)
- [ ] Fix COMPREHENSIVE_AUDIT_REPORT.md broken references
- [ ] Create documentation INDEX.md
- [ ] Create implementation TODO.md

**Deliverable**: Clear documentation preventing deployment confusion

---

### Weeks 2-3: Quick Wins

**Status**: 📋 Planned  
**Source**: [PRIORITIZED_ACTION_PLAN.md:354-511](PRIORITIZED_ACTION_PLAN.md:354-511)

**Backend Enhancements** (6-8 days total):

1. **Enable response storage** (2 days)
   - Add `ENABLE_RESPONSE_STORAGE` config flag
   - Log response IDs in telemetry
   - Enable debugging and replay capability
2. **Web quality filtering** (2-3 days) 🥇 High Impact
   - Create `backend/src/tools/webQualityFilter.ts`
   - Domain authority scoring
   - Semantic relevance filtering
   - KB redundancy detection
   - **Impact**: 30-50% better web results
   - **Reference**: [azure-component-enhancements.md:1233-1479](azure-component-enhancements.md:1233-1479)

3. **Citation tracking** (1-2 days) 🥇 High Impact
   - Create `backend/src/orchestrator/citationTracker.ts`
   - Track which sources are actually cited
   - Feed patterns to semantic memory
   - **Impact**: Learning loop for retrieval improvement
   - **Reference**: [azure-component-enhancements.md:695-800](azure-component-enhancements.md:695-800)

4. **Search highlights display** (1 day)
   - Update `frontend/src/components/SourcesPanel.tsx`
   - Show matched keywords from `@search.highlights`
   - **Impact**: Better UX, shows why results retrieved

---

## Medium-Term Enhancements (Months 1-3)

### Month 1: Adaptive Retrieval

**Status**: 📋 Planned  
**Source**: [azure-component-enhancements.md:432-689](azure-component-enhancements.md:432-689)

**Adaptive query reformulation** (3-5 days):

- Create `backend/src/azure/adaptiveRetrieval.ts`
- Quality assessment (diversity, coverage, authority)
- Automatic query reformulation on poor results
- Recursive retry with improved queries
- **Impact**: 30-50% reduction in "I do not know" responses

**Multi-source web search** (1 week):

- Create `backend/src/tools/multiSourceWeb.ts`
- Semantic Scholar API integration (200M+ papers)
- arXiv API integration (latest preprints)
- **Impact**: Academic research capabilities
- **Reference**: [azure-component-enhancements.md:1022-1229](azure-component-enhancements.md:1022-1229)

**Incremental web loading** (3-5 days):

- Create `backend/src/tools/incrementalWebSearch.ts`
- Start with 3 results, add batches until coverage threshold
- Coverage-based expansion
- **Impact**: 40-60% reduction in web API calls
- **Reference**: [azure-component-enhancements.md:1483-1646](azure-component-enhancements.md:1483-1646)

---

### Months 2-3: Synthesis & User Features

**Status**: 📋 Planned

**Multi-stage synthesis** (1 week):

- Create `backend/src/orchestrator/multiStageSynthesis.ts`
- Extract → Compress → Synthesize pipeline
- Strip-level relevance filtering
- **Impact**: 30-40% token savings, better citations
- **Reference**: [azure-component-enhancements.md:36-127](azure-component-enhancements.md:36-127)

**PDF Upload** (2-3 weeks) — ✅ Completed (runtime ingestion now available):

- Add `@fastify/multipart`, `pdf-parse` dependencies
- Create `backend/src/routes/documents.ts`
- Create `backend/src/services/documentService.ts`
- Create `frontend/src/components/DocumentUpload.tsx`
- **Impact**: User-requested content indexing
- **Reference**: [enhancement-implementation-plan.md:136-370](enhancement-implementation-plan.md:136-370), [quickstart-pdf-upload.md](quickstart-pdf-upload.md)
- **Note**: Currently marked as "Planned Feature" in [architecture-map.md:198-206](architecture-map.md:198-206)

**Citation Export** (1 week):

- Create `backend/src/services/citationFormatter.ts`
- Support APA, MLA, Chicago, BibTeX formats
- Add export endpoint and UI
- **Impact**: Academic workflow integration
- **Reference**: [enhancement-implementation-plan.md:375-523](enhancement-implementation-plan.md:375-523)

**User Sessions & Database** (3-4 weeks) — ✅ Completed (SQLite-backed session store):

- Choose database (PostgreSQL recommended)
- Implement `backend/src/services/databaseService.ts`
- Add JWT authentication middleware
- Persistent conversation history
- **Impact**: Multi-user support, history persistence
- **Reference**: [enhancement-implementation-plan.md:526-794](enhancement-implementation-plan.md:526-794)

---

## Long-Term Vision (Months 3-12)

### Advanced Retrieval Techniques

**Status**: 📋 Research Phase  
**Source**: [2025-agentic-rag-techniques-deepdive.md:1503-1655](2025-agentic-rag-techniques-deepdive.md:1503-1655)

**Phase 1: Self-Correction** (1-2 weeks):

1. **CRAG Evaluator** (3-5 days) 🎯 Highest ROI
   - Retrieval confidence scoring
   - Web search fallback for low-quality retrieval
   - Strip-level knowledge refinement
   - **Impact**: 30-50% hallucination reduction
   - **Reference**: [2025-agentic-rag-techniques-deepdive.md:380-650](2025-agentic-rag-techniques-deepdive.md:380-650)

2. **Self-RAG Lite** (2-3 days) 🎯 Easy Integration
   - [ISREL] document relevance filtering
   - [ISSUP] generation support verification
   - Add to telemetry
   - **Impact**: 52% hallucination reduction (benchmark)
   - **Reference**: [2025-agentic-rag-techniques-deepdive.md:39-339](2025-agentic-rag-techniques-deepdive.md:39-339)

**Phase 2: Advanced Retrieval** (2-3 weeks): 3. **HyDE Integration** (1 week)

- Hypothetical document generation
- Answer-to-answer embedding search
- Add as retrieval strategy option
- **Impact**: Better semantic matching for vague queries
- **Reference**: [2025-agentic-rag-techniques-deepdive.md:653-816](2025-agentic-rag-techniques-deepdive.md:653-816)

4. **RAPTOR Preprocessing** (1-2 weeks)
   - Build hierarchical summarization tree
   - Multi-level retrieval logic
   - For long documents (>10k tokens)
   - **Impact**: 20% improvement on QuALITY benchmark
   - **Reference**: [2025-agentic-rag-techniques-deepdive.md:819-1027](2025-agentic-rag-techniques-deepdive.md:819-1027)

**Phase 3: Knowledge Graphs** (2-3 months): 5. **GraphRAG** (Optional, Complex)

- LLM entity/relationship extraction
- Graph database integration (Neo4j)
- Community detection and summarization
- **Impact**: Multi-hop reasoning, relationship discovery
- **Reference**: [2025-agentic-rag-techniques-deepdive.md:1069-1257](2025-agentic-rag-techniques-deepdive.md:1069-1257)

**Phase 4: Multi-Modal** (1-2 months): 6. **Multi-Modal Embeddings**

- PDF extraction (Unstructured.io)
- Table summarization
- GPT-4V integration for generation
- **Impact**: Support visual documents, financial reports
- **Reference**: [2025-agentic-rag-techniques-deepdive.md:1278-1447](2025-agentic-rag-techniques-deepdive.md:1278-1447)

---

### Advanced Architecture

**Status**: 📋 Long-Term  
**Source**: [azure-component-enhancements.md:1771-1792](azure-component-enhancements.md:1771-1792)

**Scratchpad reasoning** (2-3 weeks):

- Create `backend/src/orchestrator/scratchpad.ts`
- Extract facts, contradictions, gaps
- Explicit reasoning artifacts
- **Reference**: [azure-component-enhancements.md:131-285](azure-component-enhancements.md:131-285)

**Ensemble generation** (1 week):

- Create `backend/src/orchestrator/ensemble.ts`
- Parallel strategy generation (concise/comprehensive/balanced)
- Critic-based selection
- **Reference**: [azure-component-enhancements.md:287-423](azure-component-enhancements.md:287-423)

**Multi-index federation** (2 weeks) — ✅ Completed with weighted federated search:

- Create `backend/src/azure/multiIndexSearch.ts`
- Search across specialized indexes (FAQs, code, policies)
- Intent-aware index selection
- **Reference**: [azure-component-enhancements.md:822-1009](azure-component-enhancements.md:822-1009)

---

## Implementation Tracking

### Completed Features (v1.0.0 - v2.0.1)

**v2.0.1** (October 8, 2025):

- ✅ SSE timeout fix for streaming chat
- ✅ Sanitization error handling (400 vs 500)
- ✅ All tests passing (41/41)

**v2.0.0** (October 7, 2025):

- ✅ Tool injection bug fix
- ✅ Complete test coverage
- ✅ Test assertion updates for lazy/direct paths

**v1.0.0** (October 4, 2025):

- ✅ Unified orchestrator with sync/stream modes
- ✅ Lazy retrieval with critic-triggered hydration
- ✅ Intent routing (FAQ/Research/Factual/Conversational)
- ✅ Query decomposition with dependency execution
- ✅ Semantic memory (SQLite-backed, cross-session)
- ✅ RRF reranking (Azure + web results)
- ✅ Context engineering (compaction, budgeting, selection)
- ✅ Feature flags (7 toggleable capabilities)

**Reference**: See [CHANGELOG.md](../CHANGELOG.md) for complete history

---

### Active Work Items

**Documentation Organization** (This Week):

- [x] Create ROADMAP.md (this file)
- [ ] Fix broken references in COMPREHENSIVE_AUDIT_REPORT.md
- [ ] Create INDEX.md documentation catalog
- [ ] Create TODO.md implementation tracker

**Telemetry Enhancements** (Next Sprint):

- [ ] Aggregate summary selection counters
- [ ] Real-time `summary_selection_stats` event
- [ ] Clarify event naming in responses-api.md

---

## Priority Matrix

### High Priority (Next 4-6 Weeks)

| Enhancement               | Effort   | Impact                         | ROI     | Reference                                                                                          |
| ------------------------- | -------- | ------------------------------ | ------- | -------------------------------------------------------------------------------------------------- |
| **Web quality filtering** | 2-3 days | 30-50% better results          | 🥇 HIGH | [azure-component-enhancements.md:1233-1479](azure-component-enhancements.md:1233-1479)             |
| **Citation tracking**     | 1-2 days | Learning loop                  | 🥇 HIGH | [azure-component-enhancements.md:695-800](azure-component-enhancements.md:695-800)                 |
| **Adaptive retrieval**    | 3-5 days | 30-50% fewer "I do not know"   | 🥇 HIGH | [azure-component-enhancements.md:436-689](azure-component-enhancements.md:436-689)                 |
| **CRAG evaluator**        | 3-5 days | 30-50% hallucination reduction | 🥇 HIGH | [2025-agentic-rag-techniques-deepdive.md:380-650](2025-agentic-rag-techniques-deepdive.md:380-650) |

### Medium Priority (Months 2-3)

| Enhancement             | Effort    | Impact                 | Reference                                                                                |
| ----------------------- | --------- | ---------------------- | ---------------------------------------------------------------------------------------- |
| Multi-stage synthesis   | 1 week    | 30-40% token savings   | [azure-component-enhancements.md:36-127](azure-component-enhancements.md:36-127)         |
| Multi-source web        | 1 week    | 200M+ papers access    | [azure-component-enhancements.md:1022-1229](azure-component-enhancements.md:1022-1229)   |
| Incremental web loading | 3-5 days  | 40-60% fewer API calls | [azure-component-enhancements.md:1483-1646](azure-component-enhancements.md:1483-1646)   |
| PDF upload              | 2-3 weeks | User-requested feature | [enhancement-implementation-plan.md:136-370](enhancement-implementation-plan.md:136-370) |
| Citation export         | 1 week    | Academic workflow      | [enhancement-implementation-plan.md:375-523](enhancement-implementation-plan.md:375-523) |

### Low Priority (Months 3-12)

| Enhancement                | Effort     | Complexity | Reference                                                                                              |
| -------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| Self-RAG reflection tokens | 2-3 days   | Medium     | [2025-agentic-rag-techniques-deepdive.md:39-339](2025-agentic-rag-techniques-deepdive.md:39-339)       |
| HyDE retrieval             | 1 week     | Medium     | [2025-agentic-rag-techniques-deepdive.md:653-816](2025-agentic-rag-techniques-deepdive.md:653-816)     |
| RAPTOR hierarchical        | 1-2 weeks  | High       | [2025-agentic-rag-techniques-deepdive.md:819-1027](2025-agentic-rag-techniques-deepdive.md:819-1027)   |
| GraphRAG                   | 2-3 months | Very High  | [2025-agentic-rag-techniques-deepdive.md:1069-1257](2025-agentic-rag-techniques-deepdive.md:1069-1257) |
| Multi-modal embeddings     | 1-2 months | High       | [2025-agentic-rag-techniques-deepdive.md:1278-1447](2025-agentic-rag-techniques-deepdive.md:1278-1447) |
| User sessions & database   | 3-4 weeks  | High       | [enhancement-implementation-plan.md:526-794](enhancement-implementation-plan.md:526-794)               |
| Collection management      | 3-4 weeks  | Medium     | [enhancement-implementation-plan.md:908-1147](enhancement-implementation-plan.md:908-1147)             |
| Browser extension          | 6-8 weeks  | High       | [liner-comparison-analysis.md:913-957](liner-comparison-analysis.md:913-957)                           |

---

## Research Initiatives

### Context Engineering Best Practices

**Status**: ✅ Reference Material  
**Source**: [context-engineering.md](context-engineering.md)

**Applied Patterns**:

- Write/Select/Compress/Isolate strategies
- Token budgeting across components
- Scratchpad and memory persistence
- Evaluator-optimizer cycles
- Just-in-time retrieval

**Potential Enhancements**:

- Tool schema hardening with poka-yoke patterns
- Multi-agent orchestrator-worker patterns
- Standardized ACI (Agent-Computer Interface) design

---

### Enterprise Telemetry & Observability

**Status**: ✅ Implemented (OpenTelemetry)  
**Source**: [enterprise-ai-telemetry.md](enterprise-ai-telemetry.md)

**Current Implementation**:

- OpenTelemetry distributed tracing
- Session telemetry with redaction
- Structured spans for all operations
- Azure Monitor integration ready

**Enhancement Opportunities**:

- Agent-specific evaluators (intent resolution, tool accuracy)
- RAG-specific metrics (retrieval precision/recall)
- Safety and compliance tracking
- Content safety API integration

---

### Competitive Analysis & Feature Gaps

**Status**: ✅ Analysis Complete  
**Source**: [liner-comparison-analysis.md](liner-comparison-analysis.md)

**Liner Features Worth Adopting**:

- Document upload and processing ✓ (planned)
- Citation export in multiple formats ✓ (planned)
- User sessions and history ✓ (planned)
- Collection management ✓ (planned)
- Browser extension ✓ (long-term)
- Multi-modal input (images, videos)

**Agent-RAG Unique Strengths**:

- Transparent AI reasoning (plan visibility)
- Quality assurance pipeline (multi-pass critic)
- Adaptive retrieval with fallback chains
- Context engineering (token budgeting)
- Azure-native enterprise integration
- Self-hosted with full data control

---

## Deployment & Operations

### Production Deployment Guide

**Status**: ✅ Complete Documentation  
**Source**: [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)

**Coverage**:

- Progressive feature enablement (Week 1-3)
- Azure quota requirements by config tier
- Monitoring dashboards and alerts
- Rollback procedures
- Performance benchmarks

**Configuration Tiers**:

- **Minimal**: $200-300/mo (dev/testing)
- **Balanced**: $400-600/mo (production recommended)
- **Full**: $700-1000/mo (enterprise quality-first)

---

### Cost Optimization Strategy

**Status**: ⚠️ Needs Attention  
**Current**: Only `ENABLE_CRITIC=true`, missing 50-65% savings

**Recommended Actions** (from [PRIORITIZED_ACTION_PLAN.md:199-250](PRIORITIZED_ACTION_PLAN.md:199-250)):

1. Enable `LAZY_RETRIEVAL` for 40-50% token savings
2. Enable `INTENT_ROUTING` for 20-30% cost savings
3. Monitor with Azure spending alerts
4. Track token usage per feature flag

---

## Dependencies & Prerequisites

### Azure Resources Required

- Azure AI Search (semantic ranking enabled)
- Azure OpenAI (GPT-4o + text-embedding-3-large)
- Application Insights (optional, for enhanced telemetry)
- Azure Blob Storage (for document upload feature)

### Optional Integrations

- Google Custom Search API (web augmentation)
- Semantic Scholar API (academic papers, free)
- arXiv API (preprints, free)

### Technical Requirements

- Node.js 20.19.5+
- pnpm 10+
- better-sqlite3 (for semantic memory)
- TypeScript 5.6+

---

## Document Reference Guide

### Planning & Strategy

- **This file** - Consolidated roadmap with priorities
- [PRIORITIZED_ACTION_PLAN.md](PRIORITIZED_ACTION_PLAN.md) - Immediate action items with timeline
- [enhancement-implementation-plan.md](enhancement-implementation-plan.md) - User-facing features (PDF, citations, sessions)
- [azure-component-enhancements.md](azure-component-enhancements.md) - Azure-specific optimizations
- [2025-agentic-rag-techniques-deepdive.md](2025-agentic-rag-techniques-deepdive.md) - Research techniques (Self-RAG, CRAG, HyDE, RAPTOR)

### Implementation Status

- [IMPLEMENTED_VS_PLANNED.md](IMPLEMENTED_VS_PLANNED.md) - Feature inventory (exists vs planned)
- [CRITIC_ENHANCEMENTS.md](CRITIC_ENHANCEMENTS.md) - Multi-pass critic implementation details
- [TEST_FIXES_SUMMARY.md](TEST_FIXES_SUMMARY.md) - Recent bug fixes (Oct 7, 2025)
- [MANAGED_IDENTITY_FIX.md](MANAGED_IDENTITY_FIX.md) - Azure auth configuration

### Architecture

- [architecture-map.md](architecture-map.md) - System overview, data flows, extension points
- [unified-orchestrator-context-pipeline.md](unified-orchestrator-context-pipeline.md) - Orchestrator design spec
- [context-engineering.md](context-engineering.md) - Best practices from research

### Operations

- [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md) - Progressive enablement guide
- [enterprise-ai-telemetry.md](enterprise-ai-telemetry.md) - Observability framework
- [responses-api.md](responses-api.md) - Azure OpenAI API usage

### Research & Comparisons

- [liner-comparison-analysis.md](liner-comparison-analysis.md) - Competitive feature analysis
- [semantic-summary-plan.md](semantic-summary-plan.md) - Summary selection design
- [semantic-summary-evaluation.md](semantic-summary-evaluation.md) - Validation playbook

---

## Success Criteria

### Documentation Health

- [x] No broken internal references
- [x] Single source of truth for roadmap
- [x] Clear implemented vs planned distinction
- [ ] Regular updates (monthly for near-term, quarterly for long-term)

### Feature Delivery

- **Week 1**: Documentation fixes complete
- **Week 2-3**: At least 2 quick wins deployed
- **Month 1-3**: 3+ medium-term enhancements live
- **Month 3+**: Advanced techniques evaluation underway

### Quality Metrics

- **Cost**: 50-65% savings achieved via lazy + intent routing
- **Quality**: Critic acceptance rate >90%
- **Coverage**: Citation coverage >85%
- **Reliability**: Error rate <1%, uptime >99.5%

---

## Version History

| Version | Date        | Changes                      |
| ------- | ----------- | ---------------------------- |
| 1.0     | Oct 9, 2025 | Initial consolidated roadmap |

---

## Contributing to the Roadmap

To propose new items or reprioritize:

1. Review relevant strategy documents linked above
2. Assess impact, effort, dependencies
3. Create issue with `enhancement` label
4. Link to supporting documentation
5. Update this roadmap after team approval

---

**Maintained by**: Development Team  
**Review Cycle**: Monthly (near-term), Quarterly (long-term)  
**Last Reviewed**: October 9, 2025
