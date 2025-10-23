// backend/src/azure/adaptiveRetrieval.ts
import { createHash } from 'node:crypto';
import { hybridSemanticSearch } from './directSearch.js';
import { createResponse } from './openaiClient.js';
import { extractOutputText } from '../utils/openai.js';
import { config } from '../config/app.js';
import type { Reference } from '../../../shared/types.js';
import { getReasoningOptions } from '../config/reasoning.js';
import { embedTexts } from '../utils/embeddings.js';
import { cosineSimilarity } from '../utils/vector-ops.js';

export interface RetrievalQuality {
  diversity: number; // 0-1, semantic diversity of results
  coverage: number; // 0-1, % of query aspects covered
  freshness: number; // 0-1, temporal relevance
  authority: number; // 0-1, source credibility
}

/**
 * Calculate semantic diversity of results
 * Low diversity = redundant/duplicate results
 */
async function calculateDiversity(
  references: Reference[],
  options: { signal?: AbortSignal } = {}
): Promise<number> {
  if (references.length < 2) {
    return 1.0;
  }

  const existingEmbeddings: Array<number[] | null> = references.map((ref) => {
    const candidate = (ref as { embedding?: unknown }).embedding;
    return Array.isArray(candidate) && candidate.length ? candidate : null;
  });

  const missingIndices: number[] = [];
  const textsToEmbed: string[] = [];

  references.forEach((ref, index) => {
    if (existingEmbeddings[index]) {
      return;
    }

    const textCandidate =
      ref.content ??
      ref.chunk ??
      (typeof (ref as { summary?: unknown }).summary === 'string' ? (ref as { summary?: string }).summary : '') ??
      '';
    const trimmed = textCandidate.trim();
    if (!trimmed) {
      existingEmbeddings[index] = null;
      return;
    }

    missingIndices.push(index);
    // Truncate to reduce token cost while preserving topical signal
    textsToEmbed.push(trimmed.slice(0, 1500));
  });

  if (textsToEmbed.length > 0) {
    try {
      const generated = await embedTexts(textsToEmbed, undefined, { signal: options.signal });
      generated.forEach((vector, idx) => {
        const targetIndex = missingIndices[idx];
        existingEmbeddings[targetIndex] = vector;
      });
    } catch (error) {
      console.warn('Adaptive retrieval diversity embedding failed, falling back to neutral score:', error);
      return 0.5;
    }
  }

  const usableEmbeddings = existingEmbeddings.filter(
    (embedding): embedding is number[] => Array.isArray(embedding) && embedding.length > 0
  );

  if (usableEmbeddings.length < 2) {
    return 0.5;
  }

  let totalSimilarity = 0;
  let pairs = 0;

  for (let i = 0; i < usableEmbeddings.length; i += 1) {
    for (let j = i + 1; j < usableEmbeddings.length; j += 1) {
      totalSimilarity += cosineSimilarity(usableEmbeddings[i], usableEmbeddings[j]);
      pairs += 1;
    }
  }

  if (pairs === 0) {
    return 0.5;
  }

  return 1 - totalSimilarity / pairs;
}

/**
 * Use LLM to assess how well results cover the query
 */
async function assessCoverage(results: Reference[], query: string): Promise<number> {
  if (!results.length) return 0;

  const documentsPreview = results
    .slice(0, 5)
    .map((r, i) => `[${i + 1}] ${r.content?.slice(0, 200) ?? ''}`)
    .join('\n\n');

  try {
    const assessment = await createResponse({
      messages: [
        {
          role: 'system',
          content:
            'Rate 0.0-1.0 how well these documents cover all aspects of the question. Return only a JSON object with a "coverage" number field.',
        },
        {
          role: 'user',
          content: `Question: ${query}\n\nDocuments:\n${documentsPreview}`,
        },
      ],
      max_output_tokens: 2000, // Increased from 1000 to reduce incomplete JSON responses (GPT-5: 128K output)
      temperature: 0,
      reasoning: getReasoningOptions('adaptive'),
      textFormat: {
        type: 'json_schema',
        name: 'quality_assessment',
        schema: {
          type: 'object',
          properties: {
            coverage: { type: 'number', minimum: 0, maximum: 1 },
          },
          required: ['coverage'],
        },
      },
    });

    const parsed = JSON.parse(extractOutputText(assessment));
    return typeof parsed.coverage === 'number' ? parsed.coverage : 0.5;
  } catch (error) {
    console.warn('Coverage assessment failed:', error);
    return 0.5; // Neutral fallback
  }
}

