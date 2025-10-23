import { createResponse } from '../azure/openaiClient.js';
import { extractOutputText, extractReasoningSummary } from '../utils/openai.js';
import { config } from '../config/app.js';
import { getReasoningOptions } from '../config/reasoning.js';
import type { Reference, WebResult } from '../../../shared/types.js';

export interface SubQuery {
  id: number;
  query: string;
  dependencies: number[];
  reasoning: string;
}

export interface ComplexityAssessment {
  complexity: number;
  needsDecomposition: boolean;
  reasoning: string;
  reasoningSummary?: string;
}

export interface DecomposedQuery {
  subQueries: SubQuery[];
  synthesisPrompt: string;
  reasoningSummary?: string;
}

const COMPLEXITY_SCHEMA = {
  type: 'json_schema' as const,
  name: 'complexity_assessment',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      complexity: { type: 'number', minimum: 0, maximum: 1 },
      needsDecomposition: { type: 'boolean' },
      reasoning: { type: 'string' }
    },
    required: ['complexity', 'needsDecomposition', 'reasoning']
  }
};

const DECOMPOSITION_SCHEMA = {
  type: 'json_schema' as const,
  name: 'query_decomposition',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      subQueries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'number' },
            query: { type: 'string' },
            dependencies: {
              type: 'array',
              items: { type: 'number' }
            },
            reasoning: { type: 'string' }
          },
          required: ['id', 'query', 'dependencies', 'reasoning']
        }
      },
      synthesisPrompt: { type: 'string' }
    },
    required: ['subQueries', 'synthesisPrompt']
  }
};

export async function assessComplexity(question: string): Promise<ComplexityAssessment> {
  const systemPrompt = `You analyze user questions for a retrieval-augmented generation system. Return JSON describing whether the question needs decomposition.
- Complex questions: multi-part, require comparisons, have temporal dependencies, or span domains.
- Simple questions: direct facts, single-step lookups, or conversational follow-ups.`;

  try {
    const response = await createResponse({
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      temperature: 0.1,
      max_output_tokens: 1500, // GPT-5 uses ~300-500 reasoning tokens before JSON payload
      textFormat: COMPLEXITY_SCHEMA,
      parallel_tool_calls: false,
      reasoning: getReasoningOptions('decomposition'),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Question: ${question}` }
      ]
    });

    const rawOutput = extractOutputText(response) || '{}';
    let parsed: any = {};

    try {
      parsed = JSON.parse(rawOutput);
    } catch (parseError) {
      console.warn('Failed to parse complexity assessment JSON:', {
        error: parseError instanceof Error ? parseError.message : String(parseError),
        rawOutput: rawOutput.slice(0, 200)
      });
      // Try to extract reasoning field with regex fallback
      const reasoningMatch = rawOutput.match(/"reasoning"\s*:\s*"([^"]+)"/);
      if (reasoningMatch) {
        parsed = { reasoning: reasoningMatch[1] };
      }
    }

    const reasoningSummary = extractReasoningSummary(response);

    return {
      complexity: typeof parsed.complexity === 'number' ? parsed.complexity : 0.3,
      needsDecomposition: Boolean(parsed.needsDecomposition),
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'Assessment unavailable',
      reasoningSummary: reasoningSummary?.join(' ')
    };
  } catch (error) {
    console.warn('Complexity assessment failed:', error);
    return {
      complexity: 0.3,
      needsDecomposition: false,
      reasoning: 'Assessment error fallback'
    };
  }
}

export async function decomposeQuery(question: string): Promise<DecomposedQuery> {
  const systemPrompt = `You break complex questions into executable sub-queries for a retrieval system.
Rules:
1. Each sub-query must be independently answerable.
2. Use dependencies to indicate execution order.
3. Number sub-queries starting from 0.
4. Keep sub-queries specific and scoped to one objective.
5. Provide synthesis instructions for combining results.`;

  try {
    const response = await createResponse({
      model: config.AZURE_OPENAI_GPT_DEPLOYMENT,
      temperature: 0.2,
      max_output_tokens: 2000, // Increased from 800 for more sub-queries (GPT-5: 128K output)
      textFormat: DECOMPOSITION_SCHEMA,
      parallel_tool_calls: false,
      reasoning: getReasoningOptions('decomposition'),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Decompose this question:\n${question}` }
      ]
    });

    const outputText = extractOutputText(response);
    const parsed = JSON.parse(outputText || '{}');
    const reasoningSummary = extractReasoningSummary(response);
    const subQueries: SubQuery[] = Array.isArray(parsed.subQueries)
      ? parsed.subQueries.map((item: any, idx: number) => ({
          id: typeof item.id === 'number' ? item.id : idx,
          query: String(item.query ?? '').trim(),
          dependencies: Array.isArray(item.dependencies)
            ? item.dependencies.map((dep: any) => Number(dep)).filter((dep: number) => Number.isFinite(dep))
            : [],
          reasoning: String(item.reasoning ?? '').trim()
        }))
      : [];

    return {
      subQueries: subQueries.length
        ? subQueries
        : [{ id: 0, query: question, dependencies: [], reasoning: 'Fallback to original question' }],
      synthesisPrompt: typeof parsed.synthesisPrompt === 'string'
        ? parsed.synthesisPrompt
        : 'Synthesize the sub-query results into a coherent answer.',
      reasoningSummary: reasoningSummary?.join(' ')
    };
  } catch (error) {
    console.error('Query decomposition failed:', error);
    return {
      subQueries: [{ id: 0, query: question, dependencies: [], reasoning: 'Decomposition fallback' }],
      synthesisPrompt: 'Answer the question directly.'
    };
  }
}

