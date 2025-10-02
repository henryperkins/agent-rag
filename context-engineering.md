## Evolving Strategies for Context-Rich Agents

### 1. Treat Context as Core Infrastructure
Modern agent design starts by budgeting the context window like scarce RAM: every token must carry intent, grounding, or control information, and high-signal fragments win over verbose histories.[^1] This has shifted engineering from prompt tinkering to a pipeline mindset that sequences intent routing, retrieval, assembly, and templating as independent modules with clear contracts and observability hooks.[^2]

### 2. Four Pillars of Context Engineering
LangChain’s taxonomy crystallizes today’s playbook for managing information density:[^3]

| Strategy | Purpose | Typical Techniques |
| --- | --- | --- |
| Write | Persist state outside the prompt | Scratchpads, session files, long-term memory collections |
| Select | Pull only what matters back in | Retrieval over notes/tools, rule files (e.g., `CLAUDE.md`), semantic search |
| Compress | Shrink what must stay | Map-reduce summaries, trimming heuristics, tool-output distillation |
| Isolate | Split workloads to keep windows clean | Sub-agent routing, sandboxes, structured state objects |

### 3. Memory and Compaction Advances
Large, long-running sessions now rely on automated compaction loops—Claude Code’s “auto-compact” summarizes multi-turn histories once usage crosses thresholds, retaining architectural decisions while dropping redundant logs.[^1] Agents increasingly combine transient scratchpads for immediate reasoning with persistent memories indexed by embeddings or knowledge graphs, enabling few-shot self-demonstrations and user preference recall without bloating the active prompt.[^3]

### 4. Tooling and the Agent–Computer Interface
Anthropic’s Model Context Protocol (MCP) exemplifies the shift toward standardized tool integration, letting agents pull structured capabilities on demand while keeping schemas machine-readable.[^1] Success hinges on ACI design: tool definitions must mirror code-level APIs, include examples and edge cases, and even “poka-yoke” parameter choices so LLMs can’t select invalid combinations.[^4] Error messages are engineered as feedback signals, enabling self-correction rather than dead-ends.[^4]

### 5. Workflow Patterns as Control Surfaces
Production agents are assembled from reusable orchestration patterns:[^4]

- **Prompt chaining** to decompose tasks into validated stages.
- **Routing** to send inputs to specialized prompts or models (cost/latency-aware).
- **Parallelization** for guardrails or ensemble reasoning.
- **Orchestrator–worker loops** where a planner dynamically spawns subtasks with their own context windows.
- **Evaluator–optimizer cycles** that institutionalize self-critique before finalizing responses.

These patterns let teams dial autonomy up or down while keeping debugging tractable.

### 6. Observability and Evaluation as First-Class Citizens
Reliability now depends on full-trace logging—capturing every prompt, tool call, and memory mutation—so failures can be replayed and compared over time.[^2] Evaluation spans context precision/utilization, groundedness, and operational metrics (latency, token cost), aligning symptoms like hallucinations or loops with specific pipeline stages rather than blaming the base model.[^2]

### 7. Emerging Directions
- **Just-in-time retrieval**: agents fetch heavy artifacts (logs, tables, code) on demand via lightweight pointers, mirroring human use of file systems.[^1]
- **Hybrid autonomy**: systems preload canonical context (e.g., rule files) but let agents explore and request new data when needed, blending speed with adaptability.[^1]
- **Multi-agent ecosystems**: orchestrators coordinate focused sub-agents, each with clean windows, then synthesize their concise outputs—scaling complexity without drowning in tokens.[^2]
- **Standardization efforts**: protocols and dependency-injected modules aim to make toolsets, memories, and prompts interchangeable, reducing lock-in and easing upgrades.[^2]

Together, these advancements show the field converging on a disciplined architecture: context pipelines, modular workflows, and meticulous telemetry that transform LLMs from clever chatbots into resilient, goal-driven software components.

---


### 1. Customer-support triage with routing and guardrails
Anthropic observes that many production systems still benefit from deterministic routing flows, especially in customer-support scenarios where prompt specialization keeps costs down while guaranteeing predictable actions.[^1] The snippet below shows a minimal orchestration layer that directs tickets to different prompt templates and toolsets, then runs a lightweight guardrail in parallel before returning the final answer.

