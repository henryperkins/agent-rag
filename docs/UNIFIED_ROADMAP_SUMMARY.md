# Unified Roadmap Summary

**Created**: October 18, 2025
**Source Document**: [UNIFIED_ROADMAP_2025.md](UNIFIED_ROADMAP_2025.md)

---

## What This Document Does

The **UNIFIED_ROADMAP_2025.md** merges priorities from three key planning documents:

1. **TODO.md Phase 2** - Token optimization and user features
2. **AZURE_FOUNDRY_MCP_INTEGRATION.md** - Operational monitoring and model optimization
3. **audit-report-corrected.md** - Quick wins and API enhancements

It provides a **sequenced implementation plan** that maximizes ROI while maintaining production stability.

---

## Key Strategic Decisions

### 1. Prioritize TODO Phase 2 First (Month 1)

**Why:**

- Highest immediate cost savings: $70-110/month
- Builds on proven Phase 1 success (63-69% reduction achieved)
- No new infrastructure dependencies

**What:**

- Multi-stage synthesis (5-7 days) → -$50-80/month
- Incremental web loading (3-5 days) → -$20-30/month
- Citation export (3-4 days) → User value

**Result:** 76-84% total cost reduction vs baseline

---

### 2. Add MCP Monitoring Tools Second (Month 2)

**Why:**

- Operational excellence (index health, diagnostics)
- Foundation for Phase 3 model optimization
- No cost increase, only reliability gains

**What:**

- MCP client infrastructure (2-3 days)
- Index health monitoring (1-2 days)
- Search statistics persistence (1-2 days)

**Result:** Production monitoring + proactive capacity planning

---

### 3. Model Optimization Third (Month 3)

**Why:**

- Requires MCP infrastructure from Month 2
- Additional 20-40% savings on top of Phase 2
- Lower priority than token efficiency

**What:**

- Dynamic model discovery (5-7 days) → -$30-60/month
- Intent-based model routing (FAQ→Phi-4, Research→GPT-4o)

**Result:** 82-90% total cost reduction vs baseline

---

### 4. Skip or Defer MCP Evaluation

**Why:**

- Custom critic + CRAG already work well
- Adds $15-25/month cost
- Adds 700ms latency (unless async)
- Only needed for benchmarking/compliance

**When to implement:**

- Need industry-standard metrics for research papers
- Want to compare with other RAG systems
- Require auditable evaluation for compliance

---

## ROI Breakdown

### Current State (v2.0.3)

```
Monthly Cost:  $150-180 @ 10K requests
Baseline:      $490/month
Savings:       63-69% reduction
```

### After Phase 2 (Month 1)

```
Monthly Cost:  $80-120
Additional:    -$70-110/month
Total Savings: 76-84% vs baseline
```

### After MCP Optimization (Month 3)

```
Monthly Cost:  $50-90
Additional:    -$100-150/month (cumulative)
Total Savings: 82-90% vs baseline
```

### Net Impact

- **Total potential savings**: $400-440/month vs baseline
- **Break-even**: Immediate (savings start Week 2)
- **Implementation effort**: 4-5 weeks (spread over 3 months)

---

## Timeline At-a-Glance

```
Month 1: Core Optimizations
├─ Week 1-2: Multi-stage synthesis + Incremental web loading
└─ Week 3-4: Citation export (user feature)
   Expected: -$70-110/month savings

Month 2: Operational Tools
├─ Week 1: MCP client + index monitoring
└─ Week 2: Search statistics persistence
   Expected: Production stability, no cost change

Month 3: Model Optimization
├─ Week 1-2: Model catalog + dynamic routing
└─ Week 3-4: A/B testing validation
   Expected: -$30-60/month additional savings

Month 4+: Optional
└─ MCP evaluation (only if benchmarking needed)
   Expected: +$15-25/month cost (skip unless required)
```

---

## Implementation Priorities

### ✅ DO NOW (Weeks 1-2)

1. Multi-stage synthesis
2. Incremental web loading
3. Citation export

### ✅ DO NEXT (Weeks 3-4)

4. MCP client infrastructure
5. Index health monitoring
6. Search statistics persistence

### ⏳ AFTER PHASE 2 (Month 3)

7. Model catalog integration
8. Dynamic model selection

