# Web Search Configuration Guide

**Date**: October 25, 2025
**Status**: ⚠️ Partially Configured

---

## 📊 Current Status

### Google Custom Search

- **Status**: ❌ NOT CONFIGURED
- **API Key**: Not set
- **Engine ID**: Not set
- **Required**: Yes (for any web search functionality)

### HyperBrowser

- **Status**: ⚠️ SDK Installed, MCP Integration Required
- **SDK Version**: @hyperbrowser/sdk ^0.68.0
- **MCP Tools**: Not configured
- **Required**: No (optional enhancement for web scraping)

### Web Search Mode

- **Current Mode**: `full` (Google snippets only)
- **Available Modes**:
  - `summary` - Snippets only (minimal)
  - `full` - Full snippets (current)
  - `hyperbrowser_scrape` - Full page scraping (requires HyperBrowser MCP)
  - `hyperbrowser_extract` - Structured data extraction (requires HyperBrowser MCP)

---

## 🔧 Google Custom Search Setup

Google Custom Search is **required** for web search functionality. Without it, web search will fail.

### Step 1: Create Google Custom Search Engine

1. **Go to**: https://programmablesearchengine.google.com/
2. **Click**: "Add" or "Create"
3. **Configure**:
   - **Search engine name**: "Agentic RAG Web Search" (or your choice)
   - **What to search**:
     - Option 1: "Search the entire web" (recommended)
     - Option 2: Specific sites (for restricted domains)
   - **Search settings**:
     - Enable "Image search" (optional)
     - Enable "SafeSearch" (optional)
4. **Create** and note your **Search Engine ID** (format: `abc123def456:ghi789jkl`)

### Step 2: Get API Key

1. **Go to**: https://console.cloud.google.com/apis/credentials
2. **Enable API**:
   - Search for "Custom Search API"
   - Click "Enable"
3. **Create Credentials**:
   - Click "Create Credentials" → "API Key"
   - Copy the API key
4. **Optional - Restrict Key**:
   - Click the key to edit
   - Add "API restrictions" → "Custom Search API"
   - Add "Application restrictions" (IP/HTTP referrer if needed)

### Step 3: Configure .env

```bash
cd /root/agent-rag/backend

# Add to .env
cat >> .env << 'EOF'

# Google Custom Search Configuration
GOOGLE_SEARCH_API_KEY=YOUR_API_KEY_HERE
GOOGLE_SEARCH_ENGINE_ID=YOUR_ENGINE_ID_HERE
GOOGLE_SEARCH_ENDPOINT=https://customsearch.googleapis.com/customsearch/v1
EOF
```

Replace `YOUR_API_KEY_HERE` and `YOUR_ENGINE_ID_HERE` with your actual credentials.

### Step 4: Test Configuration

```bash
source .env

# Test query
curl "${GOOGLE_SEARCH_ENDPOINT}?key=${GOOGLE_SEARCH_API_KEY}&cx=${GOOGLE_SEARCH_ENGINE_ID}&q=test"
```

**Expected**: JSON response with search results.

### Pricing

- **Free Tier**: 100 queries/day
- **Paid**: $5 per 1,000 queries (up to 10K queries/day)
- **Documentation**: https://developers.google.com/custom-search/v1/overview

---

## 🌐 HyperBrowser Setup (Optional)

HyperBrowser enhances web search by scraping full page content or extracting structured data. It's **optional** and requires MCP (Model Context Protocol) configuration.

### What is HyperBrowser?

HyperBrowser is a web scraping service that:

- Renders JavaScript-heavy pages
- Extracts clean markdown content
- Extracts structured data with schemas
- Handles authentication and dynamic content

### Integration Method: MCP Tools

The application integrates HyperBrowser via **MCP (Model Context Protocol)**:

- Dynamically imports MCP tools at runtime
- Falls back gracefully if MCP not available
- No API keys stored in .env (managed by MCP server)

### Step 1: Install HyperBrowser MCP Server

**Option A: Using Claude Desktop (Recommended)**

1. Install Claude Desktop
2. Configure MCP servers in `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hyperbrowser": {
      "command": "npx",
      "args": ["-y", "@hyperbrowser/mcp-server"],
      "env": {
        "HYPERBROWSER_API_KEY": "your-hyperbrowser-api-key"
      }
    }
  }
}
```

**Option B: Standalone MCP Server**

```bash
# Install globally
npm install -g @hyperbrowser/mcp-server

# Run server
HYPERBROWSER_API_KEY=your-api-key hyperbrowser-mcp-server
```

### Step 2: Get HyperBrowser API Key

1. **Sign up**: https://hyperbrowser.ai/
2. **Get API key** from dashboard
3. **Configure** in MCP server (see Step 1)

### Step 3: Enable HyperBrowser Mode

```bash
# In backend/.env
WEB_SEARCH_MODE=hyperbrowser_scrape  # For full page scraping
# OR
WEB_SEARCH_MODE=hyperbrowser_extract  # For structured data extraction
```

### Step 4: Create MCP Tools Bridge

Create `/root/agent-rag/backend/mcp-tools.js`:

