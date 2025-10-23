# Knowledge Agent API Comparison

**Created**: October 22, 2025
**Status**: API Discrepancy Identified
**Impact**: Implementation vs. Official Documentation Mismatch

## Executive Summary

Two distinct Knowledge Agent APIs have been identified in Azure AI Search:

1. **Search Endpoint API** (`/agents('name')/search`) - Currently implemented, based on `searchservice-preview.json`
2. **Retrieval Endpoint API** (`/knowledgeagents/name/retrieval`) - Documented in official Microsoft docs

This document compares both APIs and provides recommendations for implementation.

---

## API Comparison

### Current Implementation: Search Endpoint

**Source**: `searchservice-preview.json` (2025-08-01-preview)
**File**: `backend/src/azure/knowledgeAgent.ts:690`

#### Endpoint

```http
POST /agents('{agentName}')/search?api-version=2025-08-01-preview
Authorization: api-key {key}
Content-Type: application/json
```

#### Request Schema

```typescript
{
  activity: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  options?: {
    top?: number;                        // Max results to return
    filter?: string;                     // OData filter expression
    includeActivity?: boolean;           // Return activity timeline
    includeReferences?: boolean;         // Return source citations
    includeReferenceSourceData?: boolean;// Include structured metadata
    attemptFastPath?: boolean;           // Bypass LLM for simple queries
  };
}
```

#### Current Implementation Status

- ✅ **Implemented**: `activity` array with role/content
- ✅ **Implemented**: `top` parameter (lines 695)
- ✅ **Implemented**: `filter` parameter (line 696) - **Already supports OData filters!**
- ✅ **Implemented**: `includeActivity`, `includeReferences`, `includeReferenceSourceData` (lines 697-700)
- ✅ **Implemented**: `attemptFastPath` (line 701)
- ✅ **Implemented**: Correlation ID tracking (line 708)
- ✅ **Implemented**: Response normalization for references, activity, grounding (lines 718-720)

---

### Official Microsoft Documentation: Retrieval Endpoint

**Source**: Microsoft Azure AI Docs (`microsoftdocs/azure-ai-docs` via Context7)
**Documented In**: `docs/azure-ai-agents-ecosystem-guide.md:90-131`

#### Endpoint

```http
POST /knowledgeagents/{agentName}/retrieval?api-version=2025-05-01-preview
Authorization: Bearer {token}
Content-Type: application/json
```

#### Request Schema

```typescript
{
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  targetIndexParams?: Array<{
    indexName: string;                   // Target index name
    filterAddOn?: string;                // OData filter expression
    includeReferenceSourceData?: boolean;// Include structured metadata
    rerankerThreshold?: number;          // Minimum relevance score
    maxDocsForReranker?: number;         // Semantic reranker input size
    queryType?: 'semantic' | 'vector' | 'hybrid'; // Query execution mode
  }>;
}
```

#### Features NOT in Current Implementation

- ❌ **Missing**: `targetIndexParams` array for per-index configuration
- ❌ **Missing**: `maxDocsForReranker` parameter (controls semantic reranker input)
- ❌ **Missing**: `queryType` selection (semantic/vector/hybrid)
- ❌ **Missing**: Multi-index targeting in single request
- ⚠️ **Different**: Uses `messages` instead of `activity`
- ⚠️ **Different**: Uses `filterAddOn` instead of `filter`

---

## Key Differences

| Feature               | Search Endpoint (Current)                  | Retrieval Endpoint (Microsoft Docs)          |
| --------------------- | ------------------------------------------ | -------------------------------------------- |
| **API Version**       | `2025-08-01-preview`                       | `2025-05-01-preview`                         |
| **Endpoint Path**     | `/agents('name')/search`                   | `/knowledgeagents/name/retrieval`            |
| **Auth Method**       | `api-key` header                           | `Bearer` token                               |
| **Request Format**    | `activity` array + `options` object        | `messages` array + `targetIndexParams` array |
| **Filter Param**      | `options.filter` (✅ Implemented)          | `targetIndexParams[].filterAddOn`            |
| **Top K**             | `options.top` (✅ Implemented)             | Controlled per-index via targetIndexParams   |
| **Fast Path**         | `options.attemptFastPath` (✅ Implemented) | Not documented                               |
| **Activity Timeline** | `options.includeActivity` (✅ Implemented) | Not documented                               |
| **Reranker Control**  | ❌ Not available                           | `maxDocsForReranker` available               |
| **Query Type**        | ❌ Not available                           | `queryType` available                        |
| **Multi-Index**       | Single agent, potentially multi-source     | Explicit per-index params                    |

---

## Analysis

### Why Two APIs Exist

**Hypothesis 1: Different Product Lines**

- **Search Endpoint**: Part of Azure AI Search service (data plane REST API)
- **Retrieval Endpoint**: Part of Azure AI Agent Service (enterprise orchestration)

**Hypothesis 2: API Evolution**

- **Search Endpoint**: Newer preview (2025-08-01) with activity-based interface
- **Retrieval Endpoint**: Older preview (2025-05-01) with messages interface

**Hypothesis 3: Different Modalities**