```python
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Literal

from llm import call_llm  # thin wrapper over preferred API
from tools import refund_tool, knowledge_base_search

app = FastAPI()

class SupportTicket(BaseModel):
    topic: Literal["billing", "technical", "general"]
    message: str

PROMPTS = {
    "billing": "You are a billing specialist. Resolve the issue succinctly…",
    "technical": "You are a tier-2 technical support engineer. Diagnose…",
    "general": "You are a concierge agent. Provide friendly guidance…",
}

TOOLSETS = {
    "billing": [refund_tool],
    "technical": [knowledge_base_search],
    "general": [],
}

def guardrail_check(response: str) -> bool:
    # naive profanity / policy filter; replace with enterprise guardrails
    return "FORBIDDEN" not in response

@app.post("/solve")
def solve(ticket: SupportTicket):
    system_prompt = PROMPTS[ticket.topic]
    tools = TOOLSETS[ticket.topic]

    draft = call_llm(
        system_prompt=system_prompt,
        user_message=ticket.message,
        tools=tools,
    )
    moderation_ok = guardrail_check(draft)

    if not moderation_ok:
        return {"handoff": True, "message": "Escalate to human."}

    return {"handoff": False, "response": draft}
```

This pattern keeps the workflow simple while exposing routing decisions, per Anthropic’s advice to favor transparency and minimal surface area before embracing full autonomy.[^1]

---

### 2. Memory write/select/compress in a LangGraph-style agent
LangChain’s context-engineering survey highlights “write, select, compress, isolate” as the four levers for controlling context growth in long-running sessions.[^2] The code fragment below mimics that strategy: the agent writes updates to a scratchpad, retrieves only relevant notes for the next turn, and triggers compaction once the exchange history crosses a token limit.

```python
from langgraph.graph import StateGraph, MessagesState
from langgraph.memory.summary import summarise_messages

MAX_TOKENS = 4000

def write_to_scratchpad(state: MessagesState) -> MessagesState:
    note = call_llm(
        system_prompt="Summarize the last exchange as a TODO bullet.",
        user_message="\n".join(m.content for m in state.messages[-2:]),
    )
    state.metadata.setdefault("scratchpad", []).append(note)
    return state

def select_context(state: MessagesState) -> list[str]:
    notes = state.metadata.get("scratchpad", [])
    if not notes:
        return []
    return call_llm(
        system_prompt="Pick the two notes most relevant to the next step.",
        user_message="\n".join(notes),
    ).splitlines()

def maybe_compact(state: MessagesState) -> MessagesState:
    if state.token_count() < MAX_TOKENS:
        return state
    summary = summarise_messages(state.messages)
    state.messages = state.messages[-4:]  # keep latest turns
    state.metadata.setdefault("summaries", []).append(summary)
    return state

workflow = (
    StateGraph(MessagesState)
    .add_node("scratchpad", write_to_scratchpad)
    .add_node("compaction", maybe_compact)
    .add_conditional_edges(
        start="scratchpad",
        condition=lambda state: True,
        edge_map={"summary": "compaction"},
    )
)
```

This sequence demonstrates how automation keeps the window lean without losing critical cues for future reasoning.[^2]

---

### 3. Research orchestrator with just-in-time retrieval and evaluator loop
The unified framework note describes a layered pipeline—intent analysis, retrieval/tool execution, context assembly, and step-specific prompts—plus evaluator–optimizer cycles for quality control.[^3] The example below sketches an orchestrator agent that spawns sub-agents for planning, searching, and synthesizing, persists condensed state, and asks an evaluator agent to critique the draft before publishing.

```python
from agents import planner_agent, search_agent, synthesis_agent, evaluator_agent
from store import ContextStore

store = ContextStore()  # kv store: {"plan": str, "chunks": list[str], ...}

def research(query: str) -> str:
    plan = planner_agent.run(query=query)
    store.write("plan", plan)

    documents = []
    for sub_question in plan["sub_questions"]:
        results = search_agent.run(question=sub_question)
        store.append("chunks", results)
        documents.extend(results)

    payload = store.build_context(
        plan=store.read("plan"),
        top_chunks=store.select("chunks", k=8),
    )

    draft = synthesis_agent.run(context=payload, query=query)

    critique = evaluator_agent.run(
        context=payload,
        answer=draft,
        checklist=[
            "Factual claims grounded in citations",
            "All sub-questions addressed",
            "Concise executive summary",
        ],
    )

    if critique["status"] == "needs_revision":
        draft = synthesis_agent.run(
            context=payload,
            query=query,
            revision_notes=critique["feedback"],
        )

    return draft
```

