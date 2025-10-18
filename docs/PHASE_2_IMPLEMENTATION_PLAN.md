# Phase 2 Implementation Plan

**Created**: October 18, 2025
**Status**: Planning
**Target Completion**: November 2025 (4 weeks)
**Related**: [audit-report-corrected.md](audit-report-corrected.md), [TODO.md](TODO.md), [ROADMAP.md](ROADMAP.md)

---

## Overview

This document provides a detailed implementation plan for completing audit action items #5-7, representing Phase 2 enhancements to the Agent-RAG system.

**Goals**:

- Reduce web API costs by 40-60% through incremental loading
- Improve answer quality by 30-40% with multi-stage synthesis
- Enable academic/research workflows with citation export

**Estimated Effort**: 2-3 weeks (1 developer)
**Expected Impact**: 50% cost reduction, enhanced UX, expanded use cases

---

## Action Item #5: Incremental Web Loading

### Objective

Implement batched web search loading that fetches results incrementally, assessing coverage before making additional API calls.

### Priority & Complexity

- **Priority**: HIGH (40-60% API call reduction)
- **Complexity**: MEDIUM (3-5 days)
- **Dependencies**: None (standalone feature)

### Technical Approach

#### Architecture

```
┌─────────────┐
│ dispatch.ts │──┐
└─────────────┘  │
                 ▼
        ┌────────────────────────┐
        │ incrementalWebSearch() │
        └────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
   ┌─────────┐      ┌──────────┐
   │ Batch 1 │      │ Assess   │
   │ (3 res) │──────▶ Coverage │
   └─────────┘      └──────────┘
                         │
                    ┌────┴────┐
                    │         │
                 enough?    more?
                    │         │
                    ▼         ▼
                 return   Batch 2
```

#### Implementation Strategy

**1. Core Module**: `backend/src/tools/incrementalWebSearch.ts`

```typescript
interface IncrementalSearchConfig {
  initialBatchSize: number; // Default: 3
  maxBatchSize: number; // Default: 10
  coverageThreshold: number; // Default: 0.7
  maxBatches: number; // Default: 3
}

interface CoverageAssessment {
  covered: boolean;
  score: number; // 0-1
  missingAspects: string[];
}

export async function incrementalWebSearch(
  query: string,
  context: string,
  config: IncrementalSearchConfig,
  emit?: EventEmitter,
): Promise<{
  results: WebSearchResult[];
  totalFetched: number;
  batchesUsed: number;
  savedCalls: number;
}> {
  const results: WebSearchResult[] = [];
  let currentOffset = 0;

  for (let batch = 1; batch <= config.maxBatches; batch++) {
    // Fetch next batch
    const batchSize = batch === 1 ? config.initialBatchSize : config.maxBatchSize;
    const newResults = await fetchWebBatch(query, currentOffset, batchSize);

    results.push(...newResults);
    currentOffset += batchSize;

    emit?.('web_batch', {
      batch,
      fetched: newResults.length,
      total: results.length,
    });

    // Assess coverage
    const assessment = await assessCoverage(query, context, results);

    emit?.('coverage_assessment', {
      batch,
      score: assessment.score,
      covered: assessment.covered,
      missing: assessment.missingAspects,
    });

    if (assessment.covered || batch === config.maxBatches) {
      const savedCalls = (config.maxBatches - batch) * config.maxBatchSize;
      return { results, totalFetched: results.length, batchesUsed: batch, savedCalls };
    }
  }

  return {
    results,
    totalFetched: results.length,
    batchesUsed: config.maxBatches,
    savedCalls: 0,
  };
}

async function assessCoverage(
  query: string,
  context: string,
  results: WebSearchResult[],
): Promise<CoverageAssessment> {
  // Use Azure OpenAI to evaluate if results cover the query
  const prompt = `Given the question "${query}" and existing context "${context.slice(0, 500)}...",
assess if these ${results.length} web results provide sufficient coverage:

${results.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join('\n')}

Return JSON with:
{
  "covered": boolean,
  "score": 0-1,
  "missingAspects": ["aspect1", "aspect2"]
}`;

  const response = await createResponse({
    input_text: [{ content: prompt }],
    textFormat: {
      type: 'json_schema',
      json_schema: CoverageAssessmentSchema,
    },
  });

  return JSON.parse(response.output_text);
}
```

**2. Integration Point**: `backend/src/orchestrator/dispatch.ts`

