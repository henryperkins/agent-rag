---
title: "Enterprise-Level Telemetry for Azure OpenAI Model Applications"
created: 2025-10-04
modified: 2025-10-04
description: "Comprehensive guide to implementing enterprise-grade telemetry, observability, and safety monitoring for Azure OpenAI applications using Azure AI Foundry"
tags:
  - "azure-openai"
  - "telemetry"
  - "observability"
  - "ai-safety"
  - "enterprise-ai"
  - "tracing"
  - "evaluation"
  - "rag"
  - "agents"
---

# Enterprise-Level Telemetry for Azure OpenAI Model Applications

## Table of Contents
1. [Introduction to Enterprise AI Observability](#introduction-to-enterprise-ai-observability)
2. [Architecture Overview](#architecture-overview)
3. [Core Telemetry Components](#core-telemetry-components)
   - [OpenTelemetry Instrumentation](#opentelemetry-instrumentation)
   - [Azure Monitor Integration](#azure-monitor-integration)
   - [Application Insights Configuration](#application-insights-configuration)
4. [Agent-Specific Telemetry](#agent-specific-telemetry)
5. [RAG System Monitoring](#rag-system-monitoring)
6. [Safety and Compliance Tracking](#safety-and-compliance-tracking)
7. [Evaluation Framework](#evaluation-framework)
8. [Implementation Guide](#implementation-guide)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)
11. [Advanced Scenarios](#advanced-scenarios)
12. [Security Considerations](#security-considerations)
13. [Cost Optimization](#cost-optimization)
14. [Future-Proofing Your Implementation](#future-proofing-your-implementation)

---

## 1. Introduction to Enterprise AI Observability

Enterprise-grade AI applications require comprehensive telemetry to ensure reliability, safety, and performance. This guide provides a complete framework for implementing observability across Azure OpenAI model applications, with special focus on:

- **Agentic workflows** (multi-step reasoning, tool usage)
- **Retrieval-Augmented Generation (RAG)** systems
- **Safety and compliance** monitoring
- **Performance optimization** through detailed tracing
- **Continuous evaluation** of AI quality metrics

The solution leverages Azure AI Foundry's integrated observability capabilities combined with OpenTelemetry standards to provide end-to-end visibility.

---

## 2. Architecture Overview

![Enterprise AI Observability Architecture](https://learn.microsoft.com/en-us/azure/ai-foundry/media/evaluations/lifecycle.png)

**Key Components:**
1. **Instrumentation Layer**: OpenTelemetry SDKs capturing spans from:
   - LLM calls and completions
   - Agent planning and execution
   - Tool invocations
   - RAG retrieval operations
   - User interactions

2. **Telemetry Pipeline**:
   - Azure Monitor for centralized logging
   - Application Insights for trace analysis
   - Custom exporters for specialized dashboards

3. **Evaluation Engine**:
   - Quality metrics (relevance, groundedness, coherence)
   - Safety metrics (content safety, protected materials)
   - Agent-specific metrics (intent resolution, tool accuracy)

4. **Observability Portal**:
   - Azure AI Foundry dashboard
   - Custom Power BI/Graphana integrations
   - Alerting systems

5. **Feedback Loop**:
   - User feedback collection
   - Continuous evaluation results
   - Model performance trends

---

## 3. Core Telemetry Components

### OpenTelemetry Instrumentation

**Setup Requirements:**
```bash
# Core dependencies
pip install azure-ai-projects azure-identity azure-monitor-opentelemetry opentelemetry-sdk

# Framework-specific instrumentations
pip install opentelemetry-instrumentation-langchain langchain-azure-ai
pip install opentelemetry-instrumentation-openai_agents
```

**Basic Configuration:**
```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter
from opentelemetry.sdk.resources import Resource

# Configure resource with service identification
resource = Resource.create({
    "service.name": "enterprise-ai-application",
    "service.version": "1.0.0",
    "deployment.environment": "production"
})

# Set up tracer provider
provider = TracerProvider(resource=resource)

# Configure exporter to Azure Monitor
exporter = AzureMonitorTraceExporter.from_connection_string(
    os.environ["APPLICATION_INSIGHTS_CONNECTION_STRING"]
)
provider.add_span_processor(BatchSpanProcessor(exporter))

# Set as global provider
trace.set_tracer_provider(provider)
```

**Environment Variables:**
```bash
# Required for Azure integration
export APPLICATION_INSIGHTS_CONNECTION_STRING="your-connection-string"
export AZURE_TRACING_GEN_AI_CONTENT_RECORDING_ENABLED="true"  # For debugging
export OTEL_SERVICE_NAME="your-service-name"
export OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production,service.version=1.0.0"
```

### Azure Monitor Integration

**Key Features:**
- End-to-end transaction tracing
- Custom metrics collection
- Log analytics integration
- Alerting capabilities

**Configuration Steps:**
1. Create Application Insights resource in Azure Portal
2. Connect to Azure AI Foundry project:
   ```python
   from azure.ai.projects import AIProjectClient
   from azure.monitor.opentelemetry import configure_azure_monitor

   project_client = AIProjectClient(
       credential=DefaultAzureCredential(),
       endpoint=os.environ["PROJECT_ENDPOINT"]
   )

   # Get connection string from project
   connection_string = project_client.telemetry.get_application_insights_connection_string()
   configure_azure_monitor(connection_string=connection_string)
   ```

3. Set up custom dashboards in Azure Portal:
   - Create workbooks for key metrics
   - Configure alerts for critical failures
   - Set up log queries for deep analysis

### Application Insights Configuration

**Recommended Queries:**

1. **Latency Analysis:**
```kusto
requests
| where cloud_RoleName == "your-service-name"
| summarize avg(duration), percentiles(duration, 50, 90, 95) by bin(timestamp, 1h)
| render timechart
```

2. **Error Rate Monitoring:**
```kusto
traces
| where message contains "exception"
| summarize count() by bin(timestamp, 1h), operation_Name
| render barchart
```

3. **Token Usage Tracking:**
```kusto
customMetrics
| where name == "llm.token.usage"
| extend promptTokens = toint(customDimensions["prompt_tokens"])
| extend completionTokens = toint(customDimensions["completion_tokens"])
| summarize sum(promptTokens), sum(completionTokens) by bin(timestamp, 1d)
```

---

## 4. Agent-Specific Telemetry

### Agent Execution Tracing

**Standard Span Types:**
| Span Type | Purpose | Key Attributes |
|-----------|---------|----------------|
| `agent_planning` | Captures agent's reasoning process | `plan_steps`, `decision_rationale` |
| `tool_invocation` | Records tool usage | `tool_name`, `parameters`, `execution_time` |
| `agent_orchestration` | Tracks multi-agent coordination | `agent_count`, `communication_protocol` |
| `memory_management` | Logs context handling | `memory_type`, `retrieval_time`, `context_size` |
| `intent_resolution` | Measures intent understanding | `user_intent`, `resolved_intent`, `confidence_score` |

**Implementation Example:**
```python
from opentelemetry import trace
from azure.ai.projects import AIProjectClient

tracer = trace.get_tracer(__name__)
project_client = AIProjectClient(
    credential=DefaultAzureCredential(),
    endpoint=os.environ["PROJECT_ENDPOINT"]
)

def execute_agent_workflow(query):
    with tracer.start_as_current_span("agent_execution") as span:
        # Create agent
        with tracer.start_as_current_span("agent_creation"):
            agent = project_client.agents.create_agent(
                model=os.environ["MODEL_DEPLOYMENT_NAME"],
                name="enterprise-agent",
                instructions="You are an enterprise-grade AI assistant"
            )
            span.set_attribute("agent.id", agent.id)

        # Create thread
        with tracer.start_as_current_span("thread_creation"):
            thread = project_client.agents.threads.create()
            span.set_attribute("thread.id", thread.id)

        # Process message
        with tracer.start_as_current_span("message_processing"):
            message = project_client.agents.messages.create(
                thread_id=thread.id,
                role="user",
                content=query
            )
            span.set_attribute("message.id", message.id)
            span.set_attribute("message.content", query)

        # Execute run
        with tracer.start_as_current_span("agent_execution"):
            run = project_client.agents.runs.create_and_process(
                thread_id=thread.id,
                agent_id=agent.id
            )
            span.set_attribute("run.id", run.id)
            span.set_attribute("run.status", run.status)

            # Add evaluation attributes
            span.set_attribute("evaluation.relevance", calculate_relevance(query, run.result))
            span.set_attribute("evaluation.groundedness", calculate_groundedness(run.result))

        return run.result
```

### Agent Evaluation Metrics

**Core Evaluators:**
1. **Intent Resolution**: Measures how well the agent understands user requests
   ```python
   from azure.ai.evaluation import IntentResolutionEvaluator

   evaluator = IntentResolutionEvaluator(
       model_config=model_config,
       threshold=3  # Minimum acceptable score
   )

   result = evaluator(
       query="What's our Q3 revenue projection?",
       response="Our Q3 revenue is projected at $12.4M based on current pipeline..."
   )
   ```

2. **Tool Call Accuracy**: Assesses proper tool selection and usage
   ```python
   from azure.ai.evaluation import ToolCallAccuracyEvaluator

   evaluator = ToolCallAccuracyEvaluator(model_config=model_config)
   result = evaluator(
       query="Pull the latest sales data from CRM",
       tool_calls=[{
           "name": "query_crm",
           "arguments": {"time_range": "last_30_days"}
       }],
       tool_definitions=[{
           "name": "query_crm",
           "description": "Retrieves sales data from CRM system",
           "parameters": {...}
       }]
   )
   ```

3. **Task Adherence**: Verifies the agent stays on task
   ```python
   from azure.ai.evaluation import TaskAdherenceEvaluator

   evaluator = TaskAdherenceEvaluator(model_config=model_config)
   result = evaluator(
       query="Generate a report on customer churn",
       response="Here's the customer churn analysis...",
       instructions="Always provide data-driven analysis with visualizations"
   )
   ```

---

## 5. RAG System Monitoring

### Retrieval Quality Metrics

**Key Evaluators:**
1. **Document Retrieval**: Measures search effectiveness
   ```python
   from azure.ai.evaluation import DocumentRetrievalEvaluator

   evaluator = DocumentRetrievalEvaluator(
       ground_truth_label_min=0,
       ground_truth_label_max=4
   )

   result = evaluator(
       retrieval_ground_truth=[...],  # Expected relevant docs
       retrieved_documents=[...]      # Actual retrieved docs
   )
   ```

2. **Retrieval Quality**: Assesses context relevance
   ```python
   from azure.ai.evaluation import RetrievalEvaluator

   evaluator = RetrievalEvaluator(model_config=model_config)
   result = evaluator(
       query="What's our return policy?",
       context="Return policy: 30 days for unused items..."
   )
   ```

3. **Groundedness**: Verifies response alignment with sources
   ```python
   from azure.ai.evaluation import GroundednessEvaluator

   evaluator = GroundednessEvaluator(model_config=model_config)
   result = evaluator(
       query="What benefits do we offer?",
       context="Our benefits include: health insurance, 401k matching...",
       response="We offer comprehensive benefits including..."
   )
   ```

### RAG Pipeline Instrumentation

```python
def rag_pipeline(query):
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("rag_execution") as span:
        # Vector search
        with tracer.start_as_current_span("vector_search"):
            vectors = embed_query(query)
            results = vector_db.query(vectors, top_k=5)
            span.set_attribute("retrieval.results_count", len(results))
            span.set_attribute("retrieval.top_k", 5)

        # Reranking
        with tracer.start_as_current_span("reranking"):
            reranked = reranker.rerank(query, results)
            span.set_attribute("reranking.method", "cross-encoder")
            span.set_attribute("reranking.top_score", reranked[0]['score'])

        # Generation
        with tracer.start_as_current_span("response_generation"):
            context = "\n".join([doc['content'] for doc in reranked[:3]])
            response = llm.generate(
                prompt=f"Answer based on context:\n{context}\n\nQuery: {query}"
            )

            # Add evaluation attributes
            span.set_attribute("evaluation.relevance", evaluate_relevance(query, response))
            span.set_attribute("evaluation.groundedness",
                              evaluate_groundedness(context, response))

        return {
            "response": response,
            "sources": reranked[:3],
            "metrics": {
                "retrieval_precision": calculate_precision(results),
                "response_quality": calculate_quality(response)
            }
        }
```

---

## 6. Safety and Compliance Tracking

### Protected Material Detection

**Configuration:**
```python
from azure.ai.content_safety import ContentSafetyClient
from azure.core.credentials import AzureKeyCredential

safety_client = ContentSafetyClient(
    endpoint=os.environ["CONTENT_SAFETY_ENDPOINT"],
    credential=AzureKeyCredential(os.environ["CONTENT_SAFETY_KEY"])
)
```

**Implementation:**
```python
def check_protected_material(text):
    tracer = trace.get_tracer(__name__)

    with tracer.start_as_current_span("content_safety_check") as span:
        try:
            # Check for protected text
            text_result = safety_client.analyze_text(
                text=text,
                categories=["ProtectedMaterialText"]
            )

            # Check for protected code
            code_result = safety_client.analyze_text(
                text=text,
                categories=["ProtectedMaterialCode"]
            )

            span.set_attribute("safety.protected_text_score",
                             text_result.categories_analysis[0].severity)
            span.set_attribute("safety.protected_code_score",
                             code_result.categories_analysis[0].severity)

            if (text_result.categories_analysis[0].severity > 2 or
                code_result.categories_analysis[0].severity > 2):
                span.set_attribute("safety.violation", True)
                span.set_attribute("safety.action", "blocked")
                return False, "Protected material detected"

            return True, "Content approved"

        except Exception as e:
            span.record_exception(e)
            span.set_attribute("safety.error", str(e))
            return False, f"Safety check failed: {str(e)}"
```

### Comprehensive Safety Evaluators

**Key Safety Checks:**
1. **Hate and Unfairness Detection**
2. **Sexual Content Detection**
3. **Violence Detection**
4. **Self-Harm Detection**
5. **Code Vulnerability Scanning**
6. **Ungrounded Attribute Detection**

**Implementation Example:**
```python
from azure.ai.evaluation import (
    HateUnfairnessEvaluator,
    SexualEvaluator,
    ViolenceEvaluator,
    SelfHarmEvaluator,
    CodeVulnerabilityEvaluator,
    UngroundedAttributesEvaluator
)


def comprehensive_safety_check(query, response):
    tracer = trace.get_tracer(__name__)
    violations = []

    with tracer.start_as_current_span("comprehensive_safety_evaluation") as span:
        # Initialize evaluators
        evaluators = {
            "hate_unfairness": HateUnfairnessEvaluator(model_config=model_config),
            "sexual": SexualEvaluator(model_config=model_config),
            "violence": ViolenceEvaluator(model_config=model_config),
            "self_harm": SelfHarmEvaluator(model_config=model_config),
            "code_vulnerability": CodeVulnerabilityEvaluator(model_config=model_config),
            "ungrounded": UngroundedAttributesEvaluator(model_config=model_config)
        }

        # Run all evaluations
        for name, evaluator in evaluators.items():
            with tracer.start_as_current_span(f"{name}_evaluation"):
                try:
                    result = evaluator(query=query, response=response)
                    span.set_attribute(f"safety.{name}_score", result[f"{name}_score"])
                    span.set_attribute(f"safety.{name}_result", result[f"{name}_result"])

                    if result[f"{name}_result"] == "fail":
                        violations.append({
                            "type": name,
                            "score": result[f"{name}_score"],
                            "reason": result[f"{name}_reason"]
                        })

                except Exception as e:
                    span.record_exception(e)
                    span.set_attribute(f"safety.{name}_error", str(e))

        # Set overall safety status
        span.set_attribute("safety.violations_count", len(violations))
        span.set_attribute("safety.violations", str(violations))
        span.set_attribute("safety.status", "safe" if not violations else "violations_found")

        return {
            "is_safe": len(violations) == 0,
            "violations": violations,
            "safety_score": calculate_overall_safety_score(evaluators)
        }
```

---

## 7. Evaluation Framework

### Continuous Evaluation System

**Evaluation Lifecycle:**
1. **Pre-Production Testing**:
   - Model benchmarking
   - Synthetic data generation
   - Adversarial testing
   - AI red teaming

2. **Production Monitoring**:
   - Real-time quality metrics
   - Safety violation detection
   - Performance degradation alerts
   - User feedback analysis

3. **Post-Incident Analysis**:
   - Root cause investigation
   - Impact assessment
   - Mitigation verification
   - Process improvement

**Implementation:**
```python
from azure.ai.evaluation import (
    RelevanceEvaluator,
    GroundednessEvaluator,
    CoherenceEvaluator,
    FluencyEvaluator,
    ResponseCompletenessEvaluator
)


class ContinuousEvaluator:
    def __init__(self, model_config):
        self.evaluators = {
            "relevance": RelevanceEvaluator(model_config=model_config, threshold=3),
            "groundedness": GroundednessEvaluator(model_config=model_config, threshold=3),
            "coherence": CoherenceEvaluator(model_config=model_config, threshold=3),
            "fluency": FluencyEvaluator(model_config=model_config, threshold=3),
            "completeness": ResponseCompletenessEvaluator(model_config=model_config, threshold=3)
        }
        self.safety_evaluator = ComprehensiveSafetyEvaluator(model_config)
        self.agent_evaluators = {
            "intent": IntentResolutionEvaluator(model_config=model_config, threshold=3),
            "tool_accuracy": ToolCallAccuracyEvaluator(model_config=model_config, threshold=3),
            "task_adherence": TaskAdherenceEvaluator(model_config=model_config, threshold=3)
        }

    def evaluate_interaction(self, query, response, context=None, tool_calls=None):
        tracer = trace.get_tracer(__name__)
        results = {}

        with tracer.start_as_current_span("continuous_evaluation") as span:
            # Quality evaluations
            for name, evaluator in self.evaluators.items():
                with tracer.start_as_current_span(f"{name}_evaluation"):
                    try:
                        kwargs = {"query": query, "response": response}
                        if name == "groundedness" and context:
                            kwargs["context"] = context

                        result = evaluator(**kwargs)
                        results[name] = result
                        span.set_attribute(f"quality.{name}_score", result[f"{name}"])
                        span.set_attribute(f"quality.{name}_result", result[f"{name}_result"])

                    except Exception as e:
                        span.record_exception(e)
                        span.set_attribute(f"quality.{name}_error", str(e))

            # Safety evaluation
            with tracer.start_as_current_span("safety_evaluation"):
                safety_result = self.safety_evaluator.evaluate(query, response)
                results["safety"] = safety_result
                span.set_attribute("safety.status", safety_result["status"])
                span.set_attribute("safety.violations", len(safety_result["violations"]))

            # Agent-specific evaluations (if applicable)
            if tool_calls:
                with tracer.start_as_current_span("agent_evaluation"):
                    for name, evaluator in self.agent_evaluators.items():
                        with tracer.start_as_current_span(f"agent_{name}_evaluation"):
                            try:
                                kwargs = {"query": query}
                                if name == "tool_accuracy":
                                    kwargs["tool_calls"] = tool_calls
                                elif name in ["intent", "task_adherence"]:
                                    kwargs["response"] = response

                                result = evaluator(**kwargs)
                                results[f"agent_{name}"] = result
                                span.set_attribute(f"agent.{name}_score", result[f"{name}"])
                                span.set_attribute(f"agent.{name}_result", result[f"{name}_result"])

                            except Exception as e:
                                span.record_exception(e)
                                span.set_attribute(f"agent.{name}_error", str(e))

            # Calculate overall score
            overall_score = self._calculate_overall_score(results)
            span.set_attribute("evaluation.overall_score", overall_score)
            span.set_attribute("evaluation.status",
                              "pass" if overall_score >= 0.8 else "fail")

            return {
                "detailed_results": results,
                "overall_score": overall_score,
                "status": "pass" if overall_score >= 0.8 else "fail",
                "timestamp": datetime.utcnow().isoformat()
            }

    def _calculate_overall_score(self, results):
        # Weighted scoring based on evaluation importance
        weights = {
            "relevance": 0.25,
            "groundedness": 0.2,
            "coherence": 0.15,
            "fluency": 0.1,
            "completeness": 0.1,
            "safety": 0.2  # Safety has highest weight
        }

        score = 0
        total_weight = 0

        # Quality metrics
        for name, weight in weights.items():
            if name in results and f"{name}_score" in results[name]:
                score += results[name][f"{name}_score"] * weight
                total_weight += weight

        # Agent metrics (if present)
        for name in ["intent", "tool_accuracy", "task_adherence"]:
            if f"agent_{name}" in results:
                agent_score = results[f"agent_{name}"][f"{name}_score"]
                score += agent_score * 0.1  # Each agent metric gets 0.1 weight
                total_weight += 0.1

        return score / total_weight if total_weight > 0 else 0
```

### Evaluation Dashboard Integration

**Sample Power BI Integration:**
```python
def export_evaluation_metrics_to_powerbi(results):
    """
    Export evaluation results to Power BI for dashboard visualization
    """
    from powerbiclient import QuickVisualize, get_dataset_config
    from powerbiclient.authentication import DeviceCodeLoginAuthentication

    # Authenticate
    authentication = DeviceCodeLoginAuthentication()

    # Prepare data
    data = [{
        "Timestamp": results["timestamp"],
        "Overall Score": results["overall_score"],
        "Status": results["status"],
        "Relevance": results["detailed_results"]["relevance"]["relevance"],
        "Groundedness": results["detailed_results"]["groundedness"]["groundedness"],
        "Safety Status": results["detailed_results"]["safety"]["status"],
        "Safety Violations": len(results["detailed_results"]["safety"]["violations"]),
        "Query": results["query"][:100],  # Truncate long queries
        "Response Length": len(results["response"])
    }]

    # Visualize
    viz = QuickVisualize(get_dataset_config(data), auth=authentication)
    viz.visualize()
```

---

## 8. Implementation Guide

### Step 1: Environment Setup

**Prerequisites:**
1. Azure subscription with:
   - Azure AI Foundry
   - Application Insights
   - Azure OpenAI
   - Azure AI Content Safety

2. Python environment (3.9+):
```bash
python -m venv ai-observability-env
source ai-observability-env/bin/activate  # Linux/Mac
# or
.\ai-observability-env\Scripts\activate   # Windows
```

3. Install core packages:
```bash
pip install azure-ai-projects azure-identity azure-monitor-opentelemetry
pip install opentelemetry-sdk opentelemetry-exporter-otlp
pip install azure-ai-evaluation azure-ai-content-safety
```

### Step 2: Basic Instrumentation

**Minimal Viable Instrumentation:**
```python
# config.py
import os
from azure.identity import DefaultAzureCredential
from azure.monitor.opentelemetry.exporter import AzureMonitorTraceExporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry import trace


def setup_telemetry():
    # Configure tracer provider
    provider = TracerProvider()

    # Set up Azure Monitor exporter
    exporter = AzureMonitorTraceExporter.from_connection_string(
        os.environ["APPLICATION_INSIGHTS_CONNECTION_STRING"]
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))

    # Set as global provider
    trace.set_tracer_provider(provider)

    return trace.get_tracer(__name__)

# Initialize in your main application
from config import setup_telemetry
tracer = setup_telemetry()
```

### Step 3: Agent Instrumentation

**Complete Agent Tracing Example:**
```python
from azure.ai.projects import AIProjectClient
from opentelemetry import trace


class InstrumentedAgent:
    def __init__(self):
        self.project_client = AIProjectClient(
            credential=DefaultAzureCredential(),
            endpoint=os.environ["PROJECT_ENDPOINT"]
        )
        self.tracer = trace.get_tracer(__name__)

    def create_agent(self, name, instructions, model):
        with self.tracer.start_as_current_span("agent_creation") as span:
            try:
                agent = self.project_client.agents.create_agent(
                    name=name,
                    instructions=instructions,
                    model=model
                )
                span.set_attribute("agent.id", agent.id)
                span.set_attribute("agent.name", agent.name)
                span.set_attribute("agent.model", model)
                return agent
            

#### Sources:

[^1]: [[Azure AI Agents client library for Python]]
[^2]: [[tool-usage-analytics-guru-profile]]
[^3]: [[Quickstart Agentic Retrieval - Azure AI Search]]
[^4]: [[Quickstart Agentic Retrieval - Azure AI Search 1]]
[^5]: [[Build an agentic retrieval solution - Azure AI Search]]
[^6]: [[Deep Research API with the Agents SDK  OpenAI Cookbook]]
[^7]: [[azure-mcp TROUBLESHOOTING Guide]]
[^8]: [[Azure OpenAI Responses API - Azure OpenAI]]
[^9]: [[KnowledgeAgents]]
[^10]: [[Codex with Azure OpenAI in AI Foundry Models 1]]
[^11]: [[Codex with Azure OpenAI in AI Foundry Models]]
[^12]: [[Azure AI Search Python Sample Quickstart Agentic Retrieval]]
[^13]: [[What is Azure OpenAI in Azure AI Foundry Models]]
[^14]: [[Unified Agentic Context and Prompt Framework]]