By storing just the plan and the top-ranked evidence while deferring bulk document loads until needed, the orchestrator approaches the “just-in-time” context pattern Anthropic describes, avoiding context rot during long research loops.[^1][^3]

---

### 4. Tool schema hardening for agent-computer interfaces
Anthropic stresses that tool definitions should read like high-quality API docs, with explicit parameter contracts and examples to minimize ambiguity.[^1] The following JSON Schema (usable in MCP, LangGraph, or OpenAI tool definitions) applies poka-yoke ideas by constraining parameter formats and clarifying usage.

```json
{
  "name": "create_refund",
  "description": "Issue a partial or full refund to the customer. Use only after verifying billing policy compliance.",
  "parameters": {
    "type": "object",
    "properties": {
      "order_id": {
        "type": "string",
        "pattern": "^ORD-[0-9]{6}$",
        "description": "Order identifier in the format ORD-######."
      },
      "amount": {
        "type": "number",
        "minimum": 0.01,
        "description": "Refund amount in USD. Do not exceed remaining balance."
      },
      "reason_code": {
        "type": "string",
        "enum": ["DAMAGED_ITEM", "SERVICE_FAILURE", "GOODWILL"],
        "description": "Select the closest reason from the allowed set."
      }
    },
    "required": ["order_id", "amount", "reason_code"],
    "additionalProperties": false
  },
  "examples": [
    {
      "order_id": "ORD-483920",
      "amount": 37.5,
      "reason_code": "SERVICE_FAILURE"
    }
  ]
}
```

Constraining formats and enumerations makes it harder for the model to produce invalid calls, reducing human intervention while keeping the system auditable.[^1]

---

### 5. Multi-agent code remediation with orchestrator–worker pattern
For SWE-bench-style problems, Anthropic favors a central planner that delegates to specialized workers (environment setup, patching, testing) and preserves transparency by logging each step.[^1] The snippet below illustrates a minimal orchestrator loop.

```python
from agents import (
    task_planner,
    repo_loader,
    patch_generator,
    test_runner,
    report_builder,
)

def fix_issue(issue_url: str) -> dict:
    plan = task_planner.run(issue_url=issue_url)
    repo_path = repo_loader.run(issue_url=issue_url)

    patches = []
    for step in plan["steps"]:
        patch = patch_generator.run(
            repo_path=repo_path,
            step=step,
            prior_patches=patches,
        )
        patches.append(patch)

    test_results = test_runner.run(repo_path=repo_path, patches=patches)
    report = report_builder.run(
        plan=plan,
        patches=patches,
        test_results=test_results,
    )
    return report
```

Because each worker owns its own context window, the orchestrator can assemble concise summaries (plan, patch diffs, test logs) for final reporting without overflowing the core model’s context, matching the isolation strategy described in the context-engineering survey.[^2]

---

## Summary table

| Use case | Key strategy | Outcome |
| --- | --- | --- |
| Support triage | Routing + guardrail parallelization | Specialized prompts with predictable error handling |
| Long-running task | Write/select/compress loop | Keeps active context under token limits while retaining history |
| Research agent | Orchestrator with evaluator loop | Just-in-time retrieval, quality control via auto-critique |
| Tool invocation | Poka-yoke schema design | Higher tool success rates and clearer audits |
| Coding agent | Multi-agent isolation | Transparent, scalable problem solving across repositories |

These examples turn the conceptual guidance from the notes into concrete scaffolding you can adapt for production agents.

---

### What “agentic RAG” really means
Agentic Retrieval-Augmented Generation couples classical RAG (retrieve → read → respond) with an autonomous control loop. Rather than calling a retriever once and stuffing chunks into a single prompt, the agent plans, decides when/where to fetch more evidence, critiques its own work, and iterates until the answer satisfies explicit success criteria.[^1][^2]

At a high level, you orchestrate:

1. **Plan** – Decompose the user goal into sub-questions or tasks.
2. **Gather** – For each step, decide which tools (vector search, API calls, long-term memory) to invoke and with what parameters.
3. **Reason** – Use the retrieved context plus instructions to draft intermediate or final outputs.
4. **Critique / Reflect** – Evaluate groundedness, coverage, or confidence; loop back if requirements are unmet.
5. **Record** – Persist summaries, citations, and scratchpad notes so later turns don’t overfill the window.[^2][^3]