```typescript
// Replace current web search call
if (shouldFetchWeb) {
  const webConfig = {
    initialBatchSize: config.WEB_INCREMENTAL_INITIAL_BATCH || 3,
    maxBatchSize: config.WEB_INCREMENTAL_MAX_BATCH || 10,
    coverageThreshold: config.WEB_INCREMENTAL_COVERAGE_THRESHOLD || 0.7,
    maxBatches: config.WEB_INCREMENTAL_MAX_BATCHES || 3,
  };

  const webResult = await incrementalWebSearch(question, kbContextText, webConfig, emit);

  emit?.('activity', {
    type: 'incremental_web_search',
    description: `Fetched ${webResult.totalFetched} results in ${webResult.batchesUsed} batches (saved ${webResult.savedCalls} calls)`,
  });

  webResults = webResult.results;
}
```

**3. Configuration**: `backend/src/config/app.ts`

```typescript
// Add new env vars
WEB_INCREMENTAL_INITIAL_BATCH: z.coerce.number().default(3),
WEB_INCREMENTAL_MAX_BATCH: z.coerce.number().default(10),
WEB_INCREMENTAL_COVERAGE_THRESHOLD: z.coerce.number().default(0.7),
WEB_INCREMENTAL_MAX_BATCHES: z.coerce.number().default(3),
ENABLE_INCREMENTAL_WEB: z.coerce.boolean().default(true),
```

**4. Testing**: `backend/src/tests/incrementalWebSearch.test.ts`

```typescript
describe('Incremental Web Search', () => {
  it('should stop after initial batch if coverage met', async () => {
    // Mock high-coverage assessment
    vi.spyOn(module, 'assessCoverage').mockResolvedValue({
      covered: true,
      score: 0.85,
      missingAspects: [],
    });

    const result = await incrementalWebSearch(
      'What is Azure AI Search?',
      'Some context',
      defaultConfig,
    );

    expect(result.batchesUsed).toBe(1);
    expect(result.totalFetched).toBe(3);
    expect(result.savedCalls).toBeGreaterThan(0);
  });

  it('should fetch additional batches if coverage insufficient', async () => {
    vi.spyOn(module, 'assessCoverage')
      .mockResolvedValueOnce({ covered: false, score: 0.4, missingAspects: ['details'] })
      .mockResolvedValueOnce({ covered: true, score: 0.75, missingAspects: [] });

    const result = await incrementalWebSearch('Complex query', 'context', defaultConfig);

    expect(result.batchesUsed).toBe(2);
    expect(result.totalFetched).toBe(13); // 3 + 10
  });

  it('should respect max batches limit', async () => {
    // Always return low coverage
    vi.spyOn(module, 'assessCoverage').mockResolvedValue({
      covered: false,
      score: 0.3,
      missingAspects: ['many', 'aspects'],
    });

    const result = await incrementalWebSearch('query', 'context', {
      ...defaultConfig,
      maxBatches: 2,
    });

    expect(result.batchesUsed).toBe(2);
    expect(result.savedCalls).toBe(0); // Hit max, no savings
  });
});
```

### Files to Create/Modify

**New Files**:

- `backend/src/tools/incrementalWebSearch.ts` (~200 lines)
- `backend/src/tests/incrementalWebSearch.test.ts` (~150 lines)
- `backend/src/orchestrator/schemas.ts` - Add `CoverageAssessmentSchema`

**Modified Files**:

- `backend/src/orchestrator/dispatch.ts` - Replace web search call (~15 lines)
- `backend/src/config/app.ts` - Add 5 new config vars
- `backend/.env.example` - Document new settings
- `shared/types.ts` - Add `IncrementalWebSearchResult` type

### Acceptance Criteria

- [ ] Incremental web search fetches batches based on coverage
- [ ] Coverage assessment uses Azure OpenAI structured outputs
- [ ] Telemetry tracks batches used and calls saved
- [ ] Configuration allows tuning batch sizes and thresholds
- [ ] Unit tests achieve >80% coverage
- [ ] Integration test shows 40-60% call reduction on sample queries
- [ ] Feature flag allows A/B testing vs. full batch loading

### Risks & Mitigation

**Risk**: Coverage assessment adds latency
**Mitigation**: Limit assessment to simple prompt (<100 tokens), cache results per query

**Risk**: Over-optimization leads to insufficient results
**Mitigation**: Set conservative coverage threshold (0.7), always fetch min 3 results

### Success Metrics

- **API Call Reduction**: 40-60% fewer web API calls vs. baseline
- **Latency**: Coverage assessment adds <500ms per batch
- **Quality**: No degradation in answer coverage scores (maintain >0.8)

---

## Action Item #6: Multi-Stage Synthesis

### Objective

Implement multi-stage answer generation that extracts key points, compresses context, and synthesizes final output with improved citation precision.

### Priority & Complexity

- **Priority**: HIGH (30-40% quality improvement)
- **Complexity**: LARGE (5-7 days)
- **Dependencies**: None (standalone feature)

### Technical Approach

#### Architecture