/**
 * Assess overall retrieval quality across multiple dimensions
 */
export async function assessRetrievalQuality(
  results: Reference[],
  query: string,
  options: { signal?: AbortSignal } = {}
): Promise<RetrievalQuality> {
  const diversity = await calculateDiversity(results, options);
  const coverage = await assessCoverage(results, query);

  // Calculate authority from scores (higher reranker scores = more authoritative)
  const scores = results.map((r) => r.score).filter((s): s is number => typeof s === 'number');
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const authority = Math.min(avgScore / 3.0, 1.0); // Normalize reranker scores (typically 0-3)

  return {
    diversity,
    coverage,
    freshness: 0.5, // Placeholder - could use document timestamps
    authority,
  };
}

/**
 * Adaptive retrieval with automatic query reformulation
 * Retries with reformulated query if initial results are low quality
 */
export async function retrieveWithAdaptiveRefinement(
  query: string,
  options: {
    top?: number;
    filter?: string;
    minCoverage?: number;
    minDiversity?: number;
    signal?: AbortSignal;
  } = {},
  attempt = 1,
  maxAttempts = 3,
): Promise<{
  references: Reference[];
  quality: RetrievalQuality;
  reformulations: string[];
  attempts: Array<{ attempt: number; query: string; quality: RetrievalQuality; latency_ms?: number }>;
  initialQuality: RetrievalQuality;
}> {
  const reformulations: string[] = [];
  const attemptsInfo: Array<{ attempt: number; query: string; quality: RetrievalQuality; latency_ms?: number }> = [];

  // Execute search
  const start = Date.now();
  const results = await hybridSemanticSearch(query, {
    top: options.top ?? config.RAG_TOP_K,
    filter: options.filter,
    signal: options.signal
  });

  // Assess quality
  const quality = await assessRetrievalQuality(results.references, query, {
    signal: options.signal
  });
  const latency = Date.now() - start;
  attemptsInfo.push({ attempt, query, quality, latency_ms: latency });

  const coverageThreshold = options.minCoverage ?? 0.4;
  const diversityThreshold = options.minDiversity ?? 0.3;

  // If quality is poor and we have attempts remaining, reformulate
  const needsReformulation =
    (quality.coverage < coverageThreshold || quality.diversity < diversityThreshold) &&
    attempt < maxAttempts;

  if (needsReformulation) {
    const queryHash = createHash('sha256').update(query).digest('hex').slice(0, 12);
    console.info(
      JSON.stringify({
        event: 'adaptive_retrieval.quality_low',
        coverage: Number(quality.coverage.toFixed(3)),
        diversity: Number(quality.diversity.toFixed(3)),
        retrieved: results.references.length,
        queryHash
      })
    );

    const reformulationPrompt = await createResponse({
      messages: [
        {
          role: 'system',
          content:
            'Reformulate this search query to be more specific, keyword-rich, and improve retrieval recall. Return ONLY the reformulated query, no explanation.',
        },
        {
          role: 'user',
          content: `Original query: ${query}\n\nCurrent retrieval:\n- Coverage: ${quality.coverage.toFixed(2)} (target: >=${coverageThreshold})\n- Diversity: ${quality.diversity.toFixed(2)} (target: >=${diversityThreshold})\n- Documents retrieved: ${results.references.length}\n\nReformulate to improve retrieval quality.`,
        },
      ],
      max_output_tokens: 2000, // Increased from 1500 to avoid truncation during reformulation reasoning
      temperature: 0.3,
      reasoning: getReasoningOptions('adaptive')
    });

    const newQuery = extractOutputText(reformulationPrompt).trim();
    reformulations.push(newQuery);

    const reformulatedHash = createHash('sha256').update(newQuery).digest('hex').slice(0, 12);
    console.info(
      JSON.stringify({
        event: 'adaptive_retrieval.reformulated',
        attempt,
        queryHash,
        reformulatedHash,
        reformulations: reformulations.length + 1
      })
    );

    // Recursive retry with new query
    const next = await retrieveWithAdaptiveRefinement(newQuery, options, attempt + 1, maxAttempts);
    return {
      references: next.references,
      quality: next.quality,
      reformulations: [...reformulations, ...next.reformulations],
      attempts: [...attemptsInfo, ...next.attempts],
      initialQuality: attemptsInfo[0]?.quality ?? next.initialQuality
    };
  }

  return {
    references: results.references,
    quality,
    reformulations,
    attempts: attemptsInfo,
    initialQuality: attemptsInfo[0]?.quality ?? quality
  };
}