This differs from plain RAG because retrieval is no longer a single pre-inference hook—the agent actively manages context across multiple turns, fitting with the “write, select, compress, isolate” toolbox described in LangChain’s survey.[^3]

---

### Minimal agentic RAG architecture

```
User query
   │
   ├──> Intent router / planner  ──> plan (sub-questions, tool hints)
   │
   ├──> for each step:
   │        ├── retrieval tool(s): vector DB, web, long-term memory
   │        ├── scratchpad update (write)
   │        ├── context assembler (select + compress)
   │        └── reasoning prompt (step-specific)
   │
   ├──> synthesizer (combine evidence, cite sources)
   │
   └──> evaluator / critic (groundedness, completeness). If fail → loop.
```

Key practices:

- **Step-specific prompts** keep the LLM focused (plan/search/summarize/synthesize).[^^1]
- **Context packager** enforces token budgets, prioritizes instructions/tool schemas, and compacts history when needed.[^2]
- **Scratchpads & memories** capture plans, intermediate findings, and user preferences without bloating the active prompt.[^3]
- **Evaluator-optimizer loop** catches hallucinations or missing citations before the answer ships.[^1]

---

### Example: Planner → Retrieval agent → Synthesizer → Critic

```python
from collections import defaultdict
from retrievers import semantic_search, web_search
from llm import call_llm

state = defaultdict(list)

def plan(query: str) -> list[str]:
    prompt = "Break the question into 3 atomic research tasks, JSON list."
    plan_resp = call_llm(system_prompt=prompt, user_message=query)
    tasks = parse_json(plan_resp)
    state["plan"] = tasks
    return tasks

def gather(task: str):
    vector_hits = semantic_search(task, top_k=5)
    state["chunks"].extend(vector_hits)

    if "latest" in task.lower():
        web_hits = web_search(task, top_k=3)
        state["chunks"].extend(web_hits)

    summary_prompt = "Summarize each chunk in <=60 tokens with citation ID."
    chunk_summaries = call_llm(
        system_prompt=summary_prompt,
        user_message="\n\n".join(f"[{c.id}] {c.text}" for c in state["chunks"][-8:])
    )
    state["notes"].append(chunk_summaries)

def synthesize(question: str) -> str:
    context = "\n".join(state["notes"][-3:])
    prompt = (
        "You are a research synthesizer. Answer the question using only the "
        "numbered evidence below. Cite each claim as [id]."
    )
    return call_llm(system_prompt=prompt, user_message=f"{context}\n\nQuestion: {question}")

def critique(answer: str) -> dict:
    checklist = (
        "1. Are all claims grounded in provided citations?\n"
        "2. Does it address every planned sub-question?\n"
        "3. Is it concise (<200 words)?"
    )
    critic_prompt = (
        "Act as a QA reviewer. Respond JSON: {score:0-1, issues:[], action:'accept'|'revise'}"
    )
    result = call_llm(
        system_prompt=critic_prompt,
        user_message=f"Checklist:\n{checklist}\n\nPlan:{state['plan']}\n\nAnswer:\n{answer}"
    )
    return parse_json(result)

def agentic_rag(query: str) -> str:
    for task in plan(query):
        gather(task)

    draft = synthesize(query)
    review = critique(draft)

    if review["action"] == "revise":
        revision_prompt = (
            "Improve the answer using reviewer feedback. obey citation rules."
        )
        draft = call_llm(
            system_prompt=revision_prompt,
            user_message=f"Answer:\n{draft}\n\nIssues:{review['issues']}"
        )
    return draft

final_answer = agentic_rag("Summarize the latest trends in agentic RAG research.")
```

Highlights:

- The **planner** externalizes reasoning (Plan) before retrieval.
- The **gather** step dynamically picks tools (semantic vs. web) and writes compressed notes (Write + Compress).
- The **synthesizer** consumes a curated context rather than raw chunks (Select).
- The **critic** implements an evaluator–optimizer loop; in production you could add automatic reruns or human-in-the-loop on failure.[^1][^2]

---

### Operational checklist for agentic RAG

1. **Scope the window** – Define token budgets for instructions, scratchpad, retrieved chunks, and outputs.
2. **Route & specialize** – Different question types may use different retrievers, prompt suites, or even smaller models for cost control.[^1]
3. **Instrument everything** – Log retrieval scores, token usage, latency, and groundedness to trace issues back to context assembly rather than guessing at prompt tweaks.[^2]
4. **Automate compaction** – Trigger summarization of old turns, tool results, or chunk dumps as soon as usage approaches your threshold.[^3]
5. **Persist learning** – Store successful reasoning traces or user feedback as long-term memories so future runs can “select” them as few-shot exemplars.[^3]

