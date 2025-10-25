# Google Custom Search + HyperBrowser Configuration Complete

**Date**: October 25, 2025
**Status**: ✅ Configured and Ready

---

## 🎉 Summary

Google Custom Search API and HyperBrowser have been successfully configured using gcloud CLI and are ready for use.

---

## ✅ What Was Configured

### 1. Google Custom Search API

| Component                | Status | Details                                   |
| ------------------------ | ------ | ----------------------------------------- |
| **API Enabled**          | ✅     | Custom Search API enabled via gcloud      |
| **API Key Created**      | ✅     | `AIzaSyCb4fHitCHPBItD5dd9_3ZKQ7Mzc0fHUrI` |
| **API Key Restrictions** | ✅     | Restricted to Custom Search API only      |
| **Search Engine ID**     | ⚠️     | Using test engine (see note below)        |
| **Configured in .env**   | ✅     | All credentials added                     |

**API Key Details**:

- **Display Name**: "Agentic RAG Custom Search"
- **Created**: October 25, 2025 09:22 UTC
- **Restrictions**: Custom Search API only (secure)
- **Project**: gen-lang-client-0948233079

### 2. HyperBrowser Integration

| Component              | Status | Details                            |
| ---------------------- | ------ | ---------------------------------- |
| **SDK Installed**      | ✅     | @hyperbrowser/sdk ^0.68.0          |
| **API Key**            | ✅     | `hb_bc99b6bfa2b1eef45dc9e890ee6a`  |
| **MCP Bridge**         | ✅     | Created at `/backend/mcp-tools.js` |
| **Web Search Mode**    | ✅     | Set to `hyperbrowser_scrape`       |
| **Configured in .env** | ✅     | API key and mode configured        |

**HyperBrowser Features Enabled**:

- Full page content scraping (not just snippets)
- JavaScript rendering (SPAs, dynamic content)
- Structured data extraction with schemas
- Automatic fallback to Google snippets if scraping fails

---

## ⚠️ Important: Custom Search Engine Required

### Current Status

The system is configured with Google's **test search engine** ID:

```
017576662512468239146:omuauf_lfve
```

This is a **CS Curriculum search engine** that only searches specific computer science educational sites. It will **NOT** return general web search results.

### Create Your Own Search Engine (5 minutes)

1. **Go to**: https://programmablesearchengine.google.com/
2. **Click**: "Add" or "Create"
3. **Configure**:
   - **Name**: "Agentic RAG Web Search"
   - **What to search**: **"Search the entire web"** (important!)
   - **Search settings**: Enable SafeSearch (optional)
4. **Create** and copy the **Search Engine ID**
5. **Update `.env`**:

   ```bash
   GOOGLE_SEARCH_ENGINE_ID=your-new-search-engine-id
   ```

6. **Restart backend**:
   ```bash
   cd /root/agent-rag/backend
   npm run dev
   ```

---

## 📝 Configuration Summary

### Environment Variables Set

```bash
# Google Custom Search
GOOGLE_SEARCH_API_KEY=AIzaSyCb4fHitCHPBItD5dd9_3ZKQ7Mzc0fHUrI
GOOGLE_SEARCH_ENGINE_ID=017576662512468239146:omuauf_lfve  # ⚠️ Update with your own
GOOGLE_SEARCH_ENDPOINT=https://customsearch.googleapis.com/customsearch/v1

# HyperBrowser
HYPERBROWSER_API_KEY=hb_bc99b6bfa2b1eef45dc9e890ee6a
WEB_SEARCH_MODE=hyperbrowser_scrape

# Web Search Settings
WEB_RESULTS_MAX=15
WEB_CONTEXT_MAX_TOKENS=30000
ENABLE_WEB_QUALITY_FILTER=true
```

---

## 🧪 Testing

### Test 1: Google Custom Search API (Direct)

```bash
curl "https://customsearch.googleapis.com/customsearch/v1?key=AIzaSyCb4fHitCHPBItD5dd9_3ZKQ7Mzc0fHUrI&cx=017576662512468239146:omuauf_lfve&q=test"
```

**Expected**: JSON response with search metadata
**Note**: Will return 0 results until you create your own search engine

### Test 2: Backend Web Search (After Creating Search Engine)