```
┌──────────────┐
│ generateAnswer()│
└──────────────┘
       │
       ▼
┌──────────────────────┐
│ multiStageSynthesis()│
└──────────────────────┘
       │
   ┌───┴───────┬──────────┬────────────┐
   ▼           ▼          ▼            ▼
Stage 1:   Stage 2:   Stage 3:    Stage 4:
Extract    Compress   Synthesize  Refine
Key Points Context    Draft       Citations
```

#### Implementation Strategy

**1. Core Module**: `backend/src/orchestrator/multiStageSynthesis.ts`

```typescript
interface SynthesisStage {
  stage: 'extract' | 'compress' | 'synthesize' | 'refine';
  input: string;
  output: string;
  tokensUsed: number;
  latencyMs: number;
}

interface MultiStageResult {
  answer: string;
  citations: string[];
  stages: SynthesisStage[];
  totalTokens: number;
  totalLatency: number;
}

export async function multiStageSynthesis(
  question: string,
  context: string,
  references: Reference[],
  emit?: EventEmitter,
): Promise<MultiStageResult> {
  const stages: SynthesisStage[] = [];
  let totalTokens = 0;

  // Stage 1: Extract key points from context
  emit?.('synthesis_stage', { stage: 'extract', status: 'started' });
  const extractStart = Date.now();

  const keyPoints = await extractKeyPoints(question, context);

  stages.push({
    stage: 'extract',
    input: context.slice(0, 100),
    output: keyPoints.slice(0, 100),
    tokensUsed: estimateTokens(keyPoints),
    latencyMs: Date.now() - extractStart,
  });

  totalTokens += estimateTokens(keyPoints);
  emit?.('synthesis_stage', {
    stage: 'extract',
    status: 'completed',
    tokens: stages[0].tokensUsed,
  });

  // Stage 2: Compress key points to essential facts
  emit?.('synthesis_stage', { stage: 'compress', status: 'started' });
  const compressStart = Date.now();

  const compressedFacts = await compressFacts(keyPoints, question);

  stages.push({
    stage: 'compress',
    input: keyPoints.slice(0, 100),
    output: compressedFacts.slice(0, 100),
    tokensUsed: estimateTokens(compressedFacts),
    latencyMs: Date.now() - compressStart,
  });

  totalTokens += estimateTokens(compressedFacts);
  emit?.('synthesis_stage', {
    stage: 'compress',
    status: 'completed',
    tokens: stages[1].tokensUsed,
  });

  // Stage 3: Synthesize answer from compressed facts
  emit?.('synthesis_stage', { stage: 'synthesize', status: 'started' });
  const synthesizeStart = Date.now();

  const draftAnswer = await synthesizeFromFacts(question, compressedFacts, references);

  stages.push({
    stage: 'synthesize',
    input: compressedFacts.slice(0, 100),
    output: draftAnswer.answer.slice(0, 100),
    tokensUsed: estimateTokens(draftAnswer.answer),
    latencyMs: Date.now() - synthesizeStart,
  });

  totalTokens += estimateTokens(draftAnswer.answer);
  emit?.('synthesis_stage', {
    stage: 'synthesize',
    status: 'completed',
    tokens: stages[2].tokensUsed,
  });

  // Stage 4: Refine citations for precision
  emit?.('synthesis_stage', { stage: 'refine', status: 'started' });
  const refineStart = Date.now();

  const refinedAnswer = await refineCitations(draftAnswer.answer, references, compressedFacts);

  stages.push({
    stage: 'refine',
    input: draftAnswer.answer.slice(0, 100),
    output: refinedAnswer.answer.slice(0, 100),
    tokensUsed: estimateTokens(refinedAnswer.answer),
    latencyMs: Date.now() - refineStart,
  });

  totalTokens += estimateTokens(refinedAnswer.answer);
  emit?.('synthesis_stage', { stage: 'refine', status: 'completed', tokens: stages[3].tokensUsed });

  return {
    answer: refinedAnswer.answer,
    citations: refinedAnswer.citations,
    stages,
    totalTokens,
    totalLatency: stages.reduce((sum, s) => sum + s.latencyMs, 0),
  };
}

async function extractKeyPoints(question: string, context: string): Promise<string> {
  const prompt = `Extract key points from this context that are relevant to answering: "${question}"

Context:
${context}

Return a bullet list of key facts (max 10 points).`;

  const response = await createResponse({
    input_text: [{ content: prompt }],
    max_tokens: 800,
  });

  return response.output_text;
}

async function compressFacts(keyPoints: string, question: string): Promise<string> {
  const prompt = `Compress these key points into essential facts for answering: "${question}"

Key Points:
${keyPoints}