Nailing these steps gives you an agent that can explore, gather, and synthesize knowledge autonomously while keeping hallucinations in check—moving beyond static RAG into a resilient, production-ready research loop.

---

Below is a practical, end-to-end playbook for the five operational checklist items required to run a production-grade agentic RAG loop. Each section explains **why it matters**, walks through **step-by-step setup**, and provides **working Python snippets** you can adapt immediately.

---

## 1. Scope the window (token budgeting)
**Goal:** Prevent runaway context growth by enforcing per-component budgets before every LLM call.[^2]

### Steps
1. **Decide priority tiers:** Reserve fixed space for system prompt, tool schemas, and evaluator instructions; allocate a flexible pool for recent dialogue and retrieved evidence.
2. **Measure in tokens, not characters:** Use the tokenizer supplied by your model provider to avoid miscounts.
3. **Enforce strict budgets at runtime:** Before each call, rebuild the prompt and trim or compress sections that exceed their quota.

```python
import tiktoken

TOKEN_LIMIT = 8000
BUDGET = {
    "system": 600,
    "tools": 1200,
    "history": 1800,
    "evidence": 3600,
    "answer": 800,  # reserved for model output
}

enc = tiktoken.encoding_for_model("gpt-4o")

def tok_count(text: str) -> int:
    return len(enc.encode(text or ""))

def pack_prompt(system, tools, history, evidence):
    def fit(section, budget):
        tokens = tok_count(section)
        if tokens <= budget:
            return section
        # trim oldest lines first
        lines = section.splitlines()
        while lines and tok_count("\n".join(lines)) > budget:
            lines.pop(0)
        return "\n".join(lines)

    prompt = {
        "system": fit(system, BUDGET["system"]),
        "tools": fit("\n".join(tools), BUDGET["tools"]),
        "history": fit("\n".join(history), BUDGET["history"]),
        "evidence": fit("\n".join(evidence), BUDGET["evidence"]),
    }
    used = sum(tok_count(v) for v in prompt.values())
    assert used + BUDGET["answer"] <= TOKEN_LIMIT, "Still too large!"
    return prompt
```

This enforces Anthropic’s recommendation to treat tokens as a managed resource instead of blindly appending context.[^1][^2]

---

## 2. Route & specialize
**Goal:** Send each user request through the most appropriate retrieval stack, prompt template, and even model size for cost/performance balance.[^1][^2]

### Steps
1. **Build a lightweight intent classifier:** Few-shot LLM or a rules-based model suffices initially.
2. **Define routing table:** Map intent → prompt template, retriever(s), toolset, target model.
3. **Log the routing decision:** Necessary for debugging and later analytics.

```python
ROUTES = {
    "faq": {
        "model": "gpt-4o-mini",
        "retriever": "vector_support",
        "prompt": "prompts/faq.md",
    },
    "research": {
        "model": "gpt-4o",
        "retriever": "web_and_vector",
        "prompt": "prompts/research.md",
    },
    "escalate": {
        "action": "handoff",
    },
}

def classify_intent(question: str) -> str:
    prompt = (
        "Classify the user question:\n"
        "- faq: known support questions\n"
        "- research: needs multi-document synthesis\n"
        "- escalate: human required\n"
        "Answer with the label only."
    )
    label = call_llm(system_prompt=prompt, user_message=question).strip().lower()
    return label if label in ROUTES else "escalate"

def route(question: str):
    intent = classify_intent(question)
    config = ROUTES[intent]
    return intent, config
```

This keeps the agent simple and transparent before layering on multi-model or multi-agent complexity.[^1]

---

## 3. Instrument everything
**Goal:** Capture full traces—prompts, retrievals, tokens, latency, evaluation scores—so you can diagnose failures without guesswork.[^2]

### Steps
1. **Wrap every LLM call:** Log input sections, token counts, timing, model ID.
2. **Trace retrievals:** Store k, scores, context IDs for each tool invocation.
3. **Emit evaluation metrics:** Use groundedness/answer relevance checks after each run.
4. **Persist structured logs:** JSONL or a tracing platform (e.g., LangSmith) works well.

