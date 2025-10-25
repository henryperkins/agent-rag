# Environment Setup Guide

This guide will help you configure your `.env` file with actual Azure resource values.

## Quick Start

1. **Copy the template**: `backend/.env` already exists with placeholders
2. **Follow steps below** to replace placeholder values with your actual Azure resources
3. **Verify configuration** using the validation commands at the end

---

## Step 1: Azure AI Search Configuration

### 1.1 Find Your Search Service Endpoint

```bash
# List all search services in your subscription
az search service list --output table

# Get specific service details
az search service show \
  --name <your-search-service-name> \
  --resource-group <your-resource-group> \
  --query "{endpoint: endpoint, name: name}"
```

**Update in `.env`:**

```bash
AZURE_SEARCH_ENDPOINT=https://<your-search-service>.search.windows.net
```

### 1.2 Get API Key

```bash
# Get admin key
az search admin-key show \
  --service-name <your-search-service-name> \
  --resource-group <your-resource-group> \
  --query primaryKey -o tsv
```

**Update in `.env`:**

```bash
AZURE_SEARCH_API_KEY=<paste-key-here>
```

### 1.3 Verify Index Exists

```bash
# List all indexes
az search index list \
  --service-name <your-search-service-name> \
  --resource-group <your-resource-group> \
  --query "[].name" -o table
```

**Update in `.env`:**

```bash
AZURE_SEARCH_INDEX_NAME=<your-index-name>
```

### 1.4 Verify Index Schema

Your index MUST have these fields:

- `id` (Edm.String, key)
- `page_chunk` (Edm.String, searchable)
- `page_embedding_text_3_large` (Collection(Edm.Single), dimensions: 3072)
- `page_number` (Edm.Int32)

```bash
# Check index schema
curl "https://<your-search-service>.search.windows.net/indexes/<index-name>?api-version=2025-08-01-preview" \
  -H "api-key: <your-api-key>" | jq '.fields[] | {name, type, searchable}'
```

If your index doesn't exist, run:

```bash
cd backend
pnpm setup  # Creates index with correct schema
```

---

## Step 2: Azure OpenAI Configuration

### 2.1 Find Your OpenAI Endpoint

```bash
# List all OpenAI resources
az cognitiveservices account list \
  --query "[?kind=='OpenAI'].{name:name, endpoint:properties.endpoint}" \
  --output table
```

**Update in `.env`:**

```bash
AZURE_OPENAI_ENDPOINT=https://<your-openai-resource>.openai.azure.com
```

### 2.2 Get API Key

```bash
# Get API key
az cognitiveservices account keys list \
  --name <your-openai-resource-name> \
  --resource-group <your-resource-group> \
  --query key1 -o tsv
```

**Update in `.env`:**

```bash
AZURE_OPENAI_API_KEY=<paste-key-here>
```

### 2.3 List Your Deployments

**CRITICAL**: You must use deployment names, NOT model names.

```bash
# List all deployments
az cognitiveservices account deployment list \
  --name <your-openai-resource-name> \
  --resource-group <your-resource-group> \
  --query "[].{name:name, model:properties.model.name, capacity:sku.capacity}" \
  --output table
```

Example output:

```
Name                          Model                      Capacity
----------------------------  -------------------------  ---------
gpt-5                         gpt-5                      50
text-embedding-3-large        text-embedding-3-large     120
```

**Update in `.env`:**

```bash
# Use the "Name" column values (deployment names)
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-5
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large

# Intent routing must use a deployment name
INTENT_CLASSIFIER_MODEL=gpt-5

# Intent-specific models (customize if you have multiple GPT deployments)
MODEL_FAQ=gpt-5
MODEL_RESEARCH=gpt-5
MODEL_FACTUAL=gpt-5
MODEL_CONVERSATIONAL=gpt-5
```

### 2.4 Verify Embedding Endpoint (Optional)

If your embedding model is in a different resource:

```bash
# Get separate embedding endpoint
az cognitiveservices account show \
  --name <your-embedding-resource-name> \
  --resource-group <your-resource-group> \
  --query properties.endpoint -o tsv
```

**Update in `.env` (if different):**

```bash
AZURE_OPENAI_EMBEDDING_ENDPOINT=https://<embedding-resource>.cognitiveservices.azure.com
AZURE_OPENAI_EMBEDDING_API_KEY=<embedding-api-key>
```

---

## Step 3: Google Custom Search (Optional)

### 3.1 Create Google Custom Search Engine