Return a concise summary (max 200 words).`;

  const response = await createResponse({
    input_text: [{ content: prompt }],
    max_tokens: 400,
  });

  return response.output_text;
}

async function synthesizeFromFacts(
  question: string,
  facts: string,
  references: Reference[],
): Promise<{ answer: string; citations: string[] }> {
  const referencesText = references.map((r, i) => `[${i + 1}] ${r.title || r.id}`).join('\n');

  const prompt = `Answer this question using only these facts. Cite sources using [1], [2], etc.

Question: ${question}

Facts:
${facts}

Available Sources:
${referencesText}

Provide a direct, concise answer with inline citations.`;

  const response = await createResponse({
    input_text: [{ content: prompt }],
    max_tokens: 600,
  });

  return {
    answer: response.output_text,
    citations: extractCitations(response.output_text),
  };
}

async function refineCitations(
  answer: string,
  references: Reference[],
  facts: string,
): Promise<{ answer: string; citations: string[] }> {
  const prompt = `Review this answer and ensure every claim has a precise citation:

Answer:
${answer}

Facts:
${facts}

References:
${references.map((r, i) => `[${i + 1}] ${r.content?.slice(0, 200)}`).join('\n')}

Return the answer with improved citation precision. Add citations where missing, remove incorrect ones.`;

  const response = await createResponse({
    input_text: [{ content: prompt }],
    max_tokens: 600,
  });

  return {
    answer: response.output_text,
    citations: extractCitations(response.output_text),
  };
}
```

**2. Integration Point**: `backend/src/orchestrator/index.ts`

```typescript
// In generateAnswer(), replace single-pass synthesis
if (config.ENABLE_MULTI_STAGE_SYNTHESIS) {
  const synthesisResult = await traced('agent.multi_stage_synthesis', async () => {
    return await multiStageSynthesis(question, contextText, retrievedReferences, emit);
  });

  const span = trace.getActiveSpan();
  span?.setAttribute('synthesis.stages', synthesisResult.stages.length);
  span?.setAttribute('synthesis.total_tokens', synthesisResult.totalTokens);
  span?.setAttribute('synthesis.total_latency_ms', synthesisResult.totalLatency);

  emit?.('multi_stage_synthesis', {
    stages: synthesisResult.stages,
    totalTokens: synthesisResult.totalTokens,
  });

  answer = synthesisResult.answer;
  responseId = 'multi-stage-' + Date.now();
} else {
  // Existing single-pass synthesis
  const answerResult = await tools.answer(/* ... */);
  answer = answerResult.answer;
  responseId = answerResult.responseId;
}
```

**3. Configuration**: `backend/src/config/app.ts`

```typescript
ENABLE_MULTI_STAGE_SYNTHESIS: z.coerce.boolean().default(false), // Feature flag
MULTI_STAGE_MAX_KEY_POINTS: z.coerce.number().default(10),
MULTI_STAGE_MAX_COMPRESSED_WORDS: z.coerce.number().default(200),
```

**4. Testing**: `backend/src/tests/multiStageSynthesis.test.ts`

```typescript
describe('Multi-Stage Synthesis', () => {
  it('should execute all 4 stages', async () => {
    const result = await multiStageSynthesis('test question', 'test context', mockReferences);

    expect(result.stages).toHaveLength(4);
    expect(result.stages[0].stage).toBe('extract');
    expect(result.stages[1].stage).toBe('compress');
    expect(result.stages[2].stage).toBe('synthesize');
    expect(result.stages[3].stage).toBe('refine');
  });

  it('should reduce token usage vs single-pass', async () => {
    const multiStage = await multiStageSynthesis('question', longContext, mockReferences);
    const singlePass = await answerTool({
      question: 'question',
      evidence: longContext,
      references: mockReferences,
    });

    // Multi-stage should use fewer tokens due to compression
    expect(multiStage.totalTokens).toBeLessThan(estimateTokens(longContext));
  });

  it('should improve citation precision', async () => {
    const result = await multiStageSynthesis('question', 'context', mockReferences);

    // Refine stage should add/correct citations
    const draftCitations = result.stages[2].output.match(/\[\d+\]/g)?.length || 0;
    const finalCitations = result.answer.match(/\[\d+\]/g)?.length || 0;

    expect(finalCitations).toBeGreaterThanOrEqual(draftCitations);
  });
});
```

### Files to Create/Modify

**New Files**:

- `backend/src/orchestrator/multiStageSynthesis.ts` (~400 lines)
- `backend/src/tests/multiStageSynthesis.test.ts` (~250 lines)

**Modified Files**:

- `backend/src/orchestrator/index.ts` - Integrate multi-stage path (~30 lines)
- `backend/src/config/app.ts` - Add 3 config vars
- `backend/.env.example` - Document settings
- `shared/types.ts` - Add `SynthesisStage` and `MultiStageResult` types

### Acceptance Criteria

