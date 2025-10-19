# Unified Development Roadmap 2025

**Last Updated**: October 18, 2025
**Current Version**: 2.0.3
**Status**: Production-Ready with Phase 1 Complete (100%)
**Next Focus**: Phase 2 Optimizations + MCP Operational Tools

---

## Executive Summary

This unified roadmap merges **TODO Phase 2 priorities** with **Azure AI Foundry MCP integration** to maximize ROI while maintaining production stability.

### Current State (v2.0.3)

**Production Metrics**:

- ✅ 99/99 tests passing (21 test suites)
- ✅ 63-69% cost reduction vs baseline
- ✅ $150-180/month @ 10K requests (down from $490/month)
- ✅ p95 latency <5 seconds
- ✅ 30-50% hallucination reduction (CRAG)
- ✅ 30-50% fewer "I don't know" responses (adaptive retrieval)

**Phase 1 Complete** (5 major enhancements):

1. ✅ Citation Tracking - Learning loop for retrieval improvement
2. ✅ Web Quality Filtering - 30-50% better web results
3. ✅ Adaptive Query Reformulation - Quality-scored retrieval
4. ✅ Multi-Source Academic Search - 200M+ papers access (Semantic Scholar + arXiv)
5. ✅ CRAG Self-Grading - Corrective RAG with web fallback

### Strategic Direction

**Immediate Focus (Months 1-2)**: Token efficiency + operational visibility
**Medium-Term (Months 3-4)**: Model optimization + user features
**Long-Term (Months 6+)**: Advanced research techniques

**Total Potential ROI**: Additional 40-50% cost reduction ($70-150/month extra savings) on top of existing 63-69% optimization.

---

## Phase 2: Core Optimizations (Months 1-2)

**Objective**: Maximize token efficiency and reduce API costs
**Target**: Additional $70-110/month savings
**Effort**: 2-3 weeks total

### Week 1-2: Token Efficiency

#### 1. Multi-Stage Synthesis ⭐ HIGHEST IMPACT

**Priority**: HIGH
**Effort**: 5-7 days
**Expected Savings**: $50-80/month @ 10K requests
**Source**: [TODO.md:355-388](TODO.md:355-388), [azure-component-enhancements.md:36-127](azure-component-enhancements.md:36-127)

**Problem**: Current single-pass synthesis includes full documents, leading to:

- Excessive prompt tokens (full documents + irrelevant passages)
- Citation noise (hallucinated or unsupported claims)
- Lower answer precision

**Solution**: 4-stage pipeline

1. **Extract** - LLM extracts relevant snippets from each document
2. **Compress** - Build compressed context from snippets only
3. **Synthesize** - Generate answer from compressed context
4. **Refine** - Optional polish pass

**Implementation Checklist**:

- [ ] Create `backend/src/orchestrator/multiStageSynthesis.ts`
- [ ] Snippet extraction function with relevance scoring
- [ ] Compressed context builder (max 2000 tokens)
- [ ] Integration in `backend/src/orchestrator/index.ts:289-298`
- [ ] Config flag: `ENABLE_MULTI_STAGE_SYNTHESIS` (default: false)
- [ ] Telemetry: token savings per stage
- [ ] Unit tests: 8+ test cases
- [ ] Integration tests with real documents

**Expected Impact**:

- Token usage: -30-40% reduction
- Cost savings: $50-80/month
- Quality: Better citation precision
- Latency: Neutral (2 LLM calls vs 1, but smaller contexts)

**Files to Create**:

```
backend/src/orchestrator/multiStageSynthesis.ts    (200+ lines)
backend/src/tests/multiStageSynthesis.test.ts      (10+ tests)
```

**Files to Modify**:

```
backend/src/orchestrator/index.ts:289-298          (integration)
backend/src/config/app.ts                          (add config flags)
backend/.env.example                               (document new flags)
```

---

#### 2. Incremental Web Loading ⭐ HIGH IMPACT

