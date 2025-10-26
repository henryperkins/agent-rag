# Azure Resources Auto-Discovery Summary

**Date**: October 25, 2025
**Subscription**: Pay-As-You-Go (Arizona State University)
**User**: hperkin4@sundevils.asu.edu

---

## ✅ Configuration Complete

The `.env` file has been automatically configured with your Azure resources using Azure CLI.

---

## 🔍 Discovered Resources

### Azure AI Search

| Property           | Value                                  |
| ------------------ | -------------------------------------- |
| **Service Name**   | `thesearch`                            |
| **Resource Group** | `theresource`                          |
| **Location**       | East US 2                              |
| **Endpoint**       | `https://thesearch.search.windows.net` |
| **SKU**            | Standard                               |
| **Status**         | Running                                |
| **Indexes**        | None found (needs creation)            |

**API Key**: ✅ Retrieved and configured

### Azure AI Services (OpenAI)

| Property           | Value                                             |
| ------------------ | ------------------------------------------------- |
| **Service Name**   | `thefoundry`                                      |
| **Resource Group** | `theresource`                                     |
| **Location**       | East US 2                                         |
| **Kind**           | AIServices                                        |
| **Endpoint**       | `https://thefoundry.cognitiveservices.azure.com/` |

**API Key**: ✅ Retrieved and configured

### Deployed Models

| Deployment Name            | Model                  | Version    | Capacity (TPM) | Purpose               |
| -------------------------- | ---------------------- | ---------- | -------------- | --------------------- |
| **gpt-5-mini**             | gpt-5-mini             | 2025-08-07 | 200            | Main GPT (selected)   |
| **text-embedding-3-large** | text-embedding-3-large | 1          | 1000           | Embeddings (selected) |
| grok-4-fast-reasoning      | grok-4-fast-reasoning  | 1          | 50             | Available             |
| DeepSeek-V3.1              | DeepSeek-V3.1          | 1          | 20             | Available             |
| o4-mini                    | o4-mini                | 2025-04-16 | 200            | Available             |
| gpt-4.1                    | gpt-4.1                | 2025-04-14 | 50             | Available             |
| cohere-command-a           | cohere-command-a       | 1          | 1              | Available             |
| Mistral-Large-2411         | Mistral-Large-2411     | 2          | 1              | Available             |

---

## 📝 Configuration Applied to `.env`

### Core Settings

```bash
# Application
NODE_ENV=development
PORT=8787

# Azure AI Search
AZURE_SEARCH_ENDPOINT=https://thesearch.search.windows.net
AZURE_SEARCH_API_KEY=<configured>
AZURE_SEARCH_INDEX_NAME=earth_at_night

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://thefoundry.cognitiveservices.azure.com/
AZURE_OPENAI_API_KEY=<configured>
AZURE_OPENAI_GPT_DEPLOYMENT=gpt-5-mini
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-large

# Intent Routing (all using gpt-5-mini)
INTENT_CLASSIFIER_MODEL=gpt-5-mini
MODEL_FAQ=gpt-5-mini
MODEL_RESEARCH=gpt-5-mini
MODEL_FACTUAL=gpt-5-mini
MODEL_CONVERSATIONAL=gpt-5-mini
```

### Feature Flags (Production-Optimized)

✅ **Enabled by Default** (7 cost-saving features):

- `ENABLE_LAZY_RETRIEVAL=true` - 40-50% token savings
- `ENABLE_INTENT_ROUTING=true` - 20-30% cost savings
- `ENABLE_CITATION_TRACKING=true` - Learning loop
- `ENABLE_WEB_QUALITY_FILTER=true` - Better web results
- `ENABLE_ADAPTIVE_RETRIEVAL=true` - Fewer "I don't know"
- `ENABLE_ACADEMIC_SEARCH=true` - 200M+ papers (free)
- `ENABLE_CRAG=true` - Reduced hallucinations

---

## ⚠️ Required Next Steps

### 1. Create Azure AI Search Index

The search service exists but has no indexes. Create one using:

```bash
cd /root/agent-rag/backend
pnpm install
pnpm setup
```

This will create the `earth_at_night` index with the correct schema:

- `id` (Edm.String, key)
- `page_chunk` (Edm.String, searchable)
- `page_embedding_text_3_large` (Collection(Edm.Single), 3072 dimensions)
- `page_number` (Edm.Int32)

### 2. Optional: Configure Google Search

For web search capabilities, add to `.env`:

```bash
GOOGLE_SEARCH_API_KEY=<your-key>
GOOGLE_SEARCH_ENGINE_ID=<your-engine-id>
```

Get keys from:

- API Key: https://console.cloud.google.com/apis/credentials
- Search Engine: https://programmablesearchengine.google.com/

Or leave blank to disable web search.

### 3. Test the Configuration

```bash
cd /root/agent-rag/backend
pnpm dev
```

In another terminal:

```bash
curl http://localhost:8787/health
```

Expected: `{"status":"healthy","timestamp":"..."}`

---

## 🚀 Starting the Application

### Backend (Terminal 1)

```bash
cd /root/agent-rag/backend
pnpm install  # If not already done
pnpm dev      # Starts on port 8787
```

### Frontend (Terminal 2)

```bash
cd /root/agent-rag/frontend
pnpm install  # If not already done
pnpm dev      # Starts on port 5173
```

### Access

Open browser: http://localhost:5173

---

## 📊 Cost Estimate

Based on current configuration with **gpt-5-mini** and 7 enabled features:

| Scenario          | Monthly Cost | Notes                 |
| ----------------- | ------------ | --------------------- |
| Development       | $50-100      | Low traffic, testing  |
| Small Production  | $150-250     | 5,000 requests/month  |
| Medium Production | $250-350     | 10,000 requests/month |

