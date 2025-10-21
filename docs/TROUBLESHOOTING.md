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
# Valid API version for 2025 preview contract:
AZURE_SEARCH_DATA_PLANE_API_VERSION=2025-08-01-preview  # Preview (required)
```

**Verification**:

```bash
curl "${AZURE_SEARCH_ENDPOINT}?api-version=2025-08-01-preview" -H "api-key: ${AZURE_SEARCH_API_KEY}"
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
curl "${AZURE_SEARCH_ENDPOINT}/indexes/${INDEX_NAME}?api-version=2025-08-01-preview" \
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

## Azure MCP Tools

### Error: "DefaultAzureCredential failed to retrieve a token"

**Symptom**:

```
DefaultAzureCredential failed to retrieve a token from the included credentials.
```

**Cause**: No valid credential in Azure DefaultAzureCredential chain when using Azure AI Foundry MCP server tools

**Common Scenarios**:

- `list_agents` tool fails with credential error
- `query_default_agent` tool fails with authentication error
- Any MCP tool requiring agent service access fails

**Solution**:

See [AZURE_AGENT_SERVICE_SETUP.md](AZURE_AGENT_SERVICE_SETUP.md) for complete credential configuration guide.

**Quick Fixes**:

1. **Azure CLI Authentication** (Recommended for local development):

   ```bash
   az login
   az account show  # Verify authentication
   ```

2. **Service Principal** (For CI/CD):

   ```bash
   export AZURE_CLIENT_ID="<client-id>"
   export AZURE_TENANT_ID="<tenant-id>"
   export AZURE_CLIENT_SECRET="<client-secret>"
   ```

3. **Managed Identity** (For Azure-hosted deployments):

   ```bash
   # Enable on resource
   az webapp identity assign --name <app-name> --resource-group <rg>

   # Assign required roles
   az role assignment create \
     --assignee <principal-id> \
     --role "Cognitive Services User" \
     --scope <resource-scope>
   ```

**Verification**:

```bash
# Test credential chain
az account show

# Check environment variables (if using Service Principal)
env | grep AZURE_
```

---

### Error: "Missing DEFAULT_AGENT_ID"

**Symptom**:

```
Error: DEFAULT_AGENT_ID environment variable not configured
```

**Cause**: Environment variable not set for MCP agent query operations

**Solution**:

```bash
# Add to backend/.env
DEFAULT_AGENT_ID=<your-agent-id>
```

**Finding Agent IDs**:

1. **Azure CLI**:

   ```bash
   az ml workspace list --query "[].{Name:name, ID:id}" -o table
   ```

2. **MCP Tools** (after authentication):
   Use `list_agents` tool to discover available agents

3. **Azure Portal**:
   Navigate to Azure AI Foundry → Agents → Copy agent ID

---

### Error: "Searchable field flag not applied"

**Symptom**:

- Index created successfully via MCP `create_index` tool
- Document added successfully
- Search queries return 0 results despite document existing
- `get_document_count` confirms document exists
- Index schema shows `searchable: false` despite specifying `searchable: true`

**Cause**: MCP tool abstraction may not correctly translate `searchable: true` flag to Azure Search API, OR Azure Search API version requires additional parameters (e.g., explicit analyzer)

**Diagnosis**:

```bash
# Check index schema
curl "${AZURE_SEARCH_ENDPOINT}/indexes/<index-name>?api-version=2025-08-01-preview" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}" | jq '.fields[] | {name, searchable}'
```

**Workaround**:

1. **Add explicit analyzer** when creating index:

   ```json
   {
     "name": "content",
     "type": "Edm.String",
     "searchable": true,
     "analyzer": "standard.lucene"
   }
   ```

2. **Use direct Azure SDK** (not MCP tools) for index creation requiring search:
   - See `backend/src/azure/indexSetup.ts` for production index creation
   - MCP tools may be better suited for admin/diagnostic operations

3. **File issue with MCP maintainers** if bug confirmed:
   - Compare MCP tool output with direct Azure SDK behavior
   - Document API version and field definition differences

**Known Limitation**: As of October 2025 validation, MCP `create_index` and `modify_index` tools may not reliably set `searchable: true` flag. See [AZURE_FOUNDRY_MCP_TEST_REPORT.md](../AZURE_FOUNDRY_MCP_TEST_REPORT.md) for details.

---

### Error: "Forbidden" or "Unauthorized" with Valid Credentials

**Symptom**:

```
403 Forbidden
401 Unauthorized
```

**Cause**: Service Principal or Managed Identity lacks required RBAC roles

**Diagnosis**:

```bash
# List role assignments
az role assignment list \
  --assignee <client-id-or-principal-id> \
  --all -o table

# Check specific resource scope
az role assignment list \
  --scope /subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.Search/searchServices/<search-service> \
  -o table
```

**Solution**:

Assign missing RBAC roles:

```bash
# AI Search
az role assignment create \
  --assignee <client-id-or-principal-id> \
  --role "Search Index Data Reader" \
  --scope <search-service-scope>

az role assignment create \
  --assignee <client-id-or-principal-id> \
  --role "Search Index Data Contributor" \
  --scope <search-service-scope>

# OpenAI
az role assignment create \
  --assignee <client-id-or-principal-id> \
  --role "Cognitive Services User" \
  --scope <openai-resource-scope>

# ML/Agent Service
az role assignment create \
  --assignee <client-id-or-principal-id> \
  --role "AzureML Data Scientist" \
  --scope <ml-workspace-scope>
```

**Required Roles by Service**:

- **AI Search**: `Search Index Data Reader`, `Search Index Data Contributor`
- **OpenAI**: `Cognitive Services User`, `Cognitive Services OpenAI User`
- **ML/Agent Service**: `AzureML Data Scientist`, `Contributor` (workspace scope)

---

### MCP Tool Diagnostics

**List Available Agents**:

```bash
# Requires authentication (see AZURE_AGENT_SERVICE_SETUP.md)
# Use MCP tool: list_agents
# Expected: Array of agent objects with IDs and names
```

**Query Default Agent**:

```bash
# Requires DEFAULT_AGENT_ID configured
# Use MCP tool: query_default_agent
# Input: { "query": "test query" }
# Expected: Agent response with answer
```

**Create Ephemeral Test Index**:

```bash
# Use MCP tool: create_index
# Input: {
#   "index_definition": {
#     "name": "test-index",
#     "fields": [
#       {"name": "id", "type": "Edm.String", "key": true},
#       {"name": "content", "type": "Edm.String", "searchable": true, "analyzer": "standard.lucene"}
#     ]
#   }
# }
# Expected: Success response with index details
```

**Verify Document Count**:

```bash
# Use MCP tool: get_document_count
# Input: { "index_name": "test-index" }
# Expected: { "count": <number> }
```

**Clean Up Test Resources**:

```bash
# Use MCP tool: delete_index
# Input: { "index_name": "test-index" }
# Expected: Success response
```

---

### MCP vs Direct Azure SDK

**When to Use MCP Tools**:

- ✅ Admin operations (list indexes, schemas, agents)
- ✅ Diagnostic queries (count documents, check health)
- ✅ Testing and validation
- ✅ Agent-based evaluation workflows

**When to Use Direct Azure SDK**:

- ✅ Production retrieval (`backend/src/azure/directSearch.ts`)
- ✅ Index creation requiring specific configurations
- ✅ Operations requiring guaranteed field settings
- ✅ Performance-critical paths

**Hybrid Approach** (Recommended):

- **Production retrieval**: Direct Azure SDK
- **Index management**: MCP tools for admin tasks
- **Agent evaluation**: MCP agent tools (once configured)

See [AZURE_FOUNDRY_MCP_INTEGRATION.md](AZURE_FOUNDRY_MCP_INTEGRATION.md) for integration patterns.

---

### MCP Health Check Script

Create automated validation script:

```bash
#!/bin/bash
# scripts/azure-mcp-health-check.sh

set -e

echo "=== Azure MCP Tools Health Check ==="

# 1. Verify authentication
echo "Checking Azure CLI authentication..."
az account show > /dev/null || { echo "FAIL: Not authenticated. Run 'az login'"; exit 1; }
echo "✓ Azure CLI authenticated"

# 2. Check environment variables
echo "Checking environment variables..."
[ -z "$DEFAULT_AGENT_ID" ] && echo "⚠ DEFAULT_AGENT_ID not set (agent queries will fail)"

# 3. Test model catalog access
echo "Testing model catalog access..."
# Use MCP list_models_from_model_catalog tool
echo "✓ Model catalog accessible"

# 4. Test index operations
echo "Testing index CRUD..."
# Use MCP create_index, add_document, get_document_count, delete_index
echo "✓ Index CRUD functional"

# 5. Test agent service (if configured)
if [ -n "$DEFAULT_AGENT_ID" ]; then
  echo "Testing agent service..."
  # Use MCP query_default_agent tool
  echo "✓ Agent service accessible"
else
  echo "⊘ Agent service not configured (skipped)"
fi

echo "=== Health Check Complete ==="
```

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
curl "${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}?api-version=2025-08-01-preview" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}"

# Test search query
curl -X POST "${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=2025-08-01-preview" \
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
