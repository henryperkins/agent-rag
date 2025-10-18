# Citation Tracking - Quick Start Guide

**Status**: ✅ Ready to Use
**Time to Enable**: 2 minutes

---

## Enable Citation Tracking (2 Steps)

### Step 1: Update `.env`

```bash
cd backend

# Add to your .env file (or uncomment if already present)
ENABLE_CITATION_TRACKING=true
ENABLE_SEMANTIC_MEMORY=true
SEMANTIC_MEMORY_DB_PATH=./data/semantic-memory.db
```

### Step 2: Initialize Database

```bash
# Run setup script to create semantic memory database
pnpm setup

# Or manually create the directory
mkdir -p data
```

**That's it!** Citation tracking is now active.

---

## Verify It's Working

### 1. Start the Backend

```bash
cd backend
pnpm dev
```

### 2. Send a Test Query

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "What is Azure AI Search?"}
    ]
  }'
```

### 3. Check Console Output

Look for this line in the backend console:

```
Citation usage: 3/5 references cited
```

This confirms citation tracking is running!

---

## What Happens Now?

### Automatic Learning

Every successful answer:

1. **Extracts citations** from the answer (e.g., `[1]`, `[2]`)
2. **Marks references** as cited or unused
3. **Stores patterns** in semantic memory for future use

### Example Pattern Stored

```
Query "What is Azure AI Search?" successfully answered using chunks: doc-1, doc-3, doc-5
Metadata: { citationRate: 0.6, avgRerankerScore: 2.8, totalCitations: 3 }
```

### Low-Usage Detection

If >50% of retrieved docs are unused:

```
Query "vague question" had low citation rate (2/10). Consider query reformulation.
```

---

## View Stored Patterns

### Option 1: Query Semantic Memory

```typescript
import { semanticMemoryStore } from './orchestrator/semanticMemoryStore.js';

const patterns = await semanticMemoryStore.recallMemories('Azure AI Search', {
  type: 'procedural',
  k: 5,
});

console.log(patterns);
```

### Option 2: Check Database Directly

```bash
cd backend/data
sqlite3 semantic-memory.db

# View all procedural memories (successful patterns)
SELECT text, metadata FROM memories WHERE type = 'procedural' LIMIT 10;

# View episodic memories (low-usage patterns)
SELECT text, metadata FROM memories WHERE type = 'episodic' LIMIT 10;
```

---

## Monitor Citation Efficiency

### Key Metrics to Track

1. **Citation Rate**: % of retrieved docs actually cited
   - **Good**: >50%
   - **Needs Improvement**: <30%

2. **Pattern Growth**: Number of stored patterns over time
   - Indicates learning progress

3. **Low-Usage Queries**: Queries with <50% citation rate
   - Candidates for query reformulation

### Example Monitoring Script

```typescript
// backend/scripts/monitor-citations.ts
import { semanticMemoryStore } from '../src/orchestrator/semanticMemoryStore.js';

const stats = semanticMemoryStore.getStats();
console.log('Total memories:', stats.total);
console.log('By type:', stats.byType);

// Get recent successful patterns
const recent = await semanticMemoryStore.recallMemories('', {
  type: 'procedural',
  k: 10,
  maxAgeDays: 7,
});

console.log(`Successful patterns (last 7 days): ${recent.length}`);
```

---

## Disable Citation Tracking

If you need to disable it:

```bash
# In backend/.env
ENABLE_CITATION_TRACKING=false
```

Restart the backend. No data is lost - patterns remain in the database.

---

## Troubleshooting

### "Citation usage: 0/X references cited"

**Possible Causes**:

1. Answer has no citations (check answer format)
2. All references unused (retrieval quality issue)

**Solution**: Check if answer contains `[1]`, `[2]` style citations

### "better-sqlite3 native bindings error"

**Solution**:

```bash
cd backend
pnpm rebuild better-sqlite3
```

### Database not created

**Solution**:

```bash
cd backend
mkdir -p data
pnpm setup
```

---

## Next Steps

### Use the Data (Future Enhancements)

1. **Adaptive Retrieval** (Enhancement #3)
   - Use patterns to reformulate low-performing queries
   - Recall similar successful queries before retrieval

2. **Citation-Based Reranking**
   - Boost chunks with high historical citation rates
   - Deprioritize chunks rarely cited

3. **Cost Optimization**
   - Reduce `RAG_TOP_K` for queries with high citation rates
   - Increase for queries with low citation rates

### Build a Dashboard

```typescript
// Example: Citation efficiency dashboard
const stats = {
  totalQueries: 1000,
  avgCitationRate: 0.65,
  topCitedChunks: [...],
  lowUsageQueries: [...]
};
```

---

## Configuration Reference

### Required

```bash
ENABLE_CITATION_TRACKING=true
ENABLE_SEMANTIC_MEMORY=true
SEMANTIC_MEMORY_DB_PATH=./data/semantic-memory.db
```

### Optional (Semantic Memory Tuning)

```bash
SEMANTIC_MEMORY_RECALL_K=3              # Patterns to recall
SEMANTIC_MEMORY_MIN_SIMILARITY=0.6      # Similarity threshold
SEMANTIC_MEMORY_PRUNE_AGE_DAYS=90       # Auto-prune old patterns
```

---

## Performance Impact

- **Latency**: +10-50ms per request (non-blocking)
- **Storage**: ~1-2 KB per successful query
- **Cost**: ~$5-10/month for 10K queries
- **ROI**: High (enables future optimizations)

---

## Support

- **Documentation**: `docs/CITATION_TRACKING.md`
- **Implementation**: `backend/src/orchestrator/citationTracker.ts`
- **Tests**: `backend/src/tests/citationTracker.test.ts`
- **Issues**: Check console warnings for debugging

---

**Ready to use!** Citation tracking is now building institutional knowledge with every query. 🎉