- [ ] All 4 synthesis stages execute successfully
- [ ] Each stage emits telemetry events
- [ ] Token usage reduced by 30-40% vs single-pass
- [ ] Citation precision improved (measured via manual review)
- [ ] Unit tests achieve >85% coverage
- [ ] Feature flag allows A/B testing
- [ ] Latency remains acceptable (<3s total for all stages)

### Risks & Mitigation

**Risk**: Multiple LLM calls increase latency
**Mitigation**: Run stages sequentially but optimize prompts for speed; consider parallel execution for extract + compress

**Risk**: Citation refinement may introduce errors
**Mitigation**: Preserve original citations as fallback; validate against reference IDs

### Success Metrics

- **Token Reduction**: 30-40% fewer tokens vs single-pass synthesis
- **Citation Accuracy**: >90% precision (manual evaluation on 50 samples)
- **Answer Quality**: No degradation in critic scores (maintain >0.8 coverage)
- **Latency**: Total synthesis time <3 seconds

---

## Action Item #7: Citation Export

### Objective

Enable users to export citations in standard bibliographic formats (APA, MLA, Chicago, BibTeX) for academic and research workflows.

### Priority & Complexity

- **Priority**: MEDIUM (expands use cases)
- **Complexity**: MEDIUM (3-4 days)
- **Dependencies**: None (standalone feature)

### Technical Approach

#### Architecture

```
Frontend (SourcesPanel)
       │
       ▼ POST /citations/export
Backend Route
       │
       ▼
citationFormatter.ts
       │
   ┌───┴────┬────────┬────────┐
   ▼        ▼        ▼        ▼
  APA      MLA    Chicago  BibTeX
formatter formatter formatter formatter
```

#### Implementation Strategy

**1. Core Service**: `backend/src/services/citationFormatter.ts`

```typescript
import type { Reference } from '../../../shared/types.js';

export type CitationFormat = 'apa' | 'mla' | 'chicago' | 'bibtex';

interface FormatterOptions {
  includeAbstract?: boolean;
  includeUrl?: boolean;
}

export function formatCitation(
  ref: Reference,
  format: CitationFormat,
  options: FormatterOptions = {},
): string {
  switch (format) {
    case 'apa':
      return formatAPA(ref, options);
    case 'mla':
      return formatMLA(ref, options);
    case 'chicago':
      return formatChicago(ref, options);
    case 'bibtex':
      return formatBibTeX(ref, options);
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
}

export function exportBibliography(
  references: Reference[],
  format: CitationFormat,
  options: FormatterOptions = {},
): string {
  const formatted = references.map((ref) => formatCitation(ref, format, options));

  if (format === 'bibtex') {
    return formatted.join('\n\n');
  }

  return formatted.join('\n\n');
}

// APA 7th Edition
function formatAPA(ref: Reference, options: FormatterOptions): string {
  const author = ref.metadata?.author || 'Unknown Author';
  const year = ref.metadata?.year || new Date().getFullYear();
  const title = ref.title || ref.id;
  const source = ref.metadata?.source || 'Internal Knowledge Base';

  let citation = `${author} (${year}). ${title}. ${source}.`;

  if (options.includeUrl && ref.url) {
    citation += ` Retrieved from ${ref.url}`;
  }

  return citation;
}

// MLA 9th Edition
function formatMLA(ref: Reference, options: FormatterOptions): string {
  const author = ref.metadata?.author || 'Unknown Author';
  const title = ref.title || ref.id;
  const source = ref.metadata?.source || 'Internal Knowledge Base';
  const year = ref.metadata?.year || new Date().getFullYear();

  let citation = `${author}. "${title}." ${source}, ${year}.`;

  if (options.includeUrl && ref.url) {
    citation += ` <${ref.url}>`;
  }

  return citation;
}

// Chicago Manual of Style (17th Edition)
function formatChicago(ref: Reference, options: FormatterOptions): string {
  const author = ref.metadata?.author || 'Unknown Author';
  const year = ref.metadata?.year || new Date().getFullYear();
  const title = ref.title || ref.id;
  const source = ref.metadata?.source || 'Internal Knowledge Base';

  let citation = `${author}. "${title}." ${source} (${year}).`;

  if (options.includeUrl && ref.url) {
    citation += ` ${ref.url}.`;
  }

  return citation;
}

// BibTeX
function formatBibTeX(ref: Reference, options: FormatterOptions): string {
  const id = ref.id.replace(/[^a-zA-Z0-9]/g, '_');
  const author = ref.metadata?.author || 'Unknown';
  const year = ref.metadata?.year || new Date().getFullYear();
  const title = ref.title || ref.id;
  const source = ref.metadata?.source || 'Internal KB';

  const fields = [
    `  author = {${author}}`,
    `  title = {${title}}`,
    `  year = {${year}}`,
    `  note = {${source}}`,
  ];

  if (options.includeUrl && ref.url) {
    fields.push(`  url = {${ref.url}}`);
  }

  if (options.includeAbstract && ref.content) {
    const abstract = ref.content.slice(0, 200).replace(/\n/g, ' ');
    fields.push(`  abstract = {${abstract}...}`);
  }

  return `@misc{${id},\n${fields.join(',\n')}\n}`;
}
```