### ⏸️ OPTIONAL (Month 4+)

9. Azure AI evaluation (only if needed for benchmarking)

---

## Key Trade-offs Analyzed

### Multi-Stage Synthesis vs Single-Pass

- **Trade-off**: 2 LLM calls vs 1, but smaller contexts
- **Decision**: DO IT - Token savings (30-40%) outweigh extra call
- **Validation**: Unit tests + telemetry comparison

### Incremental Web Loading vs Full Fetch

- **Trade-off**: Multiple small requests vs one large request
- **Decision**: DO IT - API cost savings (40-60%) justified
- **Validation**: A/B testing with coverage threshold tuning

### MCP Evaluation vs Custom Critic

- **Trade-off**: Industry metrics vs current proven system
- **Decision**: SKIP - Custom critic + CRAG sufficient
- **Exception**: Implement if benchmarking/compliance required

### Dynamic Model Selection vs Fixed GPT-4o

- **Trade-off**: Complexity vs cost savings (20-40%)
- **Decision**: DO IT (Month 3) - After token optimizations stable
- **Validation**: Intent-based A/B testing, quality monitoring

---

## Success Criteria

### Phase 2 (Month 1)

- [ ] Monthly cost reduced by $70-110
- [ ] Critic acceptance rate maintained >90%
- [ ] p95 latency maintained <5s
- [ ] All tests passing (99+)

### MCP Monitoring (Month 2)

- [ ] Index health checks running on startup
- [ ] Search statistics collected hourly
- [ ] Zero production incidents from index issues
- [ ] Historical trends dashboard operational

### Model Optimization (Month 3)

- [ ] $30-60/month additional savings
- [ ] Quality maintained per intent type
- [ ] Model catalog refreshed automatically
- [ ] A/B testing framework operational

---

## Risk Mitigation

### Immediate Rollback Available

All features behind config flags (default: `false`):

```bash
# Edit backend/.env
ENABLE_MULTI_STAGE_SYNTHESIS=false
ENABLE_INCREMENTAL_WEB=false
ENABLE_DYNAMIC_MODEL_SELECTION=false

# Restart service
pm2 restart agent-rag-backend
```

### Monitoring Alerts

- Critic acceptance rate <90%
- p95 latency >5s
- Cost per query spike >20%
- Error rate >1%

---

## Why This Sequence?

### Alternative 1: MCP First

**Problem:** Lower immediate ROI, infrastructure before use case
**Comparison:** Month 1 savings = $0 vs $70-110

### Alternative 2: Do Everything in Parallel

**Problem:** High risk, difficult to isolate issues, team overload
**Comparison:** 4-5 weeks concurrent vs 4-5 weeks sequential (same timeline, higher risk)

### Chosen: TODO Phase 2 → MCP Monitoring → Model Optimization

**Why:**

1. **Month 1**: Maximize immediate ROI ($70-110 savings)
2. **Month 2**: Build ops foundation while Phase 2 stabilizes
3. **Month 3**: Stack model optimization on proven base

**Result:** Progressive risk reduction + compounding cost savings

---

## Next Actions

### This Week (Week of Oct 21, 2025)

1. [ ] Review unified roadmap with team
2. [ ] Create feature branches for Phase 2 items
3. [ ] Set up A/B testing infrastructure
4. [ ] Update monitoring dashboards

### Next Week (Week of Oct 28, 2025)

1. [ ] Start multi-stage synthesis implementation
2. [ ] Start incremental web loading implementation
3. [ ] Begin MCP client development (parallel)

### Month End (Nov 1, 2025)

1. [ ] Phase 2 complete and validated in staging
2. [ ] MCP monitoring tools operational
3. [ ] Cost savings measured and documented

---

## Related Documents

- **[UNIFIED_ROADMAP_2025.md](UNIFIED_ROADMAP_2025.md)** - Complete implementation plan
- [TODO.md](TODO.md) - Phase 1 complete (100%), Phase 2 pending
- [AZURE_FOUNDRY_MCP_INTEGRATION.md](AZURE_FOUNDRY_MCP_INTEGRATION.md) - MCP 48-tool integration
- [audit-report-corrected.md](audit-report-corrected.md) - API optimization opportunities

---

**Maintained by**: Development Team
**Review Date**: November 1, 2025