1. Go to [Google Custom Search](https://programmablesearchengine.google.com/)
2. Click "Add" to create a new search engine
3. Configure search settings (web search, all sites)
4. Get your **Search Engine ID** from the control panel

### 3.2 Get API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable "Custom Search API"
3. Create credentials (API Key)
4. Copy the API key

**Update in `.env`:**

```bash
GOOGLE_SEARCH_API_KEY=<your-google-api-key>
GOOGLE_SEARCH_ENGINE_ID=<your-search-engine-id>
```

**Leave blank to disable web search:**

```bash
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=
```

---

## Step 4: CORS Configuration

### For Development

```bash
CORS_ORIGIN=http://localhost:5173,http://localhost:5174
```

### For Production

```bash
CORS_ORIGIN=https://your-domain.com,https://www.your-domain.com
```

---

## Step 5: Database Paths

Ensure the `./data` directory exists and is writable:

```bash
cd backend
mkdir -p data
chmod 755 data
```

The `.env` should have:

```bash
SESSION_DB_PATH=./data/session-store.db
SEMANTIC_MEMORY_DB_PATH=./data/semantic-memory.db
```

---

## Configuration Validation

### Test 1: Azure AI Search Connection

```bash
cd backend
source .env  # Load environment variables

# Test index access
curl "${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}?api-version=2025-08-01-preview" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}" | jq '.name'
```

Expected: Your index name printed

### Test 2: Azure OpenAI Connection

```bash
# Test GPT deployment
curl -X POST "${AZURE_OPENAI_ENDPOINT}/openai/v1/responses?api-version=preview" \
  -H "Content-Type: application/json" \
  -H "api-key: ${AZURE_OPENAI_API_KEY}" \
  -d '{
    "model":"'${AZURE_OPENAI_GPT_DEPLOYMENT}'",
    "input":[{"type":"message","role":"user","content":"test"}],
    "max_output_tokens":50
  }' | jq '.choices[0].message.content'
```

Expected: A short response from the model

### Test 3: Start Backend

```bash
cd backend
pnpm install
pnpm dev
```

Expected output:

```
Server listening at http://0.0.0.0:8787
```

### Test 4: Health Check

```bash
curl http://localhost:8787/health
```

Expected:

```json
{ "status": "healthy", "timestamp": "2025-10-25T..." }
```

### Test 5: Chat Endpoint

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages":[{"role":"user","content":"What is the Earth at Night dataset?"}],
    "sessionId":"test-session"
  }' | jq '.answer'
```

Expected: A detailed answer about the dataset

---

## Common Issues & Solutions

### Issue: "DeploymentNotFound"

**Cause**: Using model name instead of deployment name

**Fix**: Run this to get deployment names:

```bash
az cognitiveservices account deployment list \
  --name <your-openai-resource> \
  --resource-group <your-rg> \
  --output table
```

Update `.env` with the **Name** column values

### Issue: "API version does not exist"

**Cause**: Wrong `AZURE_SEARCH_DATA_PLANE_API_VERSION`

**Fix**: Use stable version:

```bash
AZURE_SEARCH_DATA_PLANE_API_VERSION=2025-09-01
```

### Issue: "Could not find property 'title'"

**Cause**: Index schema doesn't match code expectations

**Fix**: Verify your index has these fields:

```bash
curl "${AZURE_SEARCH_ENDPOINT}/indexes/${AZURE_SEARCH_INDEX_NAME}?api-version=2025-08-01-preview" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}" | jq '.fields[] | .name'
```

Expected fields: `id`, `page_chunk`, `page_embedding_text_3_large`, `page_number`

### Issue: "integer_below_min_value"

**Cause**: Token limit < 16

**Fix**: Ensure all `*_MAX_TOKENS` >= 16:

```bash
INTENT_CLASSIFIER_MAX_TOKENS=2000
MAX_TOKENS_FAQ=2000
MAX_TOKENS_RESEARCH=16000
```

---

## Production Deployment Checklist

Before deploying to production:

- [ ] All Azure resource placeholders replaced with actual values
- [ ] Deployment names (not model names) verified
- [ ] API versions set to stable releases where available
- [ ] CORS_ORIGIN configured for production domains
- [ ] Google Search configured (or explicitly disabled)
- [ ] Database paths point to persistent storage
- [ ] All validation tests passing
- [ ] Feature flags reviewed and intentionally set
- [ ] Rate limiting configured for expected traffic
- [ ] Monitoring/logging configured
- [ ] Backup strategy established for SQLite databases

---

## Next Steps

1. **Start the backend**: `cd backend && pnpm dev`
2. **Start the frontend**: `cd frontend && pnpm dev`
3. **Test the application**: Open `http://localhost:5173`
4. **Review telemetry**: Open the TelemetryDrawer in the UI
5. **Adjust feature flags**: Use FeatureTogglePanel for runtime control

---

## Additional Resources

- **Full Documentation**: `/docs/PRODUCTION_DEPLOYMENT.md`
- **Troubleshooting**: `/docs/TROUBLESHOOTING.md`
- **Architecture Overview**: `/docs/architecture-map.md`
- **Project Guide**: `/CLAUDE.md`

---

## Cost Optimization Tips

Current configuration enables **7 cost-saving features** (63-69% reduction):

1. ✅ `ENABLE_LAZY_RETRIEVAL=true` - 40-50% token savings
2. ✅ `ENABLE_INTENT_ROUTING=true` - 20-30% cost savings
3. ✅ `ENABLE_CITATION_TRACKING=true` - Learning loop
4. ✅ `ENABLE_WEB_QUALITY_FILTER=true` - Better web results
5. ✅ `ENABLE_ADAPTIVE_RETRIEVAL=true` - Fewer "I don't know"
6. ✅ `ENABLE_ACADEMIC_SEARCH=true` - 200M+ papers (free)
7. ✅ `ENABLE_CRAG=true` - Reduced hallucinations

**Expected Cost**: $250-350/month @ 10,000 requests

To reduce costs further:

- Disable `ENABLE_ADAPTIVE_RETRIEVAL` → Save $5-15/month
- Disable `ENABLE_CRAG` → Save $10-20/month
- Lower `MAX_TOKENS_RESEARCH` from 16000 to 4000 → Save 10-15%

To enable more features (if budget allows):

- `ENABLE_SEMANTIC_MEMORY=true` → +$50-100/month (long-term learning)
- `ENABLE_QUERY_DECOMPOSITION=true` → +2-3x tokens (complex questions)

---

**Need Help?**

Run the diagnostic commands in the "Configuration Validation" section and check `/docs/TROUBLESHOOTING.md` for detailed error resolution.