**2. Backend Route**: `backend/src/routes/index.ts`

```typescript
// Add export endpoint
app.post<{ Body: { citations: Reference[]; format: CitationFormat; options?: FormatterOptions } }>(
  '/citations/export',
  async (request, reply) => {
    const { citations, format, options } = request.body;

    // Validate format
    if (!['apa', 'mla', 'chicago', 'bibtex'].includes(format)) {
      return reply.code(400).send({ error: 'Invalid format. Use: apa, mla, chicago, or bibtex' });
    }

    // Validate citations array
    if (!Array.isArray(citations) || citations.length === 0) {
      return reply.code(400).send({ error: 'Citations array is required and must not be empty' });
    }

    // Generate bibliography
    const bibliography = exportBibliography(citations, format, options);

    // Set content type
    const contentType = format === 'bibtex' ? 'application/x-bibtex' : 'text/plain';
    const filename = `bibliography.${format}.txt`;

    return reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(bibliography);
  },
);
```

**3. Frontend UI**: `frontend/src/components/SourcesPanel.tsx`

```typescript
import { useState } from 'react';

export function SourcesPanel({ sources }: { sources: Reference[] }) {
  const [exportFormat, setExportFormat] = useState<'apa' | 'mla' | 'chicago' | 'bibtex'>('apa');
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await fetch('/citations/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          citations: sources,
          format: exportFormat,
          options: { includeUrl: true },
        }),
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bibliography.${exportFormat}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Citation export failed:', error);
      alert('Failed to export citations. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="sources-panel">
      <div className="sources-header">
        <h3>Sources ({sources.length})</h3>

        <div className="export-controls">
          <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value as any)}>
            <option value="apa">APA 7th</option>
            <option value="mla">MLA 9th</option>
            <option value="chicago">Chicago 17th</option>
            <option value="bibtex">BibTeX</option>
          </select>

          <button onClick={handleExport} disabled={exporting || sources.length === 0}>
            {exporting ? 'Exporting...' : 'Export Citations'}
          </button>
        </div>
      </div>

      {/* Existing sources list */}
      <div className="sources-list">{/* ... */}</div>
    </div>
  );
}
```

**4. Testing**: `backend/src/tests/citationFormatter.test.ts`

```typescript
describe('Citation Formatter', () => {
  const mockRef: Reference = {
    id: 'doc123',
    title: 'Azure AI Search Overview',
    content: 'Azure AI Search is a cloud search service...',
    score: 0.95,
    url: 'https://docs.microsoft.com/azure-search',
    metadata: {
      author: 'Microsoft',
      year: 2024,
      source: 'Microsoft Docs',
    },
  };

  it('should format APA citation correctly', () => {
    const citation = formatCitation(mockRef, 'apa', { includeUrl: true });

    expect(citation).toContain('Microsoft (2024)');
    expect(citation).toContain('Azure AI Search Overview');
    expect(citation).toContain('Microsoft Docs');
    expect(citation).toContain('https://docs.microsoft.com/azure-search');
  });

  it('should format MLA citation correctly', () => {
    const citation = formatCitation(mockRef, 'mla', { includeUrl: true });

    expect(citation).toContain('Microsoft');
    expect(citation).toContain('"Azure AI Search Overview."');
    expect(citation).toContain('Microsoft Docs, 2024');
  });

  it('should format Chicago citation correctly', () => {
    const citation = formatCitation(mockRef, 'chicago');

    expect(citation).toContain('Microsoft');
    expect(citation).toContain('"Azure AI Search Overview."');
    expect(citation).toContain('(2024)');
  });

  it('should format BibTeX citation correctly', () => {
    const citation = formatCitation(mockRef, 'bibtex', { includeAbstract: true });

    expect(citation).toContain('@misc{doc123');
    expect(citation).toContain('author = {Microsoft}');
    expect(citation).toContain('year = {2024}');
    expect(citation).toContain('abstract =');
  });

  it('should export bibliography with multiple citations', () => {
    const refs = [mockRef, { ...mockRef, id: 'doc124', title: 'Another Doc' }];
    const bibliography = exportBibliography(refs, 'apa');

    expect(bibliography).toContain('Microsoft (2024)');
    expect(bibliography).toContain('Another Doc');
    expect(bibliography.split('\n\n')).toHaveLength(2);
  });

  it('should handle missing metadata gracefully', () => {
    const incompleteRef: Reference = {
      id: 'incomplete',
      title: 'Untitled Document',
      content: 'Some content',
      score: 0.8,
    };

    const citation = formatCitation(incompleteRef, 'apa');

    expect(citation).toContain('Unknown Author');
    expect(citation).toContain(new Date().getFullYear().toString());
  });
});
```