**Priority**: HIGH
**Effort**: 3-5 days
**Expected Savings**: $20-30/month @ 10K requests
**Source**: [TODO.md:327-358](TODO.md:327-358), [azure-component-enhancements.md:1483-1646](azure-component-enhancements.md:1483-1646)

**Problem**: Current web search fetches 10 results every time, even when first 3 suffice

- Wasted API calls (Google Custom Search costs scale with result count)
- Unnecessary processing time
- Lower signal-to-noise ratio

**Solution**: Coverage-based batch expansion

1. Start with 3 results
2. Assess coverage (semantic similarity to query)
3. If coverage < threshold (default 0.7), fetch 3 more
4. Repeat until coverage met or max results (10) reached

**Implementation Checklist**:

- [ ] Create `backend/src/tools/incrementalWebSearch.ts`
- [ ] Coverage assessment function (cosine similarity-based)
- [ ] Batch loading logic with configurable sizes
- [ ] Integration in `backend/src/orchestrator/dispatch.ts:130`
- [ ] Config flags: `ENABLE_INCREMENTAL_WEB`, `WEB_COVERAGE_TARGET`, `WEB_BATCH_SIZE`
- [ ] Telemetry: batches fetched, final count, coverage achieved
- [ ] Unit tests: 6+ scenarios
- [ ] A/B testing framework

**Expected Impact**:

- Web API calls: -40-60% reduction
- Cost savings: $20-30/month
- Latency: -200-500ms (fewer fetches)
- Quality: Maintained (coverage threshold ensures sufficiency)

**Files to Create**:

```
backend/src/tools/incrementalWebSearch.ts          (150+ lines)
backend/src/tests/incrementalWebSearch.test.ts     (8+ tests)
```

**Files to Modify**:

```
backend/src/orchestrator/dispatch.ts:130           (replace webSearchTool)
backend/src/config/app.ts                          (add config flags)
```

**Validation Strategy**:

- Baseline: Measure current web API calls/query
- A/B test: 50 queries with incremental loading vs full loading
- Metrics: API calls, coverage, answer quality (critic score)

---

### Week 3-4: User-Facing Features

#### 3. Citation Export

**Priority**: MEDIUM
**Effort**: 3-4 days
**Expected Impact**: Academic workflow enablement
**Source**: [TODO.md:421-457](TODO.md:421-457), [enhancement-implementation-plan.md:375-523](enhancement-implementation-plan.md:375-523)

**Scope**: Export citations in 4 standard formats

- APA 7th edition
- MLA 9th edition
- Chicago 17th edition
- BibTeX

**Implementation Checklist**:

- [ ] Create `backend/src/services/citationFormatter.ts`
- [ ] APA formatter with hanging indent
- [ ] MLA formatter with Works Cited
- [ ] Chicago formatter with footnotes
- [ ] BibTeX formatter with entry types
- [ ] Export endpoint: `POST /citations/export`
- [ ] Frontend: Add export button to SourcesPanel
- [ ] Frontend: File download handling
- [ ] Unit tests: 4+ formatters

**Files to Create**:

```
backend/src/services/citationFormatter.ts          (200+ lines)
backend/src/routes/citations.ts                    (50+ lines)
backend/src/tests/citationFormatter.test.ts        (12+ tests)
frontend/src/components/CitationExportButton.tsx   (80+ lines)
```

**Files to Modify**:

```
frontend/src/components/SourcesPanel.tsx           (add export UI)
backend/src/server.ts                              (register route)
```

---

## Phase 3: MCP Integration - Operational Tools (Months 2-3)

**Objective**: Production monitoring and infrastructure automation
**Target**: Operational excellence + foundation for model optimization
**Effort**: 2-3 weeks total

### Week 1: Foundation & Monitoring

#### 4. MCP Client Infrastructure

**Priority**: MEDIUM
**Effort**: 2-3 days
**Expected Impact**: Enables all MCP features
**Source**: [AZURE_FOUNDRY_MCP_INTEGRATION.md:92-227](AZURE_FOUNDRY_MCP_INTEGRATION.md:92-227)

**Scope**: Core MCP client with typed wrappers