- **Search Endpoint**: Optimized for agentic search with LLM query planning
- **Retrieval Endpoint**: Optimized for RAG pipelines with structured parameters

### Current Implementation Assessment

**Strengths**:

- ✅ Correctly implements the Search Endpoint API
- ✅ Already supports OData filters via `options.filter`
- ✅ Includes comprehensive diagnostics and correlation tracking
- ✅ Has fallback mechanisms to direct search
- ✅ Normalizes responses for unified grounding

**Gaps** (relative to Retrieval Endpoint features):

- ⚠️ Cannot control `maxDocsForReranker` (semantic reranker input size)
- ⚠️ Cannot explicitly select `queryType` (semantic/vector/hybrid)
- ⚠️ Cannot target multiple indexes with different params in single request

**Note**: These "gaps" may not be gaps at all - they may simply be features specific to the Retrieval Endpoint that aren't needed for the Search Endpoint's use case.

---

## Recommendations

### Immediate Actions (Week 1)

#### 1. Verify Current API Functionality ✅

**Status**: Current implementation is correct and fully functional

- The Search Endpoint API is properly implemented
- `filter` parameter is already supported (contrary to initial assumption)
- All documented options are utilized

#### 2. Add Fast Path Intelligence

**Enhancement**: Add query analysis to automatically enable fast path

```typescript
// backend/src/orchestrator/router.ts
export function shouldUseFastPath(query: string): boolean {
  const fastPathPatterns = [
    /^(what|where|when|who|how)\s+(is|are|was|were)\s+\w+\??$/i,
    /^show\s+(me\s+)?(?:the\s+)?[\w\s]+$/i,
    /^list\s+(all\s+)?[\w\s]+$/i,
  ];
  return fastPathPatterns.some((p) => p.test(query.trim()));
}
```

#### 3. Document API Usage

**Action**: Update inline comments in `knowledgeAgent.ts` to clarify:

- Which API version is being used
- Why this endpoint was chosen
- What parameters are available
- How to enable advanced features

### Short-Term Exploration (Month 1)

#### 1. Test Retrieval Endpoint Availability

**Action**: Determine if Retrieval Endpoint is available in your Azure environment

```typescript
// Test endpoint availability
const testRetrievalEndpoint = async () => {
  const url = `${config.AZURE_SEARCH_ENDPOINT}/knowledgeagents/${agentName}/retrieval?api-version=2025-05-01-preview`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'test query' }],
      }),
    });

    console.log('Retrieval endpoint status:', response.status);
  } catch (error) {
    console.log('Retrieval endpoint not available:', error);
  }
};
```

#### 2. Compare Performance

**If both APIs are available**, conduct A/B testing:

- Query latency
- Result quality
- Token usage
- Cost per request

### Long-Term Strategy (Quarter 1)

#### Option A: Stay with Search Endpoint (Recommended)

**Rationale**:

- ✅ Currently working well
- ✅ Fully implemented with diagnostics
- ✅ Already supports OData filters
- ✅ Has fast path optimization
- ✅ Activity timeline provides rich debugging

**Missing features** (`maxDocsForReranker`, `queryType`) **may not be critical** for current use case.

#### Option B: Adopt Retrieval Endpoint

**Only if**:

- Available in your Azure environment
- Testing shows measurable improvements
- Per-index parameter control is needed
- Semantic reranker tuning is required

**Migration Effort**: Medium (3-5 days)

- Rewrite request formatting
- Adjust response parsing
- Update authentication method
- Retest all integration points

#### Option C: Support Both APIs

**Use Case**: Different APIs for different intents

- **Search Endpoint**: Complex queries needing LLM planning
- **Retrieval Endpoint**: Structured RAG with explicit control

**Migration Effort**: High (1-2 weeks)

- Implement dual code paths
- Add API selection logic
- Maintain two response parsers
- Double the testing surface

---

## Configuration Schema Changes

### Current Schema (No Changes Needed)

```typescript
// backend/src/config/app.ts:24-31
AZURE_KNOWLEDGE_AGENT_NAME: z.string().default('earth-knowledge-agent'),
RETRIEVAL_STRATEGY: z.enum(['direct', 'knowledge_agent', 'hybrid']).default('direct'),
KNOWLEDGE_AGENT_INCLUDE_ACTIVITY: z.coerce.boolean().default(true),
KNOWLEDGE_AGENT_INCLUDE_REFERENCES: z.coerce.boolean().default(true),
KNOWLEDGE_AGENT_INCLUDE_SOURCE_DATA: z.coerce.boolean().default(true),
KNOWLEDGE_AGENT_ATTEMPT_FAST_PATH: z.coerce.boolean().default(false),
KNOWLEDGE_AGENT_TOP_K: z.coerce.number().default(5),
```

### Proposed Additions (If Migrating to Retrieval Endpoint)

```typescript
// Only add if switching to Retrieval Endpoint API
KNOWLEDGE_AGENT_API_VERSION: z.enum(['search', 'retrieval']).default('search'),
KNOWLEDGE_AGENT_MAX_DOCS_FOR_RERANKER: z.coerce.number().default(250),
KNOWLEDGE_AGENT_QUERY_TYPE: z.enum(['semantic', 'vector', 'hybrid']).default('hybrid'),
KNOWLEDGE_AGENT_BEARER_TOKEN: z.string().optional(), // If Bearer auth required
```