### Files to Create/Modify

**New Files**:

- `backend/src/services/citationFormatter.ts` (~300 lines)
- `backend/src/tests/citationFormatter.test.ts` (~150 lines)

**Modified Files**:

- `backend/src/routes/index.ts` - Add `/citations/export` endpoint (~30 lines)
- `frontend/src/components/SourcesPanel.tsx` - Add export UI (~50 lines)
- `shared/types.ts` - Add `CitationFormat` and `FormatterOptions` types

### Acceptance Criteria

- [ ] Supports 4 citation formats (APA, MLA, Chicago, BibTeX)
- [ ] Export endpoint returns properly formatted bibliography
- [ ] Frontend UI allows format selection and download
- [ ] Handles missing metadata gracefully (defaults to "Unknown Author", current year)
- [ ] Unit tests achieve >85% coverage
- [ ] Manual verification of format accuracy (sample citations reviewed)
- [ ] Works with 1-100+ citations

### Risks & Mitigation

**Risk**: Citation formats may not match exact style guide rules
**Mitigation**: Provide disclaimer that citations should be reviewed; focus on common use cases

**Risk**: Missing metadata reduces citation quality
**Mitigation**: Use sensible defaults; document metadata expectations in Reference interface

### Success Metrics

- **Format Accuracy**: >90% alignment with official style guides (manual review)
- **Export Speed**: <2 seconds for 100 citations
- **User Adoption**: Track export API usage in telemetry

---

## Implementation Schedule

### Week 1: Incremental Web Loading

**Days 1-2**: Core implementation

- [ ] Create `incrementalWebSearch.ts` module
- [ ] Implement batch fetching logic
- [ ] Add coverage assessment with Azure OpenAI
- [ ] Add configuration variables

**Days 3-4**: Integration & testing

- [ ] Integrate with `dispatch.ts`
- [ ] Write unit tests (target >80% coverage)
- [ ] Write integration tests
- [ ] Add telemetry events

**Day 5**: Review & documentation

- [ ] Code review
- [ ] Update `.env.example`
- [ ] Document in IMPLEMENTATION_PROGRESS.md
- [ ] A/B testing plan

### Week 2: Multi-Stage Synthesis

**Days 1-3**: Core implementation

- [ ] Create `multiStageSynthesis.ts` module
- [ ] Implement all 4 stages (extract, compress, synthesize, refine)
- [ ] Add stage telemetry
- [ ] Add configuration variables

**Days 4-5**: Integration & testing

- [ ] Integrate with `generateAnswer()`
- [ ] Write unit tests (target >85% coverage)
- [ ] Manual quality evaluation (50 samples)
- [ ] Performance benchmarking

**Days 6-7**: Optimization & documentation

- [ ] Optimize prompts for speed
- [ ] Add feature flag and A/B testing
- [ ] Update documentation
- [ ] Code review

### Week 3: Citation Export

**Days 1-2**: Backend implementation

- [ ] Create `citationFormatter.ts` service
- [ ] Implement 4 format formatters
- [ ] Add `/citations/export` endpoint
- [ ] Write backend tests

**Day 3**: Frontend implementation

- [ ] Add export UI to SourcesPanel
- [ ] Implement download logic
- [ ] Test with various citation counts

**Days 4-5**: Testing & refinement

- [ ] Manual format verification (compare to style guides)
- [ ] Edge case testing (missing metadata, special characters)
- [ ] Cross-browser testing
- [ ] Documentation

### Week 4: Integration & Rollout

**Days 1-2**: Integration testing

- [ ] Test all 3 features together
- [ ] End-to-end testing
- [ ] Performance profiling
- [ ] Fix any integration issues

**Days 3-4**: Documentation & rollout prep

- [ ] Update ROADMAP.md
- [ ] Update TODO.md
- [ ] Update CLAUDE.md
- [ ] Create rollout plan (feature flags, monitoring)

**Day 5**: Deploy & monitor

- [ ] Deploy to production
- [ ] Monitor telemetry for errors
- [ ] Track success metrics
- [ ] User feedback collection

---

## Testing Strategy

### Unit Tests

Each feature requires comprehensive unit tests:

- **Incremental Web**: Batch logic, coverage assessment, config handling
- **Multi-Stage Synthesis**: Each stage independently, end-to-end flow
- **Citation Export**: Each format, edge cases, bibliography assembly

**Target Coverage**: >85% for all new modules

