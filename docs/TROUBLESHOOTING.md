# Troubleshooting Guide

**Last Updated**: October 11, 2025

---

## Configuration Issues

### Azure AI Search Errors

#### Error: "The version indicated by the api-version query string parameter does not exist"

**Symptom**:

```
Azure AI Search query failed: 400 {"error":{"message":"The version indicated by the api-version query string parameter does not exist."}}
```

**Cause**: Invalid `AZURE_SEARCH_DATA_PLANE_API_VERSION` in `.env`

**Solution**:

```bash
# Valid API versions for 2025:
AZURE_SEARCH_DATA_PLANE_API_VERSION=2025-09-01  # Stable (recommended)
AZURE_SEARCH_DATA_PLANE_API_VERSION=2025-08-01-preview  # Preview
```

**Verification**:

```bash
curl "${AZURE_SEARCH_ENDPOINT}?api-version=2025-09-01" -H "api-key: ${AZURE_SEARCH_API_KEY}"
```

---

#### Error: "Could not find a property named 'title' on type 'search.document'"

**Symptom**:

```
Invalid expression: Could not find a property named 'title' on type 'search.document'.
Parameter name: $select
```

**Cause**: Code requesting fields that don't exist in your Azure AI Search index

**Solution**:

1. Query your index schema:

```bash
curl "${AZURE_SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=2025-09-01" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}" | jq '.fields[].name'
```

2. Update `selectFields` in code to match actual schema
3. For `earth_at_night` index, only these fields exist:
   - `id` (Edm.String)
   - `page_chunk` (Edm.String)
   - `page_embedding_text_3_large` (Collection(Edm.Single))
   - `page_number` (Edm.Int32)

**Files to Check**:

- `backend/src/azure/lazyRetrieval.ts:80` - selectFields array
- `backend/src/azure/directSearch.ts:397-398` - selectFields array

**Code Fix Example**:

```typescript
// ❌ WRONG - Assumes generic fields
selectFields: ['id', 'title', 'content', 'url'];

// ✅ CORRECT - Match actual index schema
selectFields: ['id', 'page_chunk', 'page_number'];
```

---

### Azure OpenAI Errors

#### Error: "Invalid 'max_output_tokens': integer below minimum value"

**Symptom**:

```
"error": {
  "message": "Invalid 'max_output_tokens': integer below minimum value. Expected a value >= 16, but got 10 instead.",
  "type": "invalid_request_error",
  "param": "max_output_tokens",
  "code": "integer_below_min_value"
}
```

**Cause**: Token limit below Azure OpenAI minimum (16)

**Solution**:

```typescript
// In backend/src/config/app.ts:64
INTENT_CLASSIFIER_MAX_TOKENS: z.coerce.number().default(100),  // Not 10
```

**Common Locations**:

- Intent classifier: `config/app.ts:64`
- Any custom LLM calls with `max_output_tokens` parameter

**Minimum Values**:

- `max_output_tokens`: >= 16 (Azure OpenAI requirement)
- Recommended: 100-200 for structured outputs

---

#### Error: "DeploymentNotFound"

**Symptom**:

```
Azure OpenAI request failed: 404 DeploymentNotFound - {"error":{"code":"DeploymentNotFound","message":"The API deployment for this resource does not exist..."}}
```

**Cause**: Using model name instead of deployment name

**Key Distinction**:

- **Model Names** (don't use directly): `gpt-4o`, `gpt-4o-mini`, `gpt-4`
- **Deployment Names** (use these): Your custom deployment names in Azure OpenAI Studio

**Solution**:

1. List your deployments:

```bash
az cognitiveservices account deployment list \
  --name <your-openai-resource> \
  --resource-group <your-rg> \
  --query "[].{name:name,model:properties.model.name}" -o table
```

2. Update `.env` with actual deployment names:

```bash
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-5              # Your deployment name
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large  # Your embedding deployment
INTENT_CLASSIFIER_MODEL=gpt-5                   # Must match a deployment (NOT 'gpt-4o-mini')
```

**Common Mistakes**:

- ❌ `INTENT_CLASSIFIER_MODEL=gpt-4o-mini` (model name)
- ✅ `INTENT_CLASSIFIER_MODEL=gpt-5` (your actual deployment name)

**Where This Matters**:

- Intent routing: `backend/src/orchestrator/router.ts:114`
- Model selection: `backend/src/config/app.ts:63,65-68`

---

#### Error: "Invalid schema for response_format: Missing 'reasoning'"

**Symptom**:

```
"message": "Invalid schema for response_format 'intent_classification': In context=(), 'required' is required to be supplied and to be an array including every key in properties. Missing 'reasoning'."
```

**Cause**: JSON schema strict mode requires ALL properties in `required` array

**Solution**: Update schema definition to include all properties:

```typescript
// ❌ WRONG - Missing 'reasoning'
required: ['intent', 'confidence'],

// ✅ CORRECT - All properties listed
required: ['intent', 'confidence', 'reasoning'],
```

**Locations to Check**:

- Intent classification: `backend/src/orchestrator/router.ts:65`
- Planner schemas: `backend/src/orchestrator/schemas.ts`
- Critic schemas: `backend/src/orchestrator/schemas.ts`

**Rule**: When using `strict: true`, every property in `properties` MUST be in `required` array.

---

## Diagnostic Commands

### Check Backend Health

```bash
curl http://localhost:8787/health
```

**Expected Output**:

```json
{ "status": "healthy", "timestamp": "2025-10-11T05:00:00.000Z" }
```

---

### Test Chat Endpoint

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"What is the Earth at Night dataset?"}],"sessionId":"debug-test"}'
```

**Expected Output**: JSON with `answer`, `references`, `telemetry` fields

---

### Test Streaming Endpoint

```bash
curl -N -X POST http://localhost:8787/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}],"sessionId":"stream-test"}'
```

**Expected Output**: SSE events (`event: status`, `event: token`, `event: complete`)

---

### Check Telemetry

```bash
curl http://localhost:8787/admin/telemetry | jq
```

**Shows**:

- Session statistics
- Summary aggregates
- Performance metrics

---

### View Recent Logs

```bash
# All recent logs
tail -100 /tmp/backend.log