**Implementation Checklist**:

- [ ] Create `backend/src/mcp/client.ts`
- [ ] MCPClient class with JSON-RPC protocol
- [ ] Typed wrappers for knowledge tools
- [ ] Typed wrappers for evaluation tools
- [ ] Typed wrappers for model tools
- [ ] Connection management (spawn uvx process)
- [ ] Graceful shutdown handling
- [ ] Error handling and retries
- [ ] Unit tests: 6+ scenarios

**Files to Create**:

```
backend/src/mcp/client.ts                          (200+ lines)
backend/src/tests/mcp.test.ts                      (10+ tests)
```

**Configuration**:

```bash
# backend/.env
AZURE_AI_SEARCH_ENDPOINT=<existing>
AZURE_AI_SEARCH_API_KEY=<existing>
SEARCH_AUTHENTICATION_METHOD=api-search-key
```

---

#### 5. Index Health Monitoring ⭐ HIGH VALUE

**Priority**: HIGH
**Effort**: 1-2 days
**Expected Impact**: Production reliability, proactive capacity planning
**Source**: [AZURE_FOUNDRY_MCP_INTEGRATION.md:229-336](AZURE_FOUNDRY_MCP_INTEGRATION.md:229-336)

**Scope**: Automated infrastructure validation

**Implementation Checklist**:

- [ ] Startup health check (`validateSearchInfrastructure`)
- [ ] Document count monitoring
- [ ] Index existence validation
- [ ] Schema validation
- [ ] Enhanced `/health` endpoint with search diagnostics
- [ ] Telemetry integration
- [ ] Alert thresholds (index empty, schema drift)

**Files to Modify**:

```
backend/src/server.ts                              (add onReady hook)
backend/src/routes/index.ts                        (enhance /health)
```

**Expected Impact**:

- Detect index issues before user impact
- Automated schema drift detection
- Proactive capacity planning
- Improved uptime (prevent silent failures)

**Validation**:

- [ ] Startup logs show document count
- [ ] `/health` endpoint returns search service status
- [ ] Test with missing index (graceful degradation)
- [ ] Test with empty index (warning logged)

---

### Week 2: Search Statistics & Persistence

#### 6. Search Statistics Persistence

**Priority**: MEDIUM
**Effort**: 1-2 days
**Expected Impact**: Historical trending, quota monitoring
**Source**: [audit-report-corrected.md:114-171](audit-report-corrected.md:114-171)

**Problem**: Search statistics exist (`backend/src/azure/searchStats.ts`) but aren't persisted

**Solution**: SQLite-backed historical storage

**Implementation Checklist**:

- [ ] Create `backend/src/services/searchStatsStore.ts`
- [ ] SQLite schema for statistics
- [ ] Scheduled collection job (hourly)
- [ ] Historical query API: `GET /admin/search-stats/history`
- [ ] Retention policy (30 days)
- [ ] Dashboard endpoint with charts
- [ ] Unit tests: 4+ scenarios

**Files to Create**:

```
backend/src/services/searchStatsStore.ts           (150+ lines)
backend/src/tests/searchStatsStore.test.ts         (8+ tests)
```

**Schema**:

```sql
CREATE TABLE search_statistics (
  id INTEGER PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  document_count INTEGER,
  storage_mb REAL,
  index_name TEXT,
  query_count INTEGER,
  avg_latency_ms REAL
);
```

---

## Phase 4: MCP Integration - Model Optimization (Months 3-4)

**Objective**: Dynamic model selection for cost optimization
**Target**: Additional 20-40% cost savings via model routing
**Effort**: 1-2 weeks

### Month 3: Dynamic Model Discovery

#### 7. Model Catalog Integration

**Priority**: MEDIUM
**Effort**: 5-7 days
**Expected Savings**: $30-60/month @ 10K requests
**Source**: [AZURE_FOUNDRY_MCP_INTEGRATION.md:556-637](AZURE_FOUNDRY_MCP_INTEGRATION.md:556-637)

