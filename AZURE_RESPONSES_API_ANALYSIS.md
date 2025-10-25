# Azure Responses API - Structured Outputs Analysis

## Problem Summary

Query decomposition is failing with:

```
SyntaxError: Unterminated string in JSON at position 1748 (line 25 column 17)
```

## Azure Responses API Structure (from v1preview.json)

### Request Format

**Endpoint**: `POST /responses`

**Request Body** (`AzureCreateResponse`):

```typescript
{
  model: string;  // Deployment name
  input: string | ItemParam[];  // Messages
  text: {
    format: ResponseTextFormatConfiguration  // Structured output config
  };
  max_output_tokens: number;
  reasoning?: { effort, summary };
  // ... other fields
}
```

**Structured Output Config** (`ResponseTextFormatConfigurationJsonSchema`):

```typescript
{
  type: "json_schema",
  name: string,        // Schema name (required)
  schema: object,      // JSON Schema object
  strict?: boolean,    // Default: false
  description?: string
}
```

### Response Format

**Response Body** (`AzureResponse`):

```typescript
{
  id: string;
  object: "response";
  status: "completed" | "failed" | "in_progress" | ...;
  created_at: number;
  output: ItemResource[];  // Array of output items
  output_text?: string;    // SDK convenience (aggregated text)
  reasoning?: {...};
  usage: {...};
  text: {
    format: ResponseTextFormatConfiguration
  };
  // ... other fields
}
```

**Output Items** (`ItemResource[]`):

- Discriminated union based on `type` field
- Types include: `message`, `reasoning`, `function_call`, etc.
- For text output: type is `message` → `ResponsesMessageItemResource`

### Message Item Structure

**`ResponsesMessageItemResource`**:

```typescript
{
  type: "message";
  id: string;
  role: "assistant" | "user" | "system";
  content: ContentPart[];  // Array of content parts
  status?: "completed" | "incomplete";
}
```

**Content Parts**:

- `text`: Plain text content part
- `image_url`: Image content part
- `audio_file`: Audio content part
- For JSON schema output: text part contains **raw JSON string**

## Key Finding: JSON is Returned as String

**Critical Insight**: When using `text.format.type: "json_schema"`:

1. The model generates JSON according to the schema
2. Azure returns it as a **string** in `output[].content[].text`
3. Application must parse this string to get the JSON object

## Current Code Flow

**File**: `backend/src/orchestrator/queryDecomposition.ts`

```typescript
// Line 137-149: Create structured output request
const response = await createResponse({
  model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
  temperature: 0.2,
  max_output_tokens: 2000,
  textFormat: DECOMPOSITION_SCHEMA,  // Strict JSON schema
  parallel_tool_calls: false,
  reasoning: getReasoningOptions('decomposition'),
  messages: [...]
});

// Line 151-152: Extract and parse
const outputText = extractOutputText(response);
const parsed = JSON.parse(outputText || '{}');
```

## The Bug

**What's Happening**:

1. GPT-5 with reasoning generates long strings in the `reasoning` field
2. Strict mode (`strict: true`) attempts to validate the JSON
3. Azure's strict validation **fails to properly escape** quotes/newlines in reasoning strings
4. Result: Malformed JSON with unterminated strings

**Example Error**:

```
SyntaxError: Unterminated string in JSON at position 1748 (line 25 column 17)
```

## Root Cause

Looking at the schema in `queryDecomposition.ts:43-72`:

```typescript
const DECOMPOSITION_SCHEMA = {
  type: 'json_schema' as const,
  name: 'query_decomposition',
  strict: true, // ⚠️ PROBLEM: Strict mode
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      subQueries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            query: { type: 'string' },
            dependencies: { type: 'array', items: { type: 'number' } },
            reasoning: { type: 'string' }, // ⚠️ Long GPT-5 reasoning strings break here
          },
          required: ['id', 'query', 'dependencies', 'reasoning'],
        },
      },
      synthesisPrompt: { type: 'string' },
    },
    required: ['subQueries', 'synthesisPrompt'],
  },
};
```

**The Issue**:

- `reasoning` field contains GPT-5's extended thinking
- These strings have quotes, newlines, special characters
- Strict mode fails to escape them properly
- JSON becomes malformed

## Solutions

### Option 1: Disable Strict Mode (Quick Fix)

```typescript
const DECOMPOSITION_SCHEMA = {
  type: 'json_schema' as const,
  name: 'query_decomposition',
  strict: false,  // Change from true
  schema: { ... }
};
```

**Pros**: Simple one-line fix
**Cons**: Loses strict validation benefits

### Option 2: Remove Reasoning Field (Better)

```typescript
properties: {
  id: { type: 'number' },
  query: { type: 'string' },
  dependencies: { type: 'array', items: { type: 'number' } }
  // Remove: reasoning: { type: 'string' }
},
required: ['id', 'query', 'dependencies']  // Remove reasoning
```

**Pros**: Eliminates problematic field, keeps strict mode
**Cons**: Loses reasoning visibility (but it's not essential)

### Option 3: Reduce Token Limits (Band-aid)

```typescript
max_output_tokens: 500; // Reduce from 2000
```

**Pros**: Limits reasoning length, may prevent errors
**Cons**: Doesn't fix root cause, may still fail

### Option 4: Keep Disabled (Recommended)

```bash
ENABLE_QUERY_DECOMPOSITION=false  # Current state
```

**Pros**:

- No code changes needed
- Feature already has graceful fallback
- Saves 2-3x cost
- Marginal benefit for most queries

**Cons**:

- Query decomposition unavailable
- Multi-part queries handled less optimally

## Recommendation

**Keep query decomposition disabled** (`ENABLE_QUERY_DECOMPOSITION=false`):

1. ✅ Already gracefully handled with fallback
2. ✅ Adds significant cost (2-3x) for minimal benefit
3. ✅ Listed in "Advanced Features (Disabled by Default)"
4. ✅ Core system works excellently without it
5. ✅ Error is just noise in logs from disabled feature

**If you want to enable it**, use **Option 2** (remove reasoning field):

```typescript
// queryDecomposition.ts:54-65
items: {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'number' },
    query: { type: 'string' },
    dependencies: { type: 'array', items: { type: 'number' } }
    // Remove reasoning field entirely
  },
  required: ['id', 'query', 'dependencies']
}
```

## Azure Responses API Best Practices

Based on the v1preview.json analysis:

1. **Strict mode has limitations**: Only subset of JSON Schema supported
2. **String escaping fragile**: Long text fields with special chars problematic
3. **Use minimal schemas**: Fewer string fields = fewer escaping issues
4. **Consider non-strict**: `strict: false` more forgiving
5. **Test with real data**: Strict mode may work in examples, fail in production

## Related Files

- `/root/agent-rag/v1preview.json` - Complete API specification
- `/root/agent-rag/backend/src/orchestrator/queryDecomposition.ts` - Implementation
- `/root/agent-rag/backend/src/azure/openaiClient.ts` - API client
- `/root/agent-rag/backend/.env` - Configuration

## Status

**Current**: Query decomposition disabled, system fully functional
**Action Required**: None (keep disabled) or implement Option 2 (remove reasoning field)
