# Semantic Summary Evaluation Playbook

## Goal

Assemble a labeled corpus that verifies the embedding-based summary selector before turning on `ENABLE_SEMANTIC_SUMMARY` in production.

## Steps

1. **Export Telemetry**
   - Hit `/admin/telemetry` (or call `getSessionTelemetry()` in a REPL) to dump recent sessions. Each record includes the final question, answer, context budget, summaries, and critic feedback.

2. **Pick Representative Turns**
   - Choose 20–30 turns that exercised summaries (check `metadata.context_budget.summary_tokens > 0`).
   - Cover multiple intents (product explainer, troubleshooting, comparisons) and prioritize cases the critic flagged for low coverage or hallucination risk.

3. **Annotate Ideal Summaries**
   - For each turn, read the original conversation history and the stored `summaryCandidates`.
   - Label which bullets should survive selection. Suggested fixture shape:
     ```json
     {
       "sessionId": "abc",
       "turnIndex": 7,
       "question": "...",
       "summaryCandidates": [
         { "text": "...", "shouldKeep": true },
         { "text": "...", "shouldKeep": false }
       ],
       "answer": "Final answer...",
       "critic": { "coverage": 0.6, "issues": ["Missing doc"] }
     }
     ```
   - Save annotated items under `backend/src/tests/fixtures/summary-eval.json` (or similar).

4. **Automated Replay**
   - Write a Vitest that loads the fixture, runs `selectSummaryBullets(question, candidates, CONTEXT_MAX_SUMMARY_ITEMS)` with `ENABLE_SEMANTIC_SUMMARY` enabled, and compares `selected` vs. `shouldKeep`.
   - Track pass rate (percentage of turns where we keep all true positives and avoid false positives) and report any token-budget overruns.

5. **Acceptance Criteria**
   - Target ≥85% alignment between selected bullets and `shouldKeep` labels.
   - Zero cases where summary selection exceeds `CONTEXT_SUMMARY_TOKEN_CAP`.
   - Document failure cases; adjust labels or selector heuristics if necessary.

6. **Rollout**
   - Once the evaluation suite passes, set `ENABLE_SEMANTIC_SUMMARY=true` in staging `.env`, monitor telemetry (`context` events, critic coverage), then roll to production.

## Tips

- Include a few “null” examples (no relevant summary) to ensure the selector can return an empty set.
- If embeddings are noisy, try batching candidate texts by topic and embedding those slices separately to reduce API costs.
- Keep fixtures small but diverse; refresh quarterly as new conversation patterns emerge.
