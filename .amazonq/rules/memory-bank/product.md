# Product Overview

## Project Purpose

Agentic RAG Chat Application is a production-grade Retrieval-Augmented Generation (RAG) system that combines intelligent orchestration, multi-source retrieval, and real-time streaming responses to deliver high-quality, contextually-grounded answers.

## Value Proposition

- **Intelligent Query Handling**: Automatically classifies user intent (FAQ, factual, research, conversational) and routes to optimized processing pipelines
- **Cost-Optimized Retrieval**: Lazy retrieval with summary-first approach reduces token usage by 40-50% while maintaining answer quality
- **Multi-Source Intelligence**: Seamlessly combines Azure AI Search (hybrid vector + BM25 + semantic reranking) with Google Custom Search for comprehensive coverage
- **Quality Assurance**: Multi-pass critic evaluation with automatic revision loops ensures grounded, complete, and high-quality responses
- **Production-Ready**: Built-in observability (OpenTelemetry), rate limiting, CORS protection, and comprehensive error handling

## Key Features

### Core Capabilities

- **Agentic Orchestration**: Planning → Retrieval → Synthesis → Critique workflow with adaptive decision-making
- **Hybrid Search**: Direct Azure AI Search integration with vector similarity, BM25 keyword matching, and L2 semantic reranking
- **Streaming Responses**: Real-time Server-Sent Events (SSE) with progress updates, tool execution visibility, and token-by-token streaming
- **Context Engineering**: Token-budgeted history compaction with semantic summary selection and salience extraction
- **Semantic Memory**: Persistent cross-session memory with SQLite backend and vector similarity search
- **Confidence-Based Escalation**: Automatic fallback from hybrid → pure vector → web search on low confidence scores

### Advanced Features

- **Intent Classification**: Routes queries to optimized models (GPT-4o for complex, GPT-4o-mini for simple)
- **Lazy Retrieval**: Loads document summaries first, hydrates full content only when critic determines necessity
- **Query Decomposition**: Breaks complex multi-part questions into sub-queries for comprehensive coverage
- **Web Result Reranking**: Unified Reciprocal Rank Fusion (RRF) for Azure + web search results
- **Structured Outputs**: JSON schema validation for planner and critic responses ensures reliability
- **Multi-Level Fallback**: Graceful degradation with automatic retry logic and alternative strategies

## Target Users

### Primary Users

- **Enterprise Teams**: Organizations needing production-grade RAG with cost controls and quality guarantees
- **AI Developers**: Teams building conversational AI applications requiring advanced orchestration patterns
- **Research Teams**: Groups needing multi-source information synthesis with citation tracking

### Use Cases

1. **Knowledge Base Q&A**: Internal documentation search with grounded, cited answers
2. **Research Assistant**: Multi-source information gathering with web search fallback
3. **Customer Support**: FAQ handling with intent routing and conversational follow-ups
4. **Document Analysis**: Semantic search across large document collections with lazy loading
5. **Hybrid Search Applications**: Applications requiring both keyword and semantic search capabilities

## Key Differentiators

- **Cost Optimization**: 50-65% cost reduction through intent routing and lazy retrieval
- **Quality First**: Multi-pass critic with configurable quality thresholds (default 0.75)
- **Observability**: Comprehensive telemetry with OpenTelemetry spans, metrics, and evaluation tracking
- **Flexibility**: 7+ feature flags for progressive enablement and cost/quality trade-offs
- **Production-Grade**: Rate limiting, CORS, input validation, timeouts, and security best practices built-in
