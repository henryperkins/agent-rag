# Product Overview

## Purpose
Agentic RAG Chat Application is a production-grade Retrieval-Augmented Generation system that combines intelligent orchestration, multi-source retrieval, and real-time streaming to deliver accurate, grounded answers with citations.

## Value Proposition
- **Intelligent Orchestration**: Multi-stage agentic workflow with planning, retrieval, synthesis, and quality evaluation
- **Hybrid Retrieval**: Direct Azure AI Search integration combining vector search, BM25, and L2 semantic reranking
- **Cost Optimization**: Lazy retrieval and intent routing reduce token usage by 40-60%
- **Quality Assurance**: Multi-pass critic evaluation with automatic revision loops
- **Real-time Experience**: Server-Sent Events streaming with progress updates

## Key Features

### Core Capabilities
- **Agentic Workflow**: Planning → Retrieval → Synthesis → Critique pipeline
- **Multi-Source Retrieval**: Azure AI Search + Google Custom Search integration
- **Streaming Responses**: Real-time SSE with progress events (route, plan, context, tool, token, critique)
- **Lazy Retrieval**: Summary-first document loading with on-demand full content hydration
- **Semantic Memory**: Persistent cross-session memory with SQLite and vector similarity
- **Intent Classification**: Automatic routing (FAQ, factual, research, conversational)
- **Context Engineering**: Token-budgeted history compaction with summary/salience extraction

### Advanced Features
- **Multi-Pass Critic**: Quality evaluation with coverage, grounding, and automatic revision
- **Confidence-Based Escalation**: Automatic fallback to dual retrieval on low confidence
- **Structured Outputs**: JSON schema validation for planner and critic responses
- **Multi-Level Fallback**: Graceful degradation (hybrid → pure vector → web search)
- **Query Decomposition**: Complex multi-step query handling (optional)
- **Web Reranking**: Unified Azure + Web results with Reciprocal Rank Fusion

## Target Users

### Primary Users
- **Enterprise Teams**: Organizations needing production-grade RAG with observability
- **AI Engineers**: Developers building agentic systems with Azure AI services
- **Research Teams**: Groups requiring multi-source information synthesis

### Use Cases
- **Knowledge Base Q&A**: FAQ and factual queries with citation tracking
- **Research Assistance**: Multi-source analysis with web search integration
- **Document Analysis**: Semantic search across indexed document collections
- **Conversational AI**: Context-aware follow-up handling with session persistence

## Cost Profiles

### Minimal Configuration
- **Cost**: $200-300/month
- **Features**: Critic + Intent Routing + Lazy Retrieval
- **Use Case**: Development, testing, budget-constrained environments

### Balanced Production (Recommended)
- **Cost**: $400-600/month
- **Features**: Core + Web Reranking + Semantic Summary
- **Use Case**: Production with cost awareness

### Full Enterprise
- **Cost**: $700-1000/month
- **Features**: All features enabled
- **Use Case**: Enterprise prioritizing quality over cost
