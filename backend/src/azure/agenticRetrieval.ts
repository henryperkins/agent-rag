import { DefaultAzureCredential } from '@azure/identity';
import type { AgentMessage, AgenticRetrievalResponse, Reference } from '../../../shared/types.js';

export interface TargetIndexParameters {
  rerankerThreshold?: number;
  maxDocuments?: number;
  includeReferenceSourceData?: boolean;
}

export interface AgenticRetrievalParams {
  searchEndpoint: string;
  apiVersion: string;
  agentName: string;
  indexName: string;
  messages: AgentMessage[];
  apiKey?: string;
  targetIndexParameters?: TargetIndexParameters;
}

export async function runAgenticRetrieval(params: AgenticRetrievalParams): Promise<AgenticRetrievalResponse> {
  const {
    searchEndpoint,
    apiVersion,
    agentName,
    indexName,
    messages,
    apiKey,
    targetIndexParameters = {}
  } = params;

  const {
    rerankerThreshold = 2.5,
    maxDocuments = 100,
    includeReferenceSourceData = true
  } = targetIndexParameters;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (apiKey) {
    headers['api-key'] = apiKey;
  } else {
    const credential = new DefaultAzureCredential();
    const tokenResponse = await credential.getToken('https://search.azure.com/.default');
    if (!tokenResponse?.token) {
      throw new Error('Failed to obtain Azure Search token for authentication');
    }
    headers.Authorization = `Bearer ${tokenResponse.token}`;
  }

  const agentMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: [{ type: 'text' as const, text: m.content }]
    }));

  const url = `${searchEndpoint}/agents/${agentName}/retrieve?api-version=${apiVersion}`;

  const payloadVariants = [
    () => ({
      messages: agentMessages,
      targetIndexes: [
        {
          name: indexName,
          parameters: {
            rerankerThreshold,
            maxDocuments,
            includeReferenceSourceData
          }
        }
      ]
    }),
    () => ({
      messages: agentMessages,
      target_indexes: [
        {
          name: indexName,
          parameters: {
            reranker_threshold: rerankerThreshold,
            max_documents: maxDocuments,
            include_reference_source_data: includeReferenceSourceData
          }
        }
      ]
    })
  ];

  let data: any | undefined;
  let lastError: Error | undefined;

  for (const variant of payloadVariants) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(variant())
    });

    if (response.ok) {
      data = await response.json();
      break;
    }

    const errorText = await response.text();
    lastError = new Error(`Retrieval failed: ${response.status} ${response.statusText} - ${errorText}`);

    if (response.status !== 400) {
      break;
    }
  }

  if (!data) {
    throw lastError ?? new Error('Knowledge agent retrieval failed.');
  }

  let responseText = '';
  if (typeof data.response === 'string') {
    responseText = data.response;
  } else if (Array.isArray(data.response)) {
    responseText = data.response
      .map((item: any) => {
        if (item?.content && Array.isArray(item.content)) {
          return item.content.map((c: any) => c.text ?? '').join('\n');
        }
        return '';
      })
      .join('\n');
  } else if (typeof data.output === 'string') {
    responseText = data.output;
  } else if (Array.isArray(data.output)) {
    responseText = data.output
      .map((item: any) => {
        if (item?.content && Array.isArray(item.content)) {
          return item.content.map((c: any) => c.text ?? '').join('\n');
        }
        return '';
      })
      .join('\n');
  }

  const references: Reference[] = (data.references ?? []).map((ref: any, idx: number) => {
    const pageNumber = ref.pageNumber ?? ref.page_number;
    return {
      id: ref.id ?? `ref_${idx}`,
      title: ref.title ?? `Reference ${idx + 1}`,
      content: ref.content ?? ref.chunk ?? ref.page_chunk ?? '',
      chunk: ref.chunk,
      page_number: pageNumber,
      pageNumber,
      score: ref.score ?? ref['@search.score'],
      url: ref.url
    };
  });

  return {
    response: responseText,
    references,
    activity: data.activity ?? []
  };
}