```bash
# Start backend
cd /root/agent-rag/backend
npm run dev

# In another terminal
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "role": "user",
      "content": "What are the latest developments in artificial intelligence?"
    }],
    "sessionId": "web-search-test"
  }' | jq '.answer'
```

**Expected**:

- Web search triggered automatically (planner detects freshness need)
- Top 3 results scraped with HyperBrowser (full content)
- Remaining results use Google snippets
- Answer synthesized with web context
- Citations include web sources

### Test 3: HyperBrowser Scraping

Check backend logs for:

```
[HyperBrowser] Scraping https://example.com...
[HyperBrowser] Scraped 2500 tokens of content
```

---

## 🔄 How It Works

### Web Search Flow

```
User asks temporal question (e.g., "What happened today in AI?")
     ↓
Planner detects freshness requirement
     ↓
Tool Dispatch → webSearchTool
     ↓
Google Custom Search → Get top URLs
     ↓
HyperBrowser Enhancement (if mode = hyperbrowser_scrape)
  ├─ Top 3 URLs → Full page scraping with JS rendering
  ├─ Convert markdown content to References
  └─ Remaining URLs → Use Google snippets
     ↓
Web Quality Filter
  ├─ Check domain authority (≥ 0.3)
  ├─ Check redundancy (≤ 0.9)
  └─ Check relevance (≥ 0.3)
     ↓
Convert to RAG References
     ↓
Synthesis with web + KB context
     ↓
Final answer with citations
```

### Fallback Behavior

If HyperBrowser fails (API error, timeout, etc.):

1. Logs warning: `"Hyperbrowser MCP not available, falling back to Google snippets"`
2. Uses Google snippets only (original behavior)
3. No errors thrown - graceful degradation

---

## 📊 Costs

### Google Custom Search

| Tier     | Queries/Month         | Cost/Month |
| -------- | --------------------- | ---------- |
| **Free** | 100/day (3,000/month) | $0         |
| **Paid** | 10,000                | $35        |
| **Paid** | 50,000                | $225       |
| **Paid** | 100,000               | $475       |

**Your Setup**: Free tier (100 queries/day)

### HyperBrowser

| Plan          | Requests/Month | Cost/Month |
| ------------- | -------------- | ---------- |
| **Developer** | 1,000          | $29        |
| **Startup**   | 10,000         | $99        |
| **Business**  | 50,000         | $299       |

**Your Setup**: Developer tier (1,000 scrapes/month)

### Combined Monthly Cost Estimate

**Scenario**: 10,000 RAG requests/month

- RAG System: ~$250-350 (with 7 optimization features)
- Google Search (50% of queries trigger web search = 5,000 searches): ~$125
- HyperBrowser (top 3 results scraped = 15,000 scrapes): ~$99-299
- **Total**: ~$474-774/month

**Cost Optimization**:

- Set `WEB_RESULTS_MAX=10` (reduce from 15)
- Only scrape top 2 results instead of 3
- Use `WEB_SEARCH_MODE=full` (Google snippets only) to disable HyperBrowser
- Set `WEB_DEFAULT_RECENCY=m` to only search recent content

---

## 🔒 Security

### API Key Protection

✅ **What's Secure**:

- API key restricted to Custom Search API only
- HyperBrowser key in `.env` (not committed to git)
- `.gitignore` excludes all `.env` files

⚠️ **Recommendations**:

1. **Rotate keys every 90 days**
2. **Use different keys for dev/prod**:

   ```bash
   # Development
   GOOGLE_SEARCH_API_KEY=dev-key-with-test-engine

   # Production
   GOOGLE_SEARCH_API_KEY=prod-key-with-production-engine
   ```

3. **Add IP restrictions** (optional):
   ```bash
   gcloud alpha services api-keys update 74dc9e03-02a3-4662-bfd2-fc3f8bfc9074 \
     --allowed-ips="YOUR_SERVER_IP"
   ```

---

## 🎯 Next Steps

### Immediate (Required)

1. **Create your own Custom Search Engine**:
   - Go to https://programmablesearchengine.google.com/
   - Create a new engine that searches "the entire web"
   - Update `GOOGLE_SEARCH_ENGINE_ID` in `.env`

2. **Test web search**:

   ```bash
   cd /root/agent-rag
   bash quick-start.sh
   # Or manually:
   # cd backend && npm run dev
   # cd frontend && npm run dev
   ```