**Problem**: Fixed GPT-4o deployment for all queries, even simple FAQ

**Solution**: Dynamic model selection based on intent + complexity

- FAQ queries → Phi-4 (cheaper)
- Research queries → GPT-4o (quality)
- Conversational → GPT-3.5-turbo (fast)

**Implementation Checklist**:

- [ ] Create `backend/src/orchestrator/modelSelector.ts`
- [ ] Model catalog discovery via MCP
- [ ] Caching layer (refresh hourly)
- [ ] Cost-aware routing logic
- [ ] Intent + complexity scoring
- [ ] Quota check integration
- [ ] Config flag: `ENABLE_DYNAMIC_MODEL_SELECTION`
- [ ] Telemetry: model usage per intent
- [ ] A/B testing framework
- [ ] Unit tests: 8+ scenarios

**Files to Create**:

```
backend/src/orchestrator/modelSelector.ts          (150+ lines)
backend/src/tests/modelSelector.test.ts            (10+ tests)
```

**Files to Modify**:

```
backend/src/orchestrator/router.ts                 (add complexity scoring)
backend/src/orchestrator/index.ts                  (use modelSelector)
backend/src/config/app.ts                          (add config flags)
```

**Expected Impact**:

- Cost savings: $30-60/month (20-40% additional reduction)
- Quality: Maintained (intent-based routing ensures appropriate model)
- Latency: Improved for FAQ (smaller models faster)

**Validation Strategy**:

- Baseline: Current GPT-4o cost per intent
- A/B test: 100 queries with dynamic selection
- Metrics: Cost per query, critic acceptance rate, user satisfaction

---

## Phase 5: Optional MCP Evaluation (Month 4+)

**Objective**: Industry-standard benchmarking (optional)
**Trade-off**: +$15-25/month cost, +700ms latency (sync) or 0ms (async)

### Hybrid Evaluation System

**Priority**: LOW (optional)
**Effort**: 1 week
**Source**: [AZURE_FOUNDRY_MCP_INTEGRATION.md:338-461](AZURE_FOUNDRY_MCP_INTEGRATION.md:338-461)

**When to implement**:

- ✅ Need industry-standard metrics for research papers
- ✅ Want to compare with other systems (benchmarking)
- ✅ Require auditable evaluation for compliance
- ❌ Skip if custom critic + CRAG metrics are sufficient

**Solution**: Dual evaluation

- Custom critic (fast, always available)
- Azure AI evaluators (groundedness, relevance, fluency) in parallel

**Implementation Checklist**:

- [ ] Create `backend/src/orchestrator/azureEvaluation.ts`
- [ ] Hybrid evaluation function
- [ ] Async execution (no latency impact)
- [ ] Timeout handling (5s max)
- [ ] Config flag: `ENABLE_AZURE_AI_EVALUATION`
- [ ] Telemetry: both critic + Azure metrics
- [ ] Unit tests: 6+ scenarios

**Files to Create**:

```
backend/src/orchestrator/azureEvaluation.ts        (150+ lines)
backend/src/tests/azureEvaluation.test.ts          (8+ tests)
```

**Files to Modify**:

```
backend/src/orchestrator/index.ts:434              (use hybridEvaluation)
backend/src/config/app.ts                          (add config flags)
```

---

## Priority Matrix & Decision Framework

### Immediate Actions (Weeks 1-2)

| Action                     | Effort   | Cost Impact  | Quality Impact         | Decision  |
| -------------------------- | -------- | ------------ | ---------------------- | --------- |
| Multi-Stage Synthesis      | 5-7 days | -$50-80/mo   | Better citations       | ✅ DO NOW |
| Incremental Web Loading    | 3-5 days | -$20-30/mo   | Maintained             | ✅ DO NOW |
| Citation Export            | 3-4 days | Neutral      | Academic workflow      | ✅ DO NOW |
| **TOTAL WEEK 1-2 SAVINGS** | -        | **-$70-110** | **Improved precision** | -         |

### Short-Term (Weeks 3-4)