```javascript
// This file is dynamically imported by webSearch.ts
// It exports MCP tool functions that the MCP server provides

export async function mcp__hyperbrowser__scrape_webpage(args) {
  // This should be provided by your MCP client integration
  // For now, this is a placeholder
  throw new Error('HyperBrowser MCP not configured. See WEB_SEARCH_SETUP.md');
}

export async function mcp__hyperbrowser__extract_structured_data(args) {
  throw new Error('HyperBrowser MCP not configured. See WEB_SEARCH_SETUP.md');
}
```

**Note**: The actual MCP integration requires a running MCP server and client. This is typically handled by Claude Desktop or a custom MCP client.

### HyperBrowser Pricing

- **Free Tier**: Limited requests for testing
- **Paid Plans**: Starting at $29/month
- **Documentation**: https://docs.hyperbrowser.ai/

---

## 🎯 Recommended Configuration

### For Development/Testing

```bash
# Minimal - Google Custom Search only
GOOGLE_SEARCH_API_KEY=your-google-key
GOOGLE_SEARCH_ENGINE_ID=your-engine-id
WEB_SEARCH_MODE=full
WEB_RESULTS_MAX=15
```

### For Production (No HyperBrowser)

```bash
# Optimized for cost/speed
GOOGLE_SEARCH_API_KEY=your-google-key
GOOGLE_SEARCH_ENGINE_ID=your-engine-id
WEB_SEARCH_MODE=full
WEB_RESULTS_MAX=15
WEB_CONTEXT_MAX_TOKENS=30000
WEB_SAFE_MODE=active  # Enable safe search
WEB_DEFAULT_RECENCY=m  # Last month only
```

### For Production (With HyperBrowser)

```bash
# Full-featured web search
GOOGLE_SEARCH_API_KEY=your-google-key
GOOGLE_SEARCH_ENGINE_ID=your-engine-id
WEB_SEARCH_MODE=hyperbrowser_scrape
WEB_RESULTS_MAX=10  # Scraping is slower
WEB_CONTEXT_MAX_TOKENS=40000
```

---

## 🔄 Web Search Workflow

### Without HyperBrowser (Current Default)

```
User asks temporal question
     ↓
Planner detects freshness requirement
     ↓
Web search triggered → Google Custom Search
     ↓
Retrieve snippets only (320 chars per result)
     ↓
Filter by quality (authority, relevance, redundancy)
     ↓
Convert to References
     ↓
Synthesis with web context
```

**Limitations**:

- Only snippets available (no full page content)
- May miss context from full article
- JavaScript-heavy sites poorly represented

### With HyperBrowser (Enhanced)

```
User asks temporal question
     ↓
Planner detects freshness requirement
     ↓
Web search triggered → Google Custom Search
     ↓
Top 3 results → HyperBrowser scraping
  ├─ Renders full page (JavaScript executed)
  ├─ Extracts markdown content
  └─ Returns full article text
     ↓
Remaining results → Google snippets
     ↓
Filter by quality
     ↓
Synthesis with rich web context
```

**Benefits**:

- Full article content (not just snippets)
- JavaScript rendering (SPAs, dynamic content)
- Structured data extraction
- Better context for synthesis

---

## 🧪 Testing Web Search

### Test 1: Google Custom Search Only

```bash
cd /root/agent-rag/backend
npm run dev
```

In another terminal:

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{
      "role": "user",
      "content": "What are the latest developments in GPT-5?"
    }],
    "sessionId": "web-search-test"
  }' | jq '.answer'
```

**Expected**:

- Web search triggered (check logs for `google-search`)
- Answer includes citations from web results
- Telemetry shows web search activity

### Test 2: HyperBrowser Scraping (If Configured)

```bash
# Set mode in .env
WEB_SEARCH_MODE=hyperbrowser_scrape

