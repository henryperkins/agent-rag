# Production Deployment Guide

**Last Updated**: 2025-10-04
**Version**: 1.0
**Target Audience**: DevOps Engineers, System Administrators, Solutions Architects

---

## Overview

This guide provides a comprehensive, step-by-step approach to deploying the Agentic RAG application to production with progressive feature enablement.

**⚠️ CRITICAL**: All advanced features are disabled by default. Follow this guide to safely enable them based on your requirements.

---

## Table of Contents

1. [Pre-Deployment (1 Week Before)](#phase-1-pre-deployment)
2. [Initial Deployment (Day 1-3)](#phase-2-initial-deployment)
3. [Progressive Enablement (Week 2+)](#phase-3-progressive-enablement)
4. [Feature Flag Decision Matrix](#feature-flag-decision-matrix)
5. [Azure Quota Requirements](#azure-quota-requirements)
6. [Monitoring Setup](#monitoring-setup)
7. [Rollback Procedures](#rollback-procedures)
8. [Performance Benchmarks](#performance-benchmarks)

---

## Phase 1: Pre-Deployment (1 Week Before)

### Step 1.1: Review Azure OpenAI Quota

**Action**: Verify your Azure OpenAI quota meets deployment needs

```bash
# Check current quota in Azure Portal:
# Azure OpenAI → Quotas and Usage → Review TPM (Tokens Per Minute)
```

**Required Quota by Configuration**:

| Configuration | GPT-4o TPM | GPT-4o-mini TPM | Embedding TPM | Est. Concurrent Users |
|--------------|------------|-----------------|---------------|----------------------|
| Minimal      | 30,000     | 10,000          | 50,000        | 10-20                |
| Balanced     | 60,000     | 20,000          | 100,000       | 30-50                |
| Full         | 120,000    | 40,000          | 200,000       | 60-100               |

**Checklist**:
- [ ] Current GPT-4o quota ≥ required TPM
- [ ] Current GPT-4o-mini quota ≥ required TPM (if using intent routing)
- [ ] Current embedding quota ≥ required TPM (if using semantic memory/summary)
- [ ] Quota increase request submitted if needed (allow 2-3 business days)

---

### Step 1.2: Choose Feature Flag Configuration

Use the [Feature Flag Decision Matrix](#feature-flag-decision-matrix) below to select your configuration.

**Recommended Starting Point**: **MINIMAL** for first deployment

**Checklist**:
- [ ] Configuration chosen (Minimal/Balanced/Full)
- [ ] Cost estimates reviewed and approved
- [ ] Budget alerts configured in Azure
- [ ] Team trained on selected features

---

### Step 1.3: Test in Staging Environment

**Action**: Deploy selected configuration to staging and validate

```bash
# Staging environment .env setup
cp backend/.env.example backend/.env

# Edit .env with staging credentials
nano backend/.env

# Apply your chosen configuration flags
# The critic review loop is always on; there is no ENABLE_CRITIC toggle.
# Example for MINIMAL (critic loop is always enabled):
ENABLE_INTENT_ROUTING=true
ENABLE_LAZY_RETRIEVAL=true
```

**Test Scenarios**:

1. **Simple FAQ Query** (tests basic retrieval)
   - "What is Azure AI Search?"
   - Expected: Fast response, citations present

2. **Research Query** (tests multi-source retrieval)
   - "Compare Azure AI Search with Elasticsearch for semantic search"
   - Expected: Citations from Azure + Web (if enabled)

3. **Long Conversation** (tests context management)
   - 10+ turn conversation
   - Expected: Maintains context, no token overflow errors

4. **Error Handling** (tests resilience)
   - Invalid input, missing citations
   - Expected: Graceful error messages, no crashes

**Checklist**:
- [ ] All test scenarios passing
- [ ] Response times < 5 seconds (p95)
- [ ] Error rate < 1%
- [ ] Cost per request within estimates
- [ ] Logs showing correct feature flag behavior

---

### Step 1.4: Establish Baseline Metrics

**Action**: Collect baseline metrics before production deployment

**Metrics to Track**:
- Response latency (p50, p95, p99)
- Token usage per request (input + output)
- Cost per 1000 requests
- Critic acceptance rate
- Error rate by type

**Tools**:
- Azure Application Insights
- OpenTelemetry traces
- Backend telemetry endpoint: `GET /admin/telemetry`

**Checklist**:
- [ ] Baseline latency documented
- [ ] Baseline cost/request documented
- [ ] Baseline quality metrics documented
- [ ] Monitoring dashboards created
- [ ] Alert thresholds defined

---

### Step 1.5: Configure Monitoring and Alerts

**Azure Monitor Alerts**:

1. **Cost Alert**
   ```
   Metric: Azure OpenAI Total Cost
   Threshold: $X per day (based on budget)
   Action: Email to ops team
   ```

2. **Quota Alert**
   ```
   Metric: Token Usage (% of quota)
   Threshold: > 80% of TPM limit
   Action: Email + SMS
   ```

3. **Error Rate Alert**
   ```
   Metric: HTTP 5xx responses
   Threshold: > 5% over 5 minutes
   Action: PagerDuty/Email
   ```

4. **Latency Alert**
   ```
   Metric: Response time p95
   Threshold: > 10 seconds
   Action: Email to ops team
   ```

**Application Insights Queries**:

```kusto
// Token usage over time
customMetrics
| where name == "tokens_total"
| summarize avg(value) by bin(timestamp, 1h)

// Cost per request
customMetrics
| where name == "cost_per_request"
| summarize percentiles(value, 50, 95, 99) by bin(timestamp, 1h)

// Feature flag usage
customEvents
| where name == "feature_flag_check"
| summarize count() by tostring(customDimensions.flag), tostring(customDimensions.enabled)
```

**Checklist**:
- [ ] Cost alerts configured
- [ ] Quota alerts configured
- [ ] Error rate alerts configured
- [ ] Latency alerts configured
- [ ] Dashboard created with key metrics
- [ ] On-call rotation defined

---

## Phase 2: Initial Deployment (Day 1-3)

### Step 2.1: Deploy with MINIMAL Configuration

**Production .env Configuration**:

```bash
# =============================================================================
# MINIMAL PRODUCTION CONFIGURATION
# =============================================================================

# Core Settings (REQUIRED)
NODE_ENV=production
PORT=8787
LOG_LEVEL=warn

# Azure AI Search (REQUIRED)
AZURE_SEARCH_ENDPOINT=https://your-prod-search.search.windows.net
AZURE_SEARCH_API_KEY=your-production-key
AZURE_SEARCH_INDEX_NAME=your-prod-index

# Azure OpenAI (REQUIRED)
AZURE_OPENAI_ENDPOINT=https://your-prod-openai.openai.azure.com
AZURE_OPENAI_API_KEY=your-production-key
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-4o
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large

# Google Search (OPTIONAL - can be blank)
GOOGLE_SEARCH_API_KEY=your-google-key-or-blank
GOOGLE_SEARCH_ENGINE_ID=your-engine-id-or-blank

# MINIMAL Feature Flags (Cost-Optimized)
ENABLE_CRITIC=true                    # Quality assurance (RECOMMENDED)
ENABLE_INTENT_ROUTING=true            # Saves 20-30% cost
ENABLE_LAZY_RETRIEVAL=true            # Saves 40-50% retrieval tokens

# All other flags: false (disabled)
ENABLE_SEMANTIC_SUMMARY=false
ENABLE_WEB_RERANKING=false
ENABLE_QUERY_DECOMPOSITION=false
ENABLE_SEMANTIC_MEMORY=false
ENABLE_SEMANTIC_BOOST=false

# Security
RATE_LIMIT_MAX_REQUESTS=10
REQUEST_TIMEOUT_MS=30000
CORS_ORIGIN=https://your-production-domain.com
```

**Deployment Steps**:

```bash
# 1. Build backend
cd backend
pnpm install --prod
pnpm build

# 2. Build frontend
cd ../frontend
pnpm install --prod
pnpm build

# 3. Start services (example with PM2)
pm2 start backend/dist/server.js --name agentic-rag-backend
pm2 serve frontend/dist 5173 --name agentic-rag-frontend

# 4. Verify health
curl http://localhost:8787/health
```

**Checklist**:
- [ ] Production .env configured with MINIMAL flags
- [ ] Backend built and started
- [ ] Frontend built and started
- [ ] Health check passing
- [ ] SSL/TLS configured
- [ ] Domain DNS configured

---

### Step 2.2: Monitor for 72 Hours

**Daily Checks** (3 days):

**Day 1 Checklist**:
- [ ] No critical errors in logs
- [ ] Response times within baseline
- [ ] Cost tracking shows expected spend
- [ ] All requests getting responses
- [ ] Critic loop functioning (check telemetry)

**Day 2 Checklist**:
- [ ] Cost trend aligns with projections
- [ ] No memory leaks (check memory usage)
- [ ] Feature flags behaving correctly (check logs)
- [ ] User feedback positive
- [ ] No quota exhaustion

**Day 3 Checklist**:
- [ ] 72-hour cost total within 10% of estimate
- [ ] Error rate < 1%
- [ ] p95 latency < 5 seconds
- [ ] No production incidents
- [ ] Ready to proceed to Phase 3

---

### Step 2.3: Validate Cost Projections

**Cost Validation Formula**:

```
Actual Cost = (GPT-4 input tokens × $0.01/1k) +
              (GPT-4 output tokens × $0.03/1k) +
              (Embeddings × $0.0001/1k)

Expected Daily Cost (MINIMAL):
  - 1000 requests/day
  - Avg 2000 tokens/request (input + output)
  - = ~$40-60/day = $1,200-1,800/month
```

**If costs are higher than expected**:
1. Check if `ENABLE_QUERY_DECOMPOSITION` accidentally enabled
2. Review query complexity (long questions increase tokens)
3. Check if `CRITIC_MAX_RETRIES` is too high
4. Verify lazy retrieval is working (summaries loaded first)

**Checklist**:
- [ ] Daily cost within 20% of projection
- [ ] Token usage per request documented
- [ ] No unexpected API calls
- [ ] Cost trend is linear (not exponential)

---

### Step 2.4: Verify Error Rates

**Acceptable Error Rates**:
- Total errors: < 1%
- 5xx errors: < 0.5%
- Timeout errors: < 0.1%
- Critic failures: < 5% (can increase threshold)

**Common Errors to Monitor**:
```bash
# Check error logs
pm2 logs agentic-rag-backend --lines 100 | grep ERROR

# Expected errors (acceptable):
- "Critic evaluation failed; defaulting to accept" (< 5%)
- "Web search unavailable, skipping" (if Google API not configured)

# Unexpected errors (investigate):
- "Azure OpenAI quota exceeded"
- "better-sqlite3 error" (if semantic memory enabled)
- "Timeout waiting for response"
```

**Checklist**:
- [ ] Error rate < 1%
- [ ] No quota exhaustion errors
- [ ] No database errors
- [ ] No timeout errors
- [ ] Error logs reviewed and categorized

---

## Phase 3: Progressive Enablement (Week 2+)

**⚠️ IMPORTANT**: Only proceed if Phase 2 validation passed

### Week 2: Enable Quality Features

**Add to existing configuration**:
```bash
# Keep Week 1 settings:
ENABLE_CRITIC=true
ENABLE_INTENT_ROUTING=true
ENABLE_LAZY_RETRIEVAL=true

# Add Week 2 features:
ENABLE_WEB_RERANKING=true       # Better multi-source results
ENABLE_SEMANTIC_SUMMARY=true    # Improved context selection
```

**Estimated Cost Impact**: +$100-150/month

**Monitor for 72 hours**:
- [ ] Cost increase aligns with estimates (+$3-5/day)
- [ ] Result quality improved (check critic scores)
- [ ] Citation accuracy maintained
- [ ] Web search results properly ranked
- [ ] No performance degradation

**Rollback if**:
- Cost spike > 30% over estimate
- Error rate increases > 2%
- User complaints about quality decrease

---

### Week 3: Enable Advanced Features

**Add to existing configuration**:
```bash
# Keep Week 1+2 settings, add:
ENABLE_QUERY_DECOMPOSITION=true # Complex query support
ENABLE_SEMANTIC_MEMORY=true     # Persistent memory
```

**Prerequisites**:
```bash
# For SEMANTIC_MEMORY, ensure:
cd backend
pnpm rebuild better-sqlite3
mkdir -p data
```

**Estimated Cost Impact**: +$150-250/month (highly variable by usage)

**Monitor for 72 hours**:
- [ ] Complex queries handled correctly
- [ ] Sub-query execution works (check telemetry)
- [ ] Memory recall functioning (check logs)
- [ ] SQLite database growing (check disk space)
- [ ] Token usage spikes on complex queries acceptable

**Monitor Closely**:
- Query decomposition can increase tokens 2-3x on complex queries
- Set `DECOMPOSITION_MAX_SUBQUERIES=4` initially (default is 8)
- Monitor disk space for semantic memory database

**Rollback if**:
- Cost spike > 50% over estimate
- Token usage becomes unpredictable
- Database errors or corruption
- Disk space issues

---

## Feature Flag Decision Matrix

### When to Use Each Configuration

| Scenario | Recommended Config | Key Flags | Est. Monthly Cost |
|----------|-------------------|-----------|-------------------|
| **Development/Testing** | MINIMAL | CRITIC + INTENT_ROUTING + LAZY_RETRIEVAL | $200-300 |
| **Production - Budget-Conscious** | MINIMAL | Same as above | $300-500 |
| **Production - Standard** | BALANCED | Add WEB_RERANKING + SEMANTIC_SUMMARY | $500-700 |
| **Production - Enterprise** | FULL | All flags enabled | $800-1200 |
| **High Query Volume** | MINIMAL | Focus on cost optimizations | $400-600 |
| **Complex Research Tool** | FULL | Need query decomposition | $900-1400 |
| **Long Conversations** | BALANCED | Semantic summary helps | $600-900 |
| **Multi-Source Research** | BALANCED | Web reranking essential | $500-800 |

---

## Azure Quota Requirements

### Minimal Configuration

```
GPT-4o Deployment:
  - Tokens Per Minute (TPM): 30,000
  - Requests Per Minute (RPM): 180

GPT-4o-mini Deployment (for intent routing):
  - TPM: 10,000
  - RPM: 60

Text-Embedding-3-Large:
  - TPM: 50,000
  - RPM: 300
```

**Calculation**:
```
Concurrent Users: 10-20
Avg Request: 2000 tokens (input + output)
Requests/min: ~30
= 30 requests × 2000 tokens = 60,000 tokens/min

With INTENT_ROUTING enabled:
  - 60% routed to GPT-4o-mini (cheaper)
  - 40% to GPT-4o
  = ~24,000 TPM on GPT-4o
  = ~36,000 TPM on GPT-4o-mini
```

---

### Balanced Configuration

```
GPT-4o: 60,000 TPM
GPT-4o-mini: 20,000 TPM
Embeddings: 100,000 TPM (semantic summary adds embedding calls)
```

**Concurrent Users**: 30-50

---

### Full Configuration

```
GPT-4o: 120,000 TPM
GPT-4o-mini: 40,000 TPM
Embeddings: 200,000 TPM (semantic memory + summary = high usage)
```

**Concurrent Users**: 60-100

**Note**: Query decomposition can spike token usage unpredictably. Consider higher quota or hard limits.

---

## Monitoring Setup

### Required Dashboards

**1. Cost Dashboard**
- Daily spend trend
- Cost per 1000 requests
- Cost breakdown by model (GPT-4o vs mini vs embeddings)
- Projected monthly spend

**2. Performance Dashboard**
- Response latency (p50, p95, p99)
- Requests per minute
- Error rate by type
- Concurrent users

**3. Quality Dashboard**
- Critic acceptance rate
- Coverage scores
- Grounding verification rate
- Citation accuracy (manual sampling)

**4. Feature Flag Dashboard**
- Requests by enabled flags
- Cost impact per flag
- Error rate by flag combination
- Feature usage trends

### Log Aggregation

**Required Log Queries**:

```bash
# Feature flag effectiveness
grep "ENABLE_INTENT_ROUTING.*true" logs/*.log | wc -l

# Cost savings from lazy retrieval
grep "lazy_summary_tokens" logs/*.log | awk '{sum+=$NF} END {print sum}'

# Query decomposition usage
grep "decomposition" logs/*.log | grep "complexity" | awk '{print $5}'
```

---

## Rollback Procedures

### Emergency Rollback (< 5 minutes)

**Scenario**: Critical production issue, need immediate rollback

```bash
# 1. SSH to production server
ssh production-server

# 2. Edit .env and disable problem flag
nano backend/.env
# Set problematic flag to false

# 3. Restart backend (no rebuild needed)
pm2 restart agentic-rag-backend

# 4. Verify health
curl http://localhost:8787/health

# 5. Monitor logs for 5 minutes
pm2 logs agentic-rag-backend --lines 50
```

**Checklist**:
- [ ] Problem flag identified and disabled
- [ ] Service restarted successfully
- [ ] Health check passing
- [ ] Error rate returning to normal
- [ ] Incident documented

---

### Planned Rollback (30 minutes)

**Scenario**: Feature not performing as expected, planned removal

```bash
# 1. Announce maintenance window

# 2. Create backup of current configuration
cp backend/.env backend/.env.backup.$(date +%Y%m%d)

# 3. Update .env with desired flags
nano backend/.env

# 4. For SEMANTIC_MEMORY, backup database
cp data/semantic-memory.db data/semantic-memory.db.backup

# 5. Rebuild and restart
cd backend
pnpm build
pm2 restart agentic-rag-backend

# 6. Run smoke tests
./scripts/smoke-test.sh

# 7. Monitor for 1 hour
```

**Checklist**:
- [ ] Backup created
- [ ] Configuration updated
- [ ] Service restarted
- [ ] Smoke tests passing
- [ ] Monitoring shows expected behavior
- [ ] Documentation updated

---

### Flag-Specific Rollback Notes

**ENABLE_SEMANTIC_MEMORY**:
```bash
# Rollback process:
1. Set ENABLE_SEMANTIC_MEMORY=false
2. Restart service
3. Database remains but is not accessed
4. To fully remove:
   rm -rf data/semantic-memory.db
```

**ENABLE_QUERY_DECOMPOSITION**:
```bash
# Rollback process:
1. Set ENABLE_QUERY_DECOMPOSITION=false
2. Restart service
3. Complex queries will use standard retrieval
4. No data loss, immediate effect
```

**ENABLE_WEB_RERANKING**:
```bash
# Rollback process:
1. Set ENABLE_WEB_RERANKING=false
2. Restart service
3. Results will show separate Azure/Web sections
4. No impact on existing data
```

---

## Performance Benchmarks

### Expected Latency (p95)

| Configuration | Simple Query | Research Query | Complex Query (Decomposed) |
|--------------|--------------|----------------|----------------------------|
| MINIMAL      | 2-3s         | 3-5s           | N/A                        |
| BALANCED     | 2-4s         | 4-6s           | N/A                        |
| FULL         | 3-5s         | 5-8s           | 8-15s                      |

**Factors affecting latency**:
- Query complexity
- Number of retrieval sources
- Critic revision loops
- Network latency to Azure

---

### Expected Token Usage

| Configuration | Tokens/Request (avg) | Cost/Request |
|--------------|----------------------|--------------|
| MINIMAL      | 1,500-2,500          | $0.04-0.06   |
| BALANCED     | 2,000-3,500          | $0.05-0.08   |
| FULL         | 3,000-7,000          | $0.08-0.18   |

**Note**: Query decomposition can spike to 15,000+ tokens for very complex queries

---

### Expected Quality Metrics

| Metric | MINIMAL | BALANCED | FULL |
|--------|---------|----------|------|
| Critic Acceptance Rate | 85-90% | 90-95% | 95-98% |
| Citation Coverage | 70-80% | 80-90% | 85-95% |
| Grounding Verification | 80-85% | 85-92% | 90-95% |
| User Satisfaction | 7.5/10 | 8.5/10 | 9/10 |

---

## Troubleshooting

### Issue: Higher costs than expected

**Diagnosis**:
```bash
# Check which flags are enabled
grep "^ENABLE_" backend/.env

# Check average tokens per request
curl http://localhost:8787/admin/telemetry | jq '.tokens_avg'

# Check query decomposition usage
grep "decomposition" logs/*.log | wc -l
```

**Solution**:
1. Disable `QUERY_DECOMPOSITION` if enabled
2. Reduce `CRITIC_MAX_RETRIES` from 2 to 1
3. Verify `LAZY_RETRIEVAL` is actually working (check logs)
4. Check if queries are unusually long/complex

---

### Issue: Slow response times

**Diagnosis**:
```bash
# Check p95 latency
curl http://localhost:8787/admin/telemetry | jq '.latency_p95'

# Check for query decomposition
grep "executing_subqueries" logs/*.log
```

**Solution**:
1. Reduce `DECOMPOSITION_MAX_SUBQUERIES` from 8 to 4
2. Increase Azure OpenAI quota if throttled
3. Check network latency to Azure
4. Reduce `WEB_RESULTS_MAX` from 6 to 3

---

### Issue: Quality regression

**Diagnosis**:
```bash
# Check critic scores
curl http://localhost:8787/admin/telemetry | jq '.critic_coverage_avg'
```

**Solution**:
1. Ensure `ENABLE_CRITIC=true`
2. Increase `CRITIC_THRESHOLD` from 0.75 to 0.85
3. Enable `SEMANTIC_SUMMARY` for better context
4. Check if retrieval is returning relevant results

---

## Support and Resources

- **Documentation**: `docs/` directory
- **Feature Flags Guide**: `README.md` → Feature Flags section
- **Cost Analysis**: `docs/COST_OPTIMIZATION.md`
- **Code Reference**: `backend/src/config/app.ts` (all flags defined)

---

**Document Version**: 1.0
**Last Updated**: 2025-10-04
**Next Review**: Monthly or after major feature changes