3. **Ask a temporal question**:
   - Open http://localhost:5173
   - Ask: "What are the latest news in quantum computing?"
   - Check TelemetryDrawer → Tool tab for web search activity

### Optional (Enhancements)

1. **Tune web search settings**:

   ```bash
   # Reduce costs
   WEB_RESULTS_MAX=10  # Instead of 15
   WEB_DEFAULT_RECENCY=m  # Only last month

   # Improve quality
   WEB_MIN_AUTHORITY=0.5  # Stricter authority filter
   WEB_MIN_RELEVANCE=0.5  # Stricter relevance filter
   ```

2. **Switch to Google snippets only** (to save HyperBrowser costs):

   ```bash
   WEB_SEARCH_MODE=full  # Instead of hyperbrowser_scrape
   ```

3. **Monitor usage**:
   - Google Cloud Console → APIs & Services → Custom Search API
   - HyperBrowser Dashboard → Usage & Billing

---

## 📚 Files Created/Modified

### Created Files

1. **`/root/agent-rag/backend/mcp-tools.js`**
   - HyperBrowser MCP bridge
   - Implements `scrape_webpage` and `extract_structured_data` tools
   - Uses @hyperbrowser/sdk

2. **`/root/agent-rag/GOOGLE_HYPERBROWSER_SETUP_COMPLETE.md`** (this file)
   - Complete setup documentation
   - Testing instructions
   - Cost analysis

### Modified Files

1. **`/root/agent-rag/backend/.env`**
   - Added `GOOGLE_SEARCH_API_KEY`
   - Added `GOOGLE_SEARCH_ENGINE_ID` (test engine)
   - Added `HYPERBROWSER_API_KEY`
   - Set `WEB_SEARCH_MODE=hyperbrowser_scrape`

---

## 🐛 Troubleshooting

### Issue: "Google Search API key not configured"

**Cause**: `.env` not loaded or backend not restarted

**Fix**:

```bash
cd /root/agent-rag/backend
source .env  # Verify variables are set
npm run dev  # Restart with new config
```

### Issue: Web search returns 0 results

**Cause**: Using test search engine (CS Curriculum only)

**Fix**: Create your own search engine at https://programmablesearchengine.google.com/

### Issue: "Hyperbrowser MCP not available, falling back to Google snippets"

**Cause**: HyperBrowser SDK not installed or API key invalid

**Check**:

```bash
cd /root/agent-rag/backend
npm list @hyperbrowser/sdk  # Should show ^0.68.0
cat .env | grep HYPERBROWSER  # Verify key is set
```

**Fix**: Verify `HYPERBROWSER_API_KEY=hb_bc99b6bfa2b1eef45dc9e890ee6a` in `.env`

### Issue: High costs from HyperBrowser

**Fix**: Switch to Google snippets only:

```bash
WEB_SEARCH_MODE=full  # In .env
```

---

## ✅ Configuration Checklist

- [x] Google Custom Search API enabled
- [x] API key created with restrictions
- [x] Search Engine ID configured (⚠️ using test engine)
- [x] HyperBrowser API key configured
- [x] HyperBrowser MCP bridge created
- [x] Web search mode set to hyperbrowser_scrape
- [x] .env file updated with all credentials
- [x] Web quality filters enabled
- [ ] **Create your own Custom Search Engine** (required for production)
- [ ] Test with real temporal query
- [ ] Monitor costs and adjust settings

---

## 📞 Support & Resources

### Documentation

- [Google Custom Search API](https://developers.google.com/custom-search/v1/overview)
- [HyperBrowser SDK](https://docs.hyperbrowser.ai/)
- [HyperBrowser Pricing](https://hyperbrowser.ai/pricing)

### Code References

- **Web Search Tool**: `/root/agent-rag/backend/src/tools/webSearch.ts`
- **MCP Bridge**: `/root/agent-rag/backend/mcp-tools.js`
- **Configuration**: `/root/agent-rag/backend/src/config/app.ts`
- **Dispatch Logic**: `/root/agent-rag/backend/src/orchestrator/dispatch.ts`

---

**Status**: ✅ Configuration complete! Create your own Custom Search Engine to enable full web search functionality.