# Restart backend
npm run dev
```

Query same question and check:

- Logs show `hyperbrowser` activity
- Response includes fuller content
- Telemetry shows scraping metadata

---

## 📊 Web Search Modes Comparison

| Mode                     | Speed   | Cost    | Content Quality | Use Case                  |
| ------------------------ | ------- | ------- | --------------- | ------------------------- |
| **summary**              | Fastest | Lowest  | Snippets only   | Quick facts               |
| **full**                 | Fast    | Low     | Full snippets   | General queries (current) |
| **hyperbrowser_scrape**  | Slow    | High    | Full articles   | Research queries          |
| **hyperbrowser_extract** | Slowest | Highest | Structured data | Data extraction           |

---

## 🔒 Security Considerations

### API Key Security

1. **Never commit .env to git**:

   ```bash
   # .gitignore already includes
   .env
   .env.local
   .env.production
   ```

2. **Use environment-specific keys**:

   ```bash
   # Development
   GOOGLE_SEARCH_API_KEY=dev-key-with-restrictions

   # Production
   GOOGLE_SEARCH_API_KEY=prod-key-with-ip-restrictions
   ```

3. **Rotate keys regularly**:
   - Google: Every 90 days
   - HyperBrowser: Per their security policy

### Rate Limiting

Configure rate limits to prevent abuse:

```bash
# In .env
RATE_LIMIT_MAX_REQUESTS=10  # Per minute per client
WEB_RESULTS_MAX=15          # Max web results per query
```

---

## 🐛 Troubleshooting

### Issue: "Google Search API key not configured"

**Cause**: `GOOGLE_SEARCH_API_KEY` not set in .env

**Fix**:

```bash
echo "GOOGLE_SEARCH_API_KEY=your-key" >> .env
echo "GOOGLE_SEARCH_ENGINE_ID=your-engine-id" >> .env
```

### Issue: "Hyperbrowser MCP not available, falling back to Google snippets"

**Cause**: MCP server not running or mcp-tools.js not configured

**Fix**:

1. Check if MCP server is running
2. Verify `mcp-tools.js` exists and exports correct functions
3. Or disable HyperBrowser: `WEB_SEARCH_MODE=full`

### Issue: "Google Search API error 403"

**Cause**: API key restrictions or billing not enabled

**Fix**:

1. Check API key restrictions in Google Cloud Console
2. Enable billing for Custom Search API
3. Verify API is enabled

### Issue: Web search not triggered

**Cause**: Planner not detecting freshness requirement

**Check**:

1. Telemetry drawer → Plan tab
2. Look for `requiresFreshness: true`
3. Try explicit temporal query: "What happened today in..."

**Fix**: Queries must indicate temporal/freshness needs for web search to trigger.

---

## 📈 Cost Estimation

### Google Custom Search

| Usage Level | Queries/Month | Cost/Month |
| ----------- | ------------- | ---------- |
| Free Tier   | 3,000         | $0         |
| Light       | 10,000        | $35        |
| Medium      | 50,000        | $225       |
| Heavy       | 100,000       | $475       |

### HyperBrowser (If Used)

| Plan       | Requests/Month | Cost/Month |
| ---------- | -------------- | ---------- |
| Developer  | 1,000          | $29        |
| Startup    | 10,000         | $99        |
| Business   | 50,000         | $299       |
| Enterprise | Custom         | Custom     |

### Combined Cost (Medium Usage)

- **RAG System**: ~$250-350/month (10K requests, 7 features enabled)
- **Google Search**: ~$225/month (50K web queries)
- **HyperBrowser**: ~$99/month (if scraping enabled)
- **Total**: ~$574-674/month

**Cost Optimization**:

- Use `ENABLE_WEB_QUALITY_FILTER=true` (already enabled) to reduce low-quality results
- Set `WEB_RESULTS_MAX=10` instead of 15 to reduce API calls
- Use `WEB_DEFAULT_RECENCY=m` to focus on recent content only
- Only enable HyperBrowser for research intents, not all queries

---

## ✅ Quick Setup Checklist

### Minimum (Google Search Only)

- [ ] Create Google Custom Search Engine
- [ ] Get Google API Key
- [ ] Add `GOOGLE_SEARCH_API_KEY` to .env
- [ ] Add `GOOGLE_SEARCH_ENGINE_ID` to .env
- [ ] Set `WEB_SEARCH_MODE=full`
- [ ] Test with temporal query
- [ ] Verify results in TelemetryDrawer

### Full (With HyperBrowser)

- [ ] Complete minimum setup above
- [ ] Sign up for HyperBrowser account
- [ ] Get HyperBrowser API key
- [ ] Install HyperBrowser MCP server
- [ ] Configure MCP tools bridge
- [ ] Set `WEB_SEARCH_MODE=hyperbrowser_scrape`
- [ ] Test with complex research query
- [ ] Verify full content in results

---

## 🎯 Next Steps

1. **Set up Google Custom Search** (required):
   - Follow Step 1-4 under "Google Custom Search Setup"
   - Test with a temporal query

2. **Optional - Add HyperBrowser**:
   - Only if you need full page scraping
   - Requires additional MCP server configuration
   - Increases cost but improves quality for research queries

3. **Configure Web Quality Filters**:
   - Already enabled: `ENABLE_WEB_QUALITY_FILTER=true`
   - Tune thresholds in .env if needed:
     ```bash
     WEB_MIN_AUTHORITY=0.3
     WEB_MAX_REDUNDANCY=0.9
     WEB_MIN_RELEVANCE=0.3
     ```

4. **Monitor Usage**:
   - Check Google Cloud Console for API usage
   - Review costs monthly
   - Adjust `WEB_RESULTS_MAX` based on needs

---

## 📚 References

### Documentation

- [Google Custom Search API](https://developers.google.com/custom-search/v1/overview)
- [HyperBrowser Documentation](https://docs.hyperbrowser.ai/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

### Code Files

- **Web Search Tool**: `backend/src/tools/webSearch.ts`
- **Web Quality Filter**: `backend/src/tools/webQualityFilter.ts`
- **Dispatch Logic**: `backend/src/orchestrator/dispatch.ts`
- **Configuration**: `backend/src/config/app.ts:59-80`

---

**Status Summary**: ⚠️ Google Custom Search required for web search functionality. HyperBrowser is optional for enhanced scraping.
