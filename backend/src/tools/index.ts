import { withRetry } from '../utils/resilience.js';
import { runAgenticRetrieval } from '../azure/agenticRetrieval.js';
import { fallbackVectorSearch } from '../azure/fallbackRetrieval.js';
import { webSearchTool } from './webSearch.js';
import { createResponse } from '../azure/openaiClient.js';
import { config } from '../config/app.js';
import type { AgentMessage, Reference } from '../../../shared/types.js';
import { extractOutputText } from '../utils/openai.js';

export const toolSchemas = {
  agentic_retrieve: {
    type: 'function' as const,
    function: {
      name: 'agentic_retrieve',
      description: 'Retrieve grounded data using Azure AI Search Knowledge Agent (with semantic & vector search).',
      parameters: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            description: 'Conversation history for context-aware retrieval'
          }
        },
        required: ['messages']
      }
    }
  },
  web_search: {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the web using Bing for up-to-date information.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          count: { type: 'number', default: 5 }
        },
        required: ['query']
      }
    }
  },
  answer: {
    type: 'function' as const,
    function: {
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
  }
};

export async function agenticRetrieveTool(args: { messages: AgentMessage[] }) {
  try {
    return await withRetry('agentic-retrieval', async () => {
      try {
        return await runAgenticRetrieval({
          searchEndpoint: config.AZURE_SEARCH_ENDPOINT,
          apiVersion: config.AZURE_SEARCH_DATA_PLANE_API_VERSION,
          agentName: config.AZURE_KNOWLEDGE_AGENT_NAME,
          indexName: config.AZURE_SEARCH_INDEX_NAME,
          apiKey: config.AZURE_SEARCH_API_KEY,
          messages: args.messages,
          targetIndexParameters: {
            rerankerThreshold: config.RERANKER_THRESHOLD,
            maxDocuments: config.TARGET_INDEX_MAX_DOCUMENTS,
            includeReferenceSourceData: true
          }
        });
      } catch (primaryError) {
        if (config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD === config.RERANKER_THRESHOLD) {
          throw primaryError;
        }

        return await runAgenticRetrieval({
          searchEndpoint: config.AZURE_SEARCH_ENDPOINT,
          apiVersion: config.AZURE_SEARCH_DATA_PLANE_API_VERSION,
          agentName: config.AZURE_KNOWLEDGE_AGENT_NAME,
          indexName: config.AZURE_SEARCH_INDEX_NAME,
          apiKey: config.AZURE_SEARCH_API_KEY,
          messages: args.messages,
          targetIndexParameters: {
            rerankerThreshold: config.RETRIEVAL_FALLBACK_RERANKER_THRESHOLD,
            maxDocuments: config.TARGET_INDEX_MAX_DOCUMENTS,
            includeReferenceSourceData: true
          }
        });
      }
    });
  } catch (error) {
    console.warn('Knowledge Agent retrieval failed; switching to fallback search.');
    return await fallbackVectorSearch(args.messages);
  }
}

export { webSearchTool };

export async function answerTool(args: { question: string; context: string; citations?: Reference[] }) {
  const response = await createResponse({
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant. Respond using only the provided context. Cite sources inline as [1], [2], etc. Say "I do not know" when the answer is not grounded.'
      },
      {
        role: 'user',
        content: `Question: ${args.question}\n\nContext:\n${args.context}`
      }
    ],
    temperature: 0.3,
    max_output_tokens: 600,
    textFormat: { type: 'text' },
    parallel_tool_calls: false
  });

  let answer = extractOutputText(response);
  if (!answer) {
    answer = 'I do not know.';
  }

  return { answer, citations: args.citations ?? [] };
}