| Action                    | Effort   | Cost Impact | Quality Impact       | Decision   |
| ------------------------- | -------- | ----------- | -------------------- | ---------- |
| MCP Client Infrastructure | 2-3 days | Neutral     | Foundation           | ✅ DO NEXT |
| Index Health Monitoring   | 1-2 days | Neutral     | Production stability | ✅ DO NEXT |
| Search Statistics Persist | 1-2 days | Neutral     | Historical trends    | ✅ DO NEXT |
| **TOTAL WEEK 3-4 IMPACT** | -        | **Neutral** | **Ops excellence**   | -          |

### Medium-Term (Months 2-3)

| Action                      | Effort   | Cost Impact | Quality Impact | Decision       |
| --------------------------- | -------- | ----------- | -------------- | -------------- |
| Model Catalog Integration   | 5-7 days | -$30-60/mo  | Intent-based   | ⏳ AFTER PHASE |
| Azure AI Evaluation         | 1 week   | +$15-25/mo  | Benchmarking   | ⏸️ OPTIONAL    |
| **TOTAL MONTH 2-3 SAVINGS** | -        | **-$30-60** | **Optimized**  | -              |

---

## Combined Roadmap Timeline

### Month 1: Maximum ROI

**Weeks 1-2: Core Optimizations**

1. Multi-stage synthesis (5-7 days) → -$50-80/month
2. Incremental web loading (3-5 days) → -$20-30/month
3. Citation export (3-4 days) → User value

**Expected Outcome**:

- Monthly cost: $80-120 (down from $150-180)
- Total savings vs baseline: 76-84% (-$370-410/month)

### Month 2: Operational Excellence

**Weeks 3-4: MCP Monitoring**

1. MCP client infrastructure (2-3 days)
2. Index health monitoring (1-2 days)
3. Search statistics persistence (1-2 days)

**Expected Outcome**:

- Proactive issue detection
- Historical capacity planning
- Improved uptime

### Month 3: Model Optimization

**Weeks 5-7: Dynamic Routing**

1. Model catalog integration (5-7 days) → -$30-60/month
2. Intent-based model selection
3. A/B testing framework

**Expected Outcome**:

- Monthly cost: $50-90 (down from $80-120)
- Total savings vs baseline: 82-90% (-$400-440/month)

### Month 4+: Optional Enhancements

**Future Work**:

- Azure AI evaluation (if benchmarking needed)
- Advanced research techniques (Self-RAG, HyDE, RAPTOR)
- Multi-modal embeddings
- GraphRAG knowledge graphs

---

## Cost Projection Summary

### Current State (v2.0.3)

- **Monthly cost**: $150-180 @ 10K requests
- **Baseline (no optimizations)**: $490/month
- **Current savings**: 63-69% reduction

### After Phase 2 (Month 1)

- **Monthly cost**: $80-120
- **Baseline**: $490/month
- **Savings**: 76-84% reduction
- **Additional savings**: -$70-110/month

### After MCP Model Optimization (Month 3)

- **Monthly cost**: $50-90
- **Baseline**: $490/month
- **Savings**: 82-90% reduction
- **Additional savings**: -$100-150/month (cumulative)

### Net ROI

- **Total potential savings**: $400-440/month vs baseline
- **Implementation effort**: 4-5 weeks (spread over 3 months)
- **Break-even**: Immediate (savings start Week 2)

---

## Risk Assessment

### Critical Risks

| Risk                         | Impact | Probability | Mitigation                       | Rollback                  |
| ---------------------------- | ------ | ----------- | -------------------------------- | ------------------------- |
| Multi-stage overhead         | Medium | Low         | Unit tests, token budgets        | Disable feature flag      |
| Incremental web insufficient | Medium | Low         | Coverage threshold tuning        | Revert to full loading    |
| MCP connection failures      | Medium | Medium      | Graceful degradation, retries    | Skip MCP, use direct API  |
| Model selection errors       | High   | Low         | Fallback to GPT-4o, validation   | Disable dynamic selection |
| Index rebuild downtime       | Medium | N/A         | No index changes in this roadmap | N/A                       |

