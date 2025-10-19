// backend/src/azure/adaptiveRetrieval.ts
import { hybridSemanticSearch } from './directSearch.js';
import { createResponse } from './openaiClient.js';
import { extractOutputText } from '../utils/openai.js';
import { config } from '../config/app.js';
import type { Reference } from '../../../shared/types.js';

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
function calculateDiversity(references: Reference[]): number {
  if (references.length < 2) return 1.0;

  const embeddings = references
    .map((r) => (r as any).embedding)
    .filter((emb): emb is number[] => Array.isArray(emb) && emb.length > 0);

  if (embeddings.length < 2) return 0.5;

  // Calculate pairwise cosine similarity
  let totalSimilarity = 0;
  let pairs = 0;

  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      const dotProduct = embeddings[i].reduce((sum, val, idx) => sum + val * embeddings[j][idx], 0);
      const magA = Math.sqrt(embeddings[i].reduce((sum, val) => sum + val * val, 0));
      const magB = Math.sqrt(embeddings[j].reduce((sum, val) => sum + val * val, 0));
      const similarity = dotProduct / (magA * magB);

      totalSimilarity += similarity;
      pairs++;
    }
  }

  // Low average similarity = high diversity
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
      max_output_tokens: 300, // Increased from 50 for detailed coverage analysis (GPT-5: 128K output)
      temperature: 0,
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
): Promise<RetrievalQuality> {
  const diversity = calculateDiversity(results);
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
  });

  // Assess quality
  const quality = await assessRetrievalQuality(results.references, query);
  const latency = Date.now() - start;
  attemptsInfo.push({ attempt, query, quality, latency_ms: latency });

  const coverageThreshold = options.minCoverage ?? 0.4;
  const diversityThreshold = options.minDiversity ?? 0.3;

  // If quality is poor and we have attempts remaining, reformulate
  const needsReformulation =
    (quality.coverage < coverageThreshold || quality.diversity < diversityThreshold) &&
    attempt < maxAttempts;

  if (needsReformulation) {
    console.log(
      `Retrieval quality insufficient (coverage: ${quality.coverage.toFixed(2)}, diversity: ${quality.diversity.toFixed(2)}). Reformulating query...`,
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
      max_output_tokens: 500, // Increased from 100 for better query reformulations (GPT-5: 128K output)
      temperature: 0.3,
    });

    const newQuery = extractOutputText(reformulationPrompt).trim();
    reformulations.push(newQuery);

    console.log(`Reformulated query (attempt ${attempt}): "${newQuery}"`);

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
