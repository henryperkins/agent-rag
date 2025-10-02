import { DefaultAzureCredential } from '@azure/identity';
import { AzureKeyCredential, SearchClient } from '@azure/search-documents';
import type { AgentMessage, AgenticRetrievalResponse, Reference } from '../../../shared/types.js';
import { config } from '../config/app.js';
import { createEmbeddings } from './openaiClient.js';

export async function fallbackVectorSearch(messages: AgentMessage[]): Promise<AgenticRetrievalResponse> {
  const credential = config.AZURE_SEARCH_API_KEY
    ? new AzureKeyCredential(config.AZURE_SEARCH_API_KEY)
    : new DefaultAzureCredential();

  const searchClient = new SearchClient<any>(
    config.AZURE_SEARCH_ENDPOINT,
    config.AZURE_SEARCH_INDEX_NAME,
    credential
  );

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMessage) {
    throw new Error('No user message found for fallback search.');
  }

  const embeddingResponse = await createEmbeddings(lastUserMessage.content);
  const queryVector = embeddingResponse.data[0].embedding;

  const searchResults = await searchClient.search(lastUserMessage.content, {
    vectorSearchOptions: {
      queries: [
        {
          kind: 'vector',
          vector: queryVector,
          kNearestNeighborsCount: config.RAG_TOP_K,
          fields: ['page_embedding_text_3_large']
        }
      ]
    },
    select: ['id', 'page_chunk', 'page_number'],
    top: config.RAG_TOP_K
  });

  const references: Reference[] = [];
  let combinedText = '';

  for await (const result of searchResults.results) {
    const doc = result.document;
    references.push({
      id: doc.id,
      title: doc.page_number ? `Page ${doc.page_number}` : doc.id,
      content: doc.page_chunk,
      page_number: doc.page_number,
      score: result.score
    });
    combinedText += `${doc.page_chunk}\n\n`;
  }

  return {
    response: combinedText.trim(),
    references,
    activity: [
      {
        type: 'fallback_search',
        description: 'Direct vector/semantic search used because Knowledge Agent retrieval was unavailable.',
        timestamp: new Date().toISOString()
      }
    ]
  };
}