### Rollback Procedures

**Feature Flags** (<5 min):

```bash
# Edit backend/.env
ENABLE_MULTI_STAGE_SYNTHESIS=false
ENABLE_INCREMENTAL_WEB=false
ENABLE_DYNAMIC_MODEL_SELECTION=false

# Restart service
pm2 restart agent-rag-backend
```

**Monitoring**:

- Track critic acceptance rates (target: >90%)
- Monitor p95 latency (target: <5s)
- Watch cost per query trends
- Alert on error rate spikes (>1%)

---

## Success Metrics

### Phase 2 Success Criteria

- [ ] Monthly cost reduced by $70-110
- [ ] Critic acceptance rate maintained >90%
- [ ] p95 latency maintained <5s
- [ ] Citation precision improved (measure via telemetry)
- [ ] All tests passing (99+)

### MCP Success Criteria

- [ ] Index health checks running on startup
- [ ] Search statistics collected hourly
- [ ] Historical trends dashboard operational
- [ ] Zero production incidents from index issues

### Model Optimization Success Criteria

- [ ] $30-60/month additional savings
- [ ] Quality maintained per intent type
- [ ] Model catalog refreshed automatically
- [ ] A/B testing framework operational

---

## Implementation Guidelines

### Feature Flag Best Practices

1. All new features behind config flags (default: `false`)
2. Enable in staging first (1 week validation)
3. Enable in production with 10% traffic
4. Monitor for 48 hours before full rollout
5. Document rollback procedures

### Testing Requirements

- Unit tests: >80% coverage for new code
- Integration tests: All critical paths
- A/B testing: 50+ queries before production
- Manual testing: Sync + stream modes
- Performance testing: No latency regression

### Documentation Requirements

- Update `TODO.md` with implementation status
- Update `IMPLEMENTATION_PROGRESS.md` when complete
- Update `CHANGELOG.md` with user-facing changes
- Update `.env.example` with new config flags
- Update `ROADMAP.md` (this file) quarterly

---

## Related Documents

### Strategic Planning

- [ROADMAP.md](ROADMAP.md) - Current development roadmap
- [TODO.md](TODO.md) - Implementation task tracking
- [PRIORITIZED_ACTION_PLAN.md](PRIORITIZED_ACTION_PLAN.md) - Immediate actions

### MCP Integration

- [AZURE_FOUNDRY_MCP_INTEGRATION.md](AZURE_FOUNDRY_MCP_INTEGRATION.md) - Complete MCP plan
- [audit-report-corrected.md](audit-report-corrected.md) - API optimization opportunities

### Enhancement Details

- [azure-component-enhancements.md](azure-component-enhancements.md) - Phase 1-3 blueprints
- [enhancement-implementation-plan.md](enhancement-implementation-plan.md) - User features
- [2025-agentic-rag-techniques-deepdive.md](2025-agentic-rag-techniques-deepdive.md) - Research techniques

### Implementation Status

- [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) - Phase 1 tracking (100% complete)
- [IMPLEMENTED_VS_PLANNED.md](IMPLEMENTED_VS_PLANNED.md) - Feature inventory

---

## Next Steps

### This Week (Week of Oct 21, 2025)

1. Review this unified roadmap with team
2. Create feature branches for Phase 2 items
3. Set up A/B testing infrastructure
4. Update monitoring dashboards

### Next Week (Week of Oct 28, 2025)

1. Start multi-stage synthesis implementation
2. Start incremental web loading implementation
3. Begin MCP client development

### Month End (Nov 1, 2025)

1. Phase 2 complete and validated in staging
2. MCP monitoring tools operational
3. Cost savings measured and documented

---

**Maintained by**: Development Team
**Review Cycle**: Bi-weekly (active development), Monthly (maintenance)
**Next Review**: November 1, 2025

**Version History**:
| Version | Date | Changes |
| ------- | ------------ | -------------------------------------- |
| 1.0 | Oct 18, 2025 | Initial unified roadmap (TODO + MCP) |
