# Product Overview

## Purpose

Agentic RAG Chat Application is a production-grade Retrieval-Augmented Generation system that combines intelligent orchestration, multi-source retrieval, and real-time streaming to deliver accurate, cited answers from enterprise knowledge bases and web sources.

## Value Proposition

- **Cost-Optimized Intelligence**: Adaptive model selection and lazy retrieval reduce operational costs by 50-65%
- **Enterprise-Grade Quality**: Multi-pass critic evaluation ensures grounded, comprehensive answers
- **Hybrid Search Excellence**: Direct Azure AI Search integration with vector + BM25 + L2 semantic reranking
- **Real-Time Responsiveness**: Server-Sent Events streaming with progress updates and activity tracking
- **Production-Ready**: OpenTelemetry observability, SQLite persistence, and comprehensive testing

## Key Features

### Core Capabilities

- **Intelligent Orchestration**: Agentic workflow with planning, retrieval, synthesis, and critique phases
- **Hybrid Retrieval**: Azure AI Search integration combining vector similarity, BM25 keyword matching, and semantic reranking
- **Web Search Integration**: Google Custom Search for real-time information beyond indexed documents
- **Streaming Responses**: SSE-based real-time streaming with granular progress events
- **Multi-Pass Critic**: Quality evaluation with automatic revision loops (coverage, grounding, quality)
- **Lazy Retrieval**: Summary-first approach with on-demand full document hydration (40-50% token savings)
- **Semantic Memory**: Persistent cross-session memory with vector similarity search
- **Document Upload**: Runtime PDF upload with automatic chunking and indexing

### Advanced Features

- **Intent Classification**: Automatic routing (FAQ/factual/research/conversational) with optimized model selection
- **Context Engineering**: Token-budgeted history compaction with summary and salience extraction
- **Confidence-Based Escalation**: Automatic fallback to dual retrieval on low confidence scores
- **Structured Outputs**: JSON schema validation for planner and critic responses
- **Multi-Level Fallback**: Graceful degradation (hybrid → pure vector → web search)
- **Session Persistence**: SQLite-backed transcripts and memory for durable history

### Observability

- **OpenTelemetry Tracing**: End-to-end spans for planning, retrieval, synthesis, and critique
- **Telemetry Events**: SessionTrace, PlanSummary, ContextBudget, CriticReport, ActivityStep
- **Evaluation Metrics**: Intent accuracy, RAG precision/recall, answer quality scores, token usage

## Target Users

### Primary Users

- **Enterprise Knowledge Workers**: Employees needing quick access to internal documentation and policies
- **Research Teams**: Analysts requiring multi-source information synthesis with citations
- **Customer Support**: Support agents needing accurate, grounded answers from knowledge bases

### Use Cases

- **Internal Knowledge Base Search**: Query company documentation, policies, and procedures
- **Research & Analysis**: Multi-source information gathering with automatic synthesis
- **FAQ Automation**: Quick answers to common questions with citation tracking
- **Conversational Support**: Context-aware follow-up questions with session memory
- **Document Discovery**: Upload and query new documents at runtime

## Deployment Modes

### Minimal (Development/Testing)

- Cost: $200-300/month
- Features: Critic + Intent Routing + Lazy Retrieval
- Use: Development, testing, budget-constrained environments

### Balanced (Production - Recommended)

- Cost: $400-600/month
- Features: Core + Web Reranking + Semantic Summary
- Use: Production with cost awareness

### Full Features (Enterprise)

- Cost: $700-1000/month
- Features: All capabilities enabled
- Use: Enterprise prioritizing quality over cost