**Savings**: 63-69% vs baseline configuration

---

## 🔒 Security Notes

- **API Keys**: Stored in `.env` file (not committed to git)
- **CORS**: Currently set to localhost (update for production)
- **Rate Limiting**: 10 requests/60s per client
- **Authentication**: Uses API keys (consider Managed Identity for production)

---

## 🎯 Model Selection Notes

### Why gpt-5-mini?

Selected as the primary deployment because:

- ✅ Good capacity (200 TPM)
- ✅ Cost-effective for development/testing
- ✅ Suitable for most RAG tasks
- ✅ Faster responses than larger models

### Alternative Deployments Available

You have these alternatives configured and can switch anytime:

| Scenario             | Recommended Model              | Update in .env                                      |
| -------------------- | ------------------------------ | --------------------------------------------------- |
| **Better reasoning** | grok-4-fast-reasoning (50 TPM) | `AZURE_OPENAI_GPT_DEPLOYMENT=grok-4-fast-reasoning` |
| **More capacity**    | o4-mini (200 TPM)              | `AZURE_OPENAI_GPT_DEPLOYMENT=o4-mini`               |
| **Latest OpenAI**    | gpt-4.1 (50 TPM)               | `AZURE_OPENAI_GPT_DEPLOYMENT=gpt-4.1`               |
| **Code-focused**     | DeepSeek-V3.1 (20 TPM)         | `AZURE_OPENAI_GPT_DEPLOYMENT=DeepSeek-V3.1`         |

To switch models, just update `.env` and restart the backend.

---

## 📚 Additional Resources

### Documentation

- **Setup Guide**: `/root/agent-rag/ENV_SETUP_GUIDE.md`
- **Project Overview**: `/root/agent-rag/CLAUDE.md`
- **Troubleshooting**: `/root/agent-rag/docs/TROUBLESHOOTING.md`
- **Production Deployment**: `/root/agent-rag/docs/PRODUCTION_DEPLOYMENT.md`

### Azure CLI Commands Reference

```bash
# List all deployments
az cognitiveservices account deployment list \
  --name thefoundry \
  --resource-group theresource \
  --output table

# Check search service status
az search service show \
  --name thesearch \
  --resource-group theresource

# View API keys
az search admin-key show \
  --service-name thesearch \
  --resource-group theresource

az cognitiveservices account keys list \
  --name thefoundry \
  --resource-group theresource
```

---

## ✅ Verification Checklist

- [x] Azure CLI authenticated
- [x] Azure AI Search service discovered
- [x] Azure OpenAI service discovered
- [x] GPT deployments found (8 available)
- [x] Embedding deployment found
- [x] API keys retrieved
- [x] `.env` file updated
- [x] Data directory created
- [ ] Index created (run `pnpm setup`)
- [ ] Backend started and tested
- [ ] Frontend started and tested

---

## 🐛 Troubleshooting

### Issue: "No index found"

**Solution**: Run index creation:

```bash
cd /root/agent-rag/backend
pnpm setup
```

### Issue: Backend won't start

**Check**:

```bash
# Verify .env is loaded
cd /root/agent-rag/backend
source .env
echo $AZURE_OPENAI_ENDPOINT

# Check for port conflicts
lsof -ti:8787 | xargs kill -9  # Kill if needed
pnpm dev
```

### Issue: "DeploymentNotFound"

**Cause**: Model name mismatch

**Solution**: Verify deployment names:

```bash
az cognitiveservices account deployment list \
  --name thefoundry \
  --resource-group theresource \
  --output table
```

Ensure `.env` uses exact deployment names.

---

## 📞 Support

For issues specific to this configuration:

1. Check the `.env` file is sourced: `source .env`
2. Review logs: `tail -100 /tmp/backend.log`
3. Verify Azure resources: Use Azure CLI commands above
4. Consult troubleshooting guide: `/docs/TROUBLESHOOTING.md`

---

**Configuration completed successfully!** 🎉

You're ready to run `pnpm setup` to create the index, then start the application.

---

## 🤖 Knowledge Agent Configuration (Added Oct 25, 2025)

### Status: ✅ Fully Configured

**Knowledge Agent**: `earth-knowledge-agent`

- Model: gpt-5-mini
- Knowledge Source: earth-at-night-ks
- Max Sub-Queries: 3
- Include Activity: Yes
- Include References: Yes

**Retrieval Strategy**: `hybrid` (knowledge agent with direct search fallback)

### What It Enables

1. **Multi-Step Agentic Retrieval**
   - Query refinement and decomposition
   - Sub-query generation (max 3)
   - Answer synthesis with citations
   - Activity tracking for observability

2. **Hybrid Fallback**
   - Tries knowledge agent first
   - Falls back to direct search on errors/zero results
   - Best of both worlds: advanced features + reliability

3. **Full Observability**
   - Correlation IDs for distributed tracing
   - Knowledge agent diagnostics in telemetry
   - Activity timeline in frontend UI
   - Request/status code tracking

### Quick Test

```bash
source backend/.env

# Test knowledge agent directly
curl -X POST "${AZURE_SEARCH_ENDPOINT}/agents('earth-knowledge-agent')/retrieve?api-version=2025-08-01-preview" \
  -H "api-key: ${AZURE_SEARCH_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "role": "user",
      "content": [{"type": "text", "text": "What are nighttime lights?"}]
    }]
  }'
```

Expected: JSON response with `response`, `references`, and `activity` fields.

### Documentation

See **KNOWLEDGE_AGENT_SETUP.md** for:

- Complete configuration details
- Retrieval strategy comparison
- Performance characteristics
- Troubleshooting guide
- Advanced tuning options

---

**Updated**: October 25, 2025