export async function executeSubQueries(
  subQueries: SubQuery[],
  tools: {
    retrieve: (args: { query: string; top?: number }) => Promise<{
      references: Reference[];
      activity: any[];
    }>;
    webSearch: (args: { query: string; count?: number }) => Promise<{
      results: WebResult[];
    }>;
  }
): Promise<Map<number, { references: Reference[]; webResults: WebResult[] }>> {
  const results = new Map<number, { references: Reference[]; webResults: WebResult[] }>();
  const completed = new Set<number>();
  const ordered = topologicalSort(subQueries);

  for (const subQuery of ordered) {
    const ready = subQuery.dependencies.every((dep) => completed.has(dep));
    if (!ready) {
      console.warn(`Skipping sub-query ${subQuery.id} due to incomplete dependencies`);
      continue;
    }

    try {
      const [retrievalResult, webResult] = await Promise.all([
        tools.retrieve({ query: subQuery.query, top: 3 }),
        tools.webSearch({ query: subQuery.query, count: 3 }).catch(() => ({ results: [] as WebResult[] }))
      ]);

      results.set(subQuery.id, {
        references: retrievalResult.references ?? [],
        webResults: webResult.results ?? []
      });
      completed.add(subQuery.id);
    } catch (error) {
      console.error(`Sub-query execution failed for ${subQuery.id}:`, error);
      results.set(subQuery.id, { references: [], webResults: [] });
      completed.add(subQuery.id);
    }
  }

  return results;
}

function topologicalSort(subQueries: SubQuery[]): SubQuery[] {
  const sorted: SubQuery[] = [];
  const visiting = new Set<number>();
  const visited = new Set<number>();

  function visit(subQuery: SubQuery) {
    if (visited.has(subQuery.id)) {
      return;
    }
    if (visiting.has(subQuery.id)) {
      throw new Error(`Circular dependency detected at sub-query ${subQuery.id}`);
    }

    visiting.add(subQuery.id);

    for (const dependencyId of subQuery.dependencies) {
      const dependency = subQueries.find((item) => item.id === dependencyId);
      if (dependency) {
        visit(dependency);
      }
    }

    visiting.delete(subQuery.id);
    visited.add(subQuery.id);
    sorted.push(subQuery);
  }

  for (const subQuery of subQueries) {
    if (!visited.has(subQuery.id)) {
      visit(subQuery);
    }
  }

  return sorted;
}
