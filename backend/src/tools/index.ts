import { withRetry } from '../utils/resilience.js';
import { hybridSemanticSearch, vectorSearch } from '../azure/directSearch.js';
import { lazyHybridSearch } from '../azure/lazyRetrieval.js';
import { webSearchTool } from './webSearch.js';
import { createResponse } from '../azure/openaiClient.js';
import { config } from '../config/app.js';
import type { AgentMessage, Reference, LazyReference } from '../../../shared/types.js';
import { extractOutputText } from '../utils/openai.js';

export const toolSchemas = {
  retrieve: {
    type: 'function' as const,
    name: 'retrieve',
    description:
      'Search the knowledge base using hybrid semantic search (vector + keyword + semantic ranking).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        filter: {
          type: 'string',
          description: "Optional OData filter (e.g., \"metadata/category eq 'nasa'\")"
        },
        top: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 5
        }
      },
      required: ['query']
    }
  },
  web_search: {
    type: 'function' as const,
    name: 'web_search',
    description: 'Search the web using Google for up-to-date information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'number', default: 5 }
      },
      required: ['query']
    }
  },
  answer: {
    type: 'function' as const,
    name: 'answer',
    description: 'Generate a final answer from retrieved context with citations.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        context: { type: 'string' },
        citations: { type: 'array', items: { type: 'object' } }
      },
      required: ['question', 'context']
    }
  }
};

/**
 * Direct Azure AI Search retrieval tool
 * Uses hybrid semantic search with full control over query parameters
 */
export async function retrieveTool(args: {
  query: string;
  filter?: string;
  top?: number;
  messages?: AgentMessage[];
}) {
  const { query, filter, top } = args;

  try {
    return await withRetry('direct-search', async () => {
      try {
        // Primary: Hybrid semantic search with high threshold
        const result = await hybridSemanticSearch(query, {
          top: top || config.RAG_TOP_K,
          filter,
          rerankerThreshold: config.RERANKER_THRESHOLD,
          searchFields: ['page_chunk'],
          selectFields: ['id', 'page_chunk', 'page_number']
        });

        // If we have good results, return them
        if (result.references.length >= config.RETRIEVAL_MIN_DOCS) {
          return {
            response: '', // Not needed for orchestrator pattern
            references: result.references,
            activity: [
              {
                type: 'search',
                description: `Hybrid semantic search returned ${result.references.length} results (threshold: ${config.RERANKER_THRESHOLD})`
              }
            ]
          };
        }

        // Fallback: Lower threshold
        console.log(`Insufficient results (${result.references.length}), retrying with lower threshold`);
        const fallbackResult = await hybridSemanticSearch(query, {
          top: top || config.RAG_TOP_K,
          filter,
          rerankerThreshold: config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD,
          searchFields: ['page_chunk'],
          selectFields: ['id', 'page_chunk', 'page_number']
        });

        return {
          response: '',
          references: fallbackResult.references,
          activity: [
            {
              type: 'search',
              description: `Hybrid semantic search (fallback) returned ${fallbackResult.references.length} results (threshold: ${config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD})`
            }
          ]
        };
      } catch (semanticError) {
        // Final fallback: Pure vector search (no semantic ranking dependency)
        console.warn('Hybrid semantic search failed, falling back to pure vector search:', semanticError);
        const vectorResult = await vectorSearch(query, {
          top: top || config.RAG_TOP_K,
          filter
        });

        return {
          response: '',
          references: vectorResult.references,
          activity: [
            {
              type: 'fallback_search',
              description: `Vector-only search returned ${vectorResult.references.length} results`
            }
          ]
        };
      }
    });
  } catch (error) {
    console.error('All retrieval methods failed:', error);
    throw new Error(`Retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function lazyRetrieveTool(args: { query: string; filter?: string; top?: number }) {
  const { query, filter, top } = args;

  try {
    const result = await lazyHybridSearch({
      query,
      filter,
      top: top || config.RAG_TOP_K,
      prefetchCount: config.LAZY_PREFETCH_COUNT
    });

    const references: LazyReference[] = result.references;

    return {
      response: '',
      references: references.map((ref) => ({
        id: ref.id,
        title: ref.title,
        content: ref.content,
        page_number: ref.page_number,
        url: ref.url,
        score: ref.score
      })),
      activity: [
        {
          type: 'lazy_search',
          description: `Lazy search returned ${references.length} summaries (${result.summaryTokens} tokens)`
        }
      ],
      lazyReferences: references,
      summaryTokens: result.summaryTokens,
      mode: 'lazy' as const,
      fullContentAvailable: result.fullContentAvailable
    };
  } catch (error) {
    console.error('Lazy retrieval failed, falling back to direct search:', error);
    return retrieveTool({ query, filter, top });
  }
}

export { webSearchTool };

export async function answerTool(args: {
  question: string;
  context: string;
  citations?: Reference[];
  revisionNotes?: string[];
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
  temperature?: number;
  previousResponseId?: string;
}) {
  let userPrompt = `Question: ${args.question}\n\nContext:\n${args.context}`;
  if (args.revisionNotes && args.revisionNotes.length > 0) {
    userPrompt += `\n\nRevision guidance (address these issues):\n${args.revisionNotes.map((note, i) => `${i + 1}. ${note}`).join('\n')}`;
  }

  const systemPrompt =
    args.systemPrompt ??
    'You are a helpful assistant. Respond using only the provided context. Cite sources inline as [1], [2], etc. Say "I do not know" when the answer is not grounded.';

  const response = await createResponse({
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: userPrompt
      }
    ],
    temperature: args.temperature ?? 0.3,
    max_output_tokens: args.maxTokens ?? 600,
    model: args.model,
    textFormat: { type: 'text' },
    parallel_tool_calls: config.RESPONSES_PARALLEL_TOOL_CALLS,
    truncation: 'auto',
    store: config.ENABLE_RESPONSE_STORAGE,
    // Only send previous_response_id when storage is enabled
    ...(config.ENABLE_RESPONSE_STORAGE && args.previousResponseId ? { previous_response_id: args.previousResponseId } : {})
  });

  let answer = extractOutputText(response);
  if (!answer) {
    answer = 'I do not know.';
  }

  const responseId = (response as { id?: string } | undefined)?.id;

  return { answer, citations: args.citations ?? [], responseId };
}