### Integration Tests

- **Incremental Web**: Full retrieval flow with real web API (mocked)
- **Multi-Stage Synthesis**: Full orchestrator flow with multi-stage enabled
- **Citation Export**: API endpoint → file download

### Manual Testing

- **Quality Assessment**: Review 50 sample answers with multi-stage synthesis
- **Format Verification**: Compare 20 citations against official style guides
- **Performance**: Measure latency impact of all features

### A/B Testing Plan

Use feature flags to enable A/B testing:

- **Control Group**: Existing single-stage synthesis, full batch web loading
- **Treatment Group**: Multi-stage synthesis, incremental web loading
- **Metrics**: Answer quality, token usage, latency, API costs

---

## Success Criteria

### Incremental Web Loading

- ✅ 40-60% reduction in web API calls
- ✅ No degradation in answer coverage
- ✅ Coverage assessment latency <500ms per batch
- ✅ All tests passing

### Multi-Stage Synthesis

- ✅ 30-40% token reduction vs single-pass
- ✅ Citation precision >90% (manual evaluation)
- ✅ Total synthesis time <3 seconds
- ✅ All tests passing

### Citation Export

- ✅ Supports 4 citation formats
- ✅ Format accuracy >90% vs style guides
- ✅ Export speed <2 seconds for 100 citations
- ✅ All tests passing

### Overall

- ✅ All 99+ tests passing (adding ~20 new tests)
- ✅ Documentation updated
- ✅ Feature flags enable safe rollout
- ✅ Telemetry tracks usage and performance
- ✅ No regressions in existing features

---

## Risks & Dependencies

### Technical Risks

1. **Multi-stage synthesis latency**: Multiple LLM calls could slow responses
   - Mitigation: Optimize prompts, consider parallel execution

2. **Coverage assessment accuracy**: May over/under-estimate coverage
   - Mitigation: Conservative thresholds, manual tuning

3. **Citation format complexity**: Style guides are nuanced
   - Mitigation: Focus on common cases, add disclaimer

### Dependencies

- **Azure OpenAI**: All features rely on Responses API availability
- **Web Search API**: Incremental loading requires stable Google API access
- **Reference metadata**: Citation export quality depends on metadata completeness

### Resource Requirements

- **Developer time**: 2-3 weeks (1 developer)
- **Testing time**: 3-4 days for manual quality assessment
- **Documentation**: 2-3 days for updates across files

---

## Rollout Plan

### Phase 1: Development (Weeks 1-3)

- Implement all 3 features behind feature flags
- Complete all testing
- Update documentation

### Phase 2: Internal Testing (Week 4, Days 1-2)

- Enable features for internal users only
- Monitor telemetry closely
- Fix any issues

### Phase 3: Gradual Rollout (Week 4, Days 3-5)

- Enable for 10% of production traffic
- Monitor metrics (API costs, quality, latency)
- Increase to 50%, then 100% if successful

### Phase 4: Post-Rollout (Ongoing)

- Continue monitoring metrics
- Collect user feedback
- Iterate on prompts and thresholds

---

## Next Steps

1. **Review & Approval**: Team review of this plan (1-2 days)
2. **Environment Setup**: Ensure Azure credits and API access (1 day)
3. **Branch Creation**: Create `phase-2-implementation` branch
4. **Start Implementation**: Begin Week 1 (Incremental Web Loading)

---

**Last Updated**: October 18, 2025
**Owner**: Development Team
**Reviewers**: Architecture, QA, Product

---

## Appendix A: Estimated Costs

### Development Costs

- **Developer time**: 3 weeks × $100/hr × 40hr = $12,000
- **Testing time**: 4 days × $100/hr × 8hr = $3,200
- **Total**: ~$15,000

### Azure API Costs (Testing)

- **Multi-stage synthesis testing**: ~50K tokens × $0.01/1K = $0.50
- **Coverage assessment testing**: ~20K tokens × $0.01/1K = $0.20
- **Total testing costs**: <$5

### Expected Savings (Post-Implementation)

- **Web API cost reduction**: 40-60% × $50/mo = **$20-30/mo saved**
- **Token cost reduction**: 30-40% × $150/mo = **$45-60/mo saved**
- **Total monthly savings**: **$65-90/mo**

**ROI**: Pays for itself in ~6 months

---

## Appendix B: Reference Documents

- [audit-report-corrected.md](audit-report-corrected.md) - Original audit findings
- [TODO.md](TODO.md) - Task tracking
- [ROADMAP.md](ROADMAP.md) - Strategic planning
- [azure-component-enhancements.md](azure-component-enhancements.md) - Azure optimization plans
- [enhancement-implementation-plan.md](enhancement-implementation-plan.md) - User feature plans
- [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) - Phase 1 tracking