---

## Code Examples

### Current Implementation (Working)

```typescript
// backend/src/azure/knowledgeAgent.ts:682-748
export async function invokeKnowledgeAgent(
  options: KnowledgeAgentInvocationOptions,
): Promise<KnowledgeAgentInvocationResult> {
  const agentName = encodeURIComponent(config.AZURE_KNOWLEDGE_AGENT_NAME);
  const url = `${config.AZURE_SEARCH_ENDPOINT}/agents('${agentName}')/search?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;

  const payload = stripUndefined({
    activity: options.activity,
    options: stripUndefined({
      top: options.top ?? config.KNOWLEDGE_AGENT_TOP_K ?? config.RAG_TOP_K,
      filter: options.filter, // ✅ OData filters already supported!
      includeActivity: options.includeActivity ?? config.KNOWLEDGE_AGENT_INCLUDE_ACTIVITY,
      includeReferences: options.includeReferences ?? config.KNOWLEDGE_AGENT_INCLUDE_REFERENCES,
      includeReferenceSourceData:
        options.includeReferenceSourceData ?? config.KNOWLEDGE_AGENT_INCLUDE_SOURCE_DATA,
      attemptFastPath: options.attemptFastPath ?? config.KNOWLEDGE_AGENT_ATTEMPT_FAST_PATH,
    }),
  });

  const { response, requestId, correlationId } = await performSearchRequest(
    'knowledge-agent-search',
    url,
    { method: 'POST', body: payload, correlationId: options.correlationId },
  );

  // ... response parsing
}
```

### Retrieval Endpoint Alternative (If Migrating)

```typescript
// Hypothetical implementation for Retrieval Endpoint API
export async function invokeKnowledgeAgentRetrieval(
  options: KnowledgeAgentRetrievalOptions,
): Promise<KnowledgeAgentInvocationResult> {
  const url = `${config.AZURE_SEARCH_ENDPOINT}/knowledgeagents/${config.AZURE_KNOWLEDGE_AGENT_NAME}/retrieval?api-version=2025-05-01-preview`;

  const payload = {
    messages: options.messages, // Changed from 'activity'
    targetIndexParams: [
      {
        indexName: config.AZURE_SEARCH_INDEX_NAME,
        filterAddOn: options.filter, // Changed from 'filter'
        includeReferenceSourceData:
          options.includeReferenceSourceData ?? config.KNOWLEDGE_AGENT_INCLUDE_SOURCE_DATA,
        rerankerThreshold: config.RERANKER_THRESHOLD,
        maxDocsForReranker: config.KNOWLEDGE_AGENT_MAX_DOCS_FOR_RERANKER ?? 250,
        queryType: config.KNOWLEDGE_AGENT_QUERY_TYPE ?? 'hybrid',
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.KNOWLEDGE_AGENT_BEARER_TOKEN}`,
      'Content-Type': 'application/json',
      'x-correlation-id': options.correlationId,
    },
    body: JSON.stringify(payload),
  });

  // ... response parsing (different structure)
}
```

---

## Testing Checklist

### Current API Validation ✅

- [x] Verify `/agents/search` endpoint is accessible
- [x] Confirm `filter` parameter works with OData expressions
- [x] Test `attemptFastPath` toggle
- [x] Validate response parsing for references/activity/grounding
- [x] Confirm correlation ID tracking

### Retrieval API Exploration ⬜

- [ ] Check if `/knowledgeagents/retrieval` endpoint exists in your environment
- [ ] Test Bearer token authentication method
- [ ] Validate `maxDocsForReranker` parameter effect
- [ ] Test `queryType` selection (semantic/vector/hybrid)
- [ ] Compare result quality with Search endpoint

---

## Conclusion

**Current Status**: ✅ **Implementation is correct and complete**

The current implementation uses the **Search Endpoint API** (`/agents/search`) from `searchservice-preview.json` (2025-08-01-preview) and is fully functional with:

- ✅ OData filter support via `options.filter`
- ✅ Fast path optimization via `options.attemptFastPath`
- ✅ Activity timeline capture
- ✅ Comprehensive diagnostics

**No immediate changes required** unless:

1. You need per-index `maxDocsForReranker` tuning
2. You need explicit `queryType` control
3. The Retrieval Endpoint API offers measurable performance benefits

**Recommended Next Steps**:

1. Add intelligent fast path detection (Priority 3 from utilization guide)
2. Implement custom retrieval instructions for intent-based routing (Priority 2)
3. Add knowledge agent management functions for multi-source federation (Priority 1)

**References**:

- `docs/knowledge-agent-utilization-guide.md` - Detailed enhancement recommendations
- `docs/azure-ai-agents-ecosystem-guide.md` - Ecosystem comparison
- `backend/src/azure/knowledgeAgent.ts` - Current implementation
- `searchservice-preview.json` - Search Endpoint API specification