# Errors only
tail -500 /tmp/backend.log | grep -i "error\|failed\|invalid"

# Intent classification issues
tail -500 /tmp/backend.log | grep -i "intent classification"

# Azure API errors
tail -500 /tmp/backend.log | grep -i "azure.*failed"
```

---

### Verify Environment Variables

```bash
cd backend

# Check all Azure configs
grep -E "AZURE_" .env

# Check intent routing configs
grep -E "INTENT_" .env

# Check feature flags
grep -E "ENABLE_" .env
```

---

### Test Azure AI Search Connection

```bash
# Check index exists
curl "${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}?api-version=2025-09-01" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}"

# Test search query
curl -X POST "${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=2025-09-01" \
  -H "Content-Type: application/json" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}" \
  -d '{"search":"*","top":1}'
```

---

### Test Azure OpenAI Connection

```bash
# Test GPT deployment
curl -X POST "${AZURE_OPENAI_ENDPOINT}/openai/v1/responses?api-version=preview" \
  -H "Content-Type: application/json" \
  -H "api-key: ${AZURE_OPENAI_API_KEY}" \
  -d '{
    "model":"'${AZURE_OPENAI_GPT_DEPLOYMENT}'",
    "input":[{"type":"message","role":"user","content":"test"}],
    "max_output_tokens":50
  }'

# Test embedding deployment
curl -X POST "${AZURE_OPENAI_EMBEDDING_ENDPOINT}/openai/deployments/${AZURE_OPENAI_EMBEDDING_DEPLOYMENT}/embeddings?api-version=2024-02-01" \
  -H "Content-Type: application/json" \
  -H "api-key: ${AZURE_OPENAI_EMBEDDING_API_KEY}" \
  -d '{"input":"test","model":"'${AZURE_OPENAI_EMBEDDING_DEPLOYMENT}'"}'
```

---

## Common Issues & Quick Fixes

### Issue: Backend won't start

**Check**:

```bash
# Port already in use?
lsof -ti:8787

# Kill existing process
lsof -ti:8787 | xargs kill -9

# Restart
cd backend && pnpm dev
```

---

### Issue: "Cannot find module" errors

**Fix**:

```bash
# Reinstall dependencies
cd backend && pnpm install
cd ../frontend && pnpm install
cd ../shared && pnpm install
```

---

### Issue: TypeScript compilation errors

**Fix**:

```bash
# Clean build
cd backend && rm -rf dist/ && pnpm build

# Check for type errors
pnpm tsc --noEmit
```

---

### Issue: Tests failing

**Check**:

```bash
# Run all tests
cd backend && pnpm test

# Run specific test file
pnpm test features.test.ts

# Run with verbose output
pnpm test --reporter=verbose
```

---

### Issue: Frontend not connecting to backend

**Check CORS settings**:

```bash
# In backend/.env
CORS_ORIGIN=http://localhost:5173,http://localhost:5174,http://localhost:5175

# Restart backend after changing CORS
```

---

## Performance Issues

### Issue: Slow response times

**Diagnostics**:

```bash
# Check telemetry for latency breakdown
curl http://localhost:8787/admin/telemetry | jq '.sessions[] | {
  sessionId: .sessionId,
  latency: .sessionDuration,
  retrieval: .retrievalLatency,
  synthesis: .synthesisLatency
}'
```

**Common Causes**:

- High reranker threshold (increase `RERANKER_THRESHOLD` to reduce docs)
- Too many retrieval retries (adjust `CRITIC_MAX_RETRIES`)
- Large documents (enable `ENABLE_LAZY_RETRIEVAL`)

---

### Issue: High token usage / costs

**Enable cost-saving features**:

```bash
# In backend/.env
ENABLE_LAZY_RETRIEVAL=true      # 40-50% token savings
ENABLE_INTENT_ROUTING=true      # 20-30% cost savings via model selection
```

**Or use runtime toggles**: Open FeatureTogglePanel in UI and enable per-session

---

## Getting Help

### Check Documentation

- [Architecture Map](architecture-map.md) - System overview
- [Configuration Reference](../backend/.env.example) - All config options
- [Codebase Audit](CODEBASE_AUDIT_2025-10-10-REVISED.md) - Implementation details
- [TODO](TODO.md) - Known issues and planned fixes

### Enable Debug Logging

```bash
# In backend/.env
LOG_LEVEL=debug  # Default: info

# Restart backend
```

### Report Issues

If you've followed this guide and still have issues:

1. Collect logs: `tail -500 /tmp/backend.log > debug.log`
2. Check telemetry: `curl http://localhost:8787/admin/telemetry > telemetry.json`
3. Document steps to reproduce
4. Check for existing issues in project documentation

---

**Maintained by**: Development Team
**Last Review**: October 11, 2025
**Next Update**: As issues are discovered
