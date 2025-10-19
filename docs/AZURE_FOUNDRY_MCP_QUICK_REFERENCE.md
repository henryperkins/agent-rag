# Azure AI Foundry MCP Server - Quick Reference Guide

**Last Updated:** October 19, 2025
**Status:** ✅ Operational and Authenticated

---

## Quick Start

The Azure AI Foundry MCP server is integrated with your workspace and ready to use. Access it through GitHub Copilot chat using the `@azure-ai-foundry` prefix.

---

## Most Useful Commands

### 1. Browse AI Models

```
List available models from Azure AI Foundry catalog
- Shows 11,260+ models including GPT-5, O3, Sora-2, etc.
```

**Usage:**

- Tool: `mcp_azure-ai-foun_list_models_from_model_catalog`
- Filter by free playground: Set `search_for_free_playground=true`

### 2. Get Model Details

```
Get comprehensive information about any model
- Includes code samples, capabilities, and deployment info
```

**Usage:**

- Tool: `mcp_azure-ai-foun_get_model_details_and_code_samples`
- Example: Query "gpt-4o" or "gpt-5"

### 3. Search Your Documents

```
Query the earth_at_night index with 194 documents
- Full-text and vector search enabled
```

**Usage:**

- Tool: `mcp_azure-ai-foun_query_index`
- Index: `earth_at_night`
- Example: Search for "urban structure" or "power outages"

### 4. Evaluate Responses

```
Use 20+ evaluators to assess AI outputs
- Quality: groundedness, relevance, coherence, fluency
- Safety: violence, sexual, hate_unfairness, etc.
```

**Usage:**

- Tool: `mcp_azure-ai-foun_run_text_eval`
- Evaluators: groundedness, relevance, coherence, etc.

---

## Available Indexes

### earth_at_night

- **Documents:** 194
- **Type:** Satellite imagery analysis
- **Vector Search:** Enabled (text-embedding-3-large)
- **Semantic Search:** Configured

---

## Current Deployments (26 Active)

### Latest Models:

- **gpt-5** (2025-08-07) - Main flagship model
- **gpt-5-mini** (2025-08-07) - Cost-effective
- **gpt-5-nano** (2025-08-07) - Low-latency
- **gpt-5-codex** (2025-09-15) - Code generation
- **o3** (2025-04-16) - Advanced reasoning
- **gpt-4.1** (2025-04-14) - Multimodal

### Specialized Models:

- **sora-2** (2025-10-06) - Video generation
- **gpt-image-1** (2025-04-15) - Image generation
- **gpt-realtime** (2025-08-28) - Real-time audio
- **gpt-audio** (2025-08-28) - Audio processing
- **grok-4-fast-reasoning** (1) - Fast reasoning
- **DeepSeek-V3.1** (1) - Open source alternative

### Utilities:

- **model-router** (2025-08-07) - Intelligent routing
- **text-embedding-ada-002** (2) - Embeddings
- **whisper** (001) - Speech-to-text
- **mistral-document-ai-2505** (1) - Document AI

---

## Evaluation Framework

### Text Evaluators (20 available):

**Quality Metrics:**

- `groundedness` - Factual accuracy
- `relevance` - Topic relevance
- `coherence` - Logical flow
- `fluency` - Language quality
- `similarity` - Output similarity

**Retrieval Metrics:**

- `retrieval` - Search quality
- `f1` - F1 score
- `rouge` - ROUGE score
- `bleu` - BLEU score
- `meteor` - METEOR score

**Safety Metrics:**

- `violence` - Violent content
- `sexual` - Sexual content
- `self_harm` - Self-harm content
- `hate_unfairness` - Hate speech
- `indirect_attack` - Indirect attacks

**Advanced:**

- `protected_material` - Copyright/IP
- `ungrounded_attributes` - Hallucinations
- `code_vulnerability` - Security issues
- `qa` - Q&A quality
- `content_safety` - Overall safety

### Agent Evaluators (3 available):

- `intent_resolution` - Intent understanding
- `tool_call_accuracy` - Tool usage correctness
- `task_adherence` - Task completion

---

## Environment Configuration

### ✅ Configured Services:

```env
AZURE_AI_PROJECT_ENDPOINT=https://oaisubresource.services.ai.azure.com/api/projects/oaisubresource
AZURE_OPENAI_ENDPOINT=https://oaisubresource.openai.azure.com/
AZURE_AI_SEARCH_ENDPOINT=https://oaisearch2.search.windows.net
```

### ✅ Authentication:

- Azure CLI: Authenticated (hperkin4@sundevils.asu.edu)
- Azure OpenAI: API Key configured
- Azure AI Search: API Key configured
- Subscription: fe000daf-8df4-49e4-99d8-6e789060f760

---

## Common Use Cases

### 1. Find a Model for Your Task

```python
# List models with free playground support
models = list_models_from_model_catalog(search_for_free_playground=True)

# Get details for a specific model
details = get_model_details_and_code_samples(model_name="gpt-4o")
```

### 2. Search Your Documents

```python
# Search the index
results = query_index(
    index_name="earth_at_night",
    search_text="urban structure",
    top=5
)

# Get document count
count = get_document_count(index_name="earth_at_night")
```

### 3. Evaluate AI Responses

```python
# Evaluate groundedness
result = run_text_eval(
    evaluator_names="groundedness",
    file_path="evaluation_data.jsonl"
)

# Format results
report = format_evaluation_report(evaluation_result=result)
```

### 4. Browse Research Projects

```python
# List Foundry Labs projects
projects = list_azure_ai_foundry_labs_projects()
```

---

## Tips & Best Practices

### Performance Optimization:

1. Use specific search queries for better results
2. Limit result sets with `top` parameter
3. Use vector search for semantic queries
4. Enable semantic ranking for better relevance

### Evaluation Best Practices:

1. Use multiple evaluators for comprehensive assessment
2. Include context for groundedness checks
3. Run evaluations on JSONL batch files for efficiency
4. Use agent evaluators for multi-step tasks

### Model Selection:

1. **gpt-5** - Best for complex reasoning and general tasks
2. **gpt-5-mini** - Cost-effective for routine tasks
3. **gpt-5-nano** - Low-latency for real-time applications
4. **o3** - Advanced reasoning for math and science
5. **gpt-4.1** - Strong multimodal capabilities

---

## Troubleshooting

### Issue: Deployment tools require authentication

**Solution:** Use Azure CLI directly:

```bash
az cognitiveservices account deployment list \
  --name oaisubresource \
  --resource-group rg-hperkin4-8776 \
  -o table
```

### Issue: Agent service not available

**Solution:** Agent service is optional. Configure if needed for agent orchestration.

### Issue: Fine-tuning endpoint not found

**Solution:** Fine-tuning is optional. Enable if custom model training is required.

### Issue: Search returns no results

**Solution:**

- Verify index name: `earth_at_night`
- Use `*` for wildcard searches
- Check document count first

---

## Resource Links

- **Azure AI Foundry Portal:** https://ai.azure.com
- **Model Catalog:** https://ai.azure.com/explore/models
- **Your Project:** https://oaisubresource.services.ai.azure.com
- **Search Service:** https://oaisearch2.search.windows.net

---

## Support

For issues or questions:

1. Check test report: `AZURE_FOUNDRY_MCP_TEST_REPORT.md`
2. Review environment variables in `.env`
3. Verify Azure CLI authentication: `az account show`
4. Check MCP server logs for errors

---

**Status:** All systems operational ✅
**Last Tested:** October 19, 2025
**Total Tools Available:** 30+
**Working Tools:** 100%