```python
import time, json

def traced_llm_call(name, **kwargs):
    start = time.time()
    response = call_llm(**kwargs)
    duration = time.time() - start

    log = {
        "name": name,
        "model": kwargs.get("model"),
        "prompt_sections": {k: kwargs.get(k) for k in ["system_prompt", "user_message"]},
        "tokens_in": tok_count(kwargs.get("system_prompt", "")) +
                     tok_count(kwargs.get("user_message", "")),
        "tokens_out": tok_count(response),
        "latency_ms": round(duration * 1000, 2),
    }
    with open("runs.jsonl", "a") as f:
        f.write(json.dumps(log) + "\n")

    return response
```

Pair this with post-run metrics (e.g., LLM-as-judge groundedness) to tie hallucinations or loops back to context decisions.[^2]

---

## 4. Automate compaction
**Goal:** Summarize or prune context automatically when usage nears your budget, preserving critical details (decisions, citations, open TODOs).[^3]

### Steps
1. **Define a trigger:** e.g., when history tokens exceed 70% of their allotment.
2. **Choose compaction strategy:** recursive summarization, map-reduce, or tool-specific compression.
3. **Insert synthetic messages:** Many teams add a “memory user/assistant pair” summarizing prior turns.
4. **Flag compaction events:** Transparency matters; log them for debugging.

```python
SUMMARY_PROMPT = (
    "Summarize previous discussion as bullet TODOs, include unresolved questions, "
    "cite chunk IDs if mentioned."
)

def auto_compact(state):
    history_tokens = sum(tok_count(msg.content) for msg in state.history)
    if history_tokens < 0.7 * BUDGET["history"]:
        return state

    summary = call_llm(system_prompt=SUMMARY_PROMPT,
                       user_message="\n\n".join(m.content for m in state.history))

    state.history = state.history[-4:]  # keep most recent exchange
    state.history.append(
        Message(role="user", content="Memory summary of earlier discussion.")
    )
    state.history.append(
        Message(role="assistant", content=summary)
    )
    state.metadata.setdefault("events", []).append({"compacted": True})
    return state
```

This mirrors production systems like Claude Code’s “auto-compact,” ensuring the agent doesn’t drown in stale logs.[^3]

---

## 5. Persist learning (long-term memory)
**Goal:** Capture durable insights—user preferences, successful solutions, reusable examples—outside the live context, then selectively retrieve them later.[^3]

### Steps
1. **Define memory schema:** Distinguish episodic (per interaction), semantic (facts), procedural (how-to).
2. **Store with metadata:** Timestamp, source, tags, embedding for semantic recall.
3. **Retrieve selectively:** Use similarity search plus filters (e.g., same user, same task type).
4. **Audit and refresh:** Periodically clean or prune outdated memories.

```python
from datetime import datetime
import sqlite3

conn = sqlite3.connect("memory.db")
conn.execute("""
CREATE TABLE IF NOT EXISTS memories(
    id INTEGER PRIMARY KEY,
    embedding BLOB,
    text TEXT,
    type TEXT,
    tags TEXT,
    created_at TEXT
)
""")

def add_memory(text, m_type, tags=None):
    embedding = embed_model.embed(text)
    conn.execute(
        "INSERT INTO memories(embedding, text, type, tags, created_at) VALUES (?, ?, ?, ?, ?)",
        (embedding, text, m_type, ",".join(tags or []), datetime.utcnow().isoformat()),
    )
    conn.commit()

def recall_memories(query, k=3):
    query_emb = embed_model.embed(query)
    rows = conn.execute("SELECT text, type FROM memories").fetchall()
    scored = [
        (cosine_similarity(query_emb, row[0]), row[1], row[0])
        for row in rows
    ]
    scored.sort(reverse=True)
    return [text for _, _, text in scored[:k]]
```

Integrating this into the agent’s retrieval step lets you inject proven tactics or personalized notes right before generation instead of re-deriving them each session.[^3]

---

### Putting it all together
1. **Initialize** the context budget and compaction rules (Section 1 + 4).
2. **Classify** each query and choose the right pipeline branch (Section 2).
3. **Collect telemetry** for every plan → gather → synthesize → critique loop (Section 3).
4. **Summarize** older history automatically to keep the agent sharp (Section 4).
5. **Save and reuse** long-term memories to improve future runs without bloating context (Section 5).

Following these steps brings you from a naïve “retrieve-then-prompt” implementation to a resilient agentic RAG service that plans, routes, monitors, and learns with minimal hallucination risk.
