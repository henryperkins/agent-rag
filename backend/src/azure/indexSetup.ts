import { config } from '../config/app.js';
import { createEmbeddings } from './openaiClient.js';
import { performSearchRequest } from './searchHttp.js';

const SAMPLE_DATA_URL =
  'https://raw.githubusercontent.com/Azure-Samples/azure-search-sample-data/refs/heads/main/nasa-e-book/earth-at-night-json/documents.json';

const formatODataResourceUrl = (resource: string, key: string, apiVersion: string, pathSuffix = ''): string => {
  const encodedKey = encodeURIComponent(key);
  const normalizedSuffix = pathSuffix ? (pathSuffix.startsWith('/') ? pathSuffix : `/${pathSuffix}`) : '';
  return `${config.AZURE_SEARCH_ENDPOINT}/${resource}('${encodedKey}')${normalizedSuffix}?api-version=${apiVersion}`;
};

interface RawDocument {
  id?: string;
  page_chunk?: string;
  content?: string;
  page_number?: number;
  [key: string]: any;
}

interface ProcessedDocument {
  id: string;
  page_chunk: string;
  page_embedding_text_3_large: number[];
  page_number: number;
}

interface UploadResult {
  value?: Array<{
    status?: boolean;
    statusCode?: number;
    errorMessage?: string;
    key?: string;
  }>;
}

export async function createIndexAndIngest(): Promise<void> {
  const indexDefinition = {
    name: config.AZURE_SEARCH_INDEX_NAME,
    fields: [
      {
        name: 'id',
        type: 'Edm.String',
        key: true,
        filterable: true,
        sortable: true,
        facetable: true
      },
      {
        name: 'page_chunk',
        type: 'Edm.String',
        searchable: true,
        analyzer: 'standard.lucene'
      },
      {
        name: 'page_embedding_text_3_large',
        type: 'Collection(Edm.Single)',
        searchable: true,
        dimensions: 3072,
      vectorSearchProfile: 'hnsw_profile'
      },
      {
        name: 'page_number',
        type: 'Edm.Int32',
        filterable: true,
        sortable: true,
        facetable: true
      }
    ],
    vectorSearch: {
      algorithms: [
        {
          name: 'hnsw_algorithm',
          kind: 'hnsw',
          hnswParameters: {
            metric: 'cosine',
            m: 4,
            efConstruction: 400,
            efSearch: 500
          }
        }
      ],
      // Enable scalar quantization compression and reference it from the profile
      compressions: [
        {
          name: 'sq_config',
          kind: 'scalarQuantization',
          rescoringOptions: {
            enableRescoring: true,
            defaultOversampling: 2,
            rescoreStorageMethod: 'preserveOriginals'
          },
          scalarQuantizationParameters: {
            quantizedDataType: 'int8'
          }
        }
      ],
      profiles: [
        {
          name: 'hnsw_profile',
          algorithm: 'hnsw_algorithm',
          vectorizer: 'openai_vectorizer',
          compression: 'sq_config'
        }
      ],
      vectorizers: [
        {
          name: 'openai_vectorizer',
          kind: 'azureOpenAI',
          azureOpenAIParameters: {
            resourceUri: config.AZURE_OPENAI_EMBEDDING_ENDPOINT || config.AZURE_OPENAI_ENDPOINT,
            deploymentId: config.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
            modelName: 'text-embedding-3-large',
            authIdentity: null
          }
        }
      ]
    },
    semantic: {
      defaultConfiguration: 'default',
      configurations: [
        {
          name: 'default',
          prioritizedFields: {
            prioritizedContentFields: [{ fieldName: 'page_chunk' }]
          }
        }
      ]
    }
  };

  // Use REST API directly with the specified API version
  const indexUrl = formatODataResourceUrl(
    'indexes',
    config.AZURE_SEARCH_INDEX_NAME,
    config.AZURE_SEARCH_DATA_PLANE_API_VERSION
  );

  try {
    await performSearchRequest('create-index', indexUrl, {
      method: 'PUT',
      body: indexDefinition
    });
  } catch (error: any) {
    const message = error?.message ?? '';
    const compressionConflict = /Cannot\s+add\s+compression\s+to\s+a\s+field/i.test(message);
    if (!compressionConflict) {
      throw error;
    }

    console.warn(
      JSON.stringify({
        event: 'azure.search.request.fallback',
        operation: 'create-index',
        reason: 'vector-compression-conflict',
        detail: message
      })
    );

    const fallbackDefinition = JSON.parse(JSON.stringify(indexDefinition));
    if (fallbackDefinition.vectorSearch?.compressions) {
      delete fallbackDefinition.vectorSearch.compressions;
    }
    fallbackDefinition.vectorSearch?.profiles?.forEach((profile: any) => {
      if (profile?.compression) {
        delete profile.compression;
      }
    });

    await performSearchRequest('create-index-without-compression', indexUrl, {
      method: 'PUT',
      body: fallbackDefinition
    });
  }

  const response = await fetch(SAMPLE_DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch sample data: ${response.status} ${response.statusText}`);
  }
  const rawDocs = (await response.json()) as RawDocument[];

  const batchSize = 10;
  const embeddedDocs: ProcessedDocument[] = [];

  for (let i = 0; i < rawDocs.length; i += batchSize) {
    const batch = rawDocs.slice(i, i + batchSize);
    const texts = batch.map((doc) => doc.page_chunk || doc.content || '');

    const embeddingResponse = await createEmbeddings(texts);
    const embeddings = embeddingResponse.data.map((item) => item.embedding);

    const processedBatch: ProcessedDocument[] = batch.map((doc, idx) => ({
      id: doc.id || `doc_${i + idx + 1}`,
      page_chunk: texts[idx],
      page_embedding_text_3_large: embeddings[idx],
      page_number: doc.page_number ?? i + idx + 1
    }));

    embeddedDocs.push(...processedBatch);

    if (i + batchSize < rawDocs.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const uploadBatchSize = 100;
  const uploadUrl = formatODataResourceUrl(
    'indexes',
    config.AZURE_SEARCH_INDEX_NAME,
    config.AZURE_SEARCH_DATA_PLANE_API_VERSION,
    '/docs/index'
  );

  for (let i = 0; i < embeddedDocs.length; i += uploadBatchSize) {
    const uploadBatch = embeddedDocs.slice(i, i + uploadBatchSize);

    const uploadPayload = {
      value: uploadBatch.map(doc => ({
        '@search.action': 'mergeOrUpload',
        ...doc
      }))
    };

    const batchNumber = Math.floor(i / uploadBatchSize) + 1;
    const { response: uploadResponse } = await performSearchRequest(
      `upload-documents-batch-${batchNumber}`,
      uploadUrl,
      {
        method: 'POST',
        body: uploadPayload
      }
    );

    const result = (await uploadResponse.json()) as UploadResult;
    const failures = result.value?.filter(
      (record) =>
        record.status === false || (record.statusCode !== undefined && record.statusCode !== 200 && record.statusCode !== 201)
    );
    if (failures && failures.length > 0) {
      const message = failures
        .map((record) => record.errorMessage || `Key: ${record.key}, StatusCode: ${record.statusCode}`)
        .join('; ');
      throw new Error(`One or more documents failed to ingest: ${message}`);
    }
  }
}

export async function createKnowledgeAgent(): Promise<void> {
  // Step 1: Create knowledge source
  const knowledgeSourceNameSanitized = config.AZURE_SEARCH_INDEX_NAME
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  const knowledgeSourceName = knowledgeSourceNameSanitized.length >= 2
    ? knowledgeSourceNameSanitized
    : `${config.AZURE_SEARCH_INDEX_NAME.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60) || 'knowledge-source'}-ks`;
  const knowledgeSourceUrl = formatODataResourceUrl('knowledgesources', knowledgeSourceName, config.AZURE_SEARCH_DATA_PLANE_API_VERSION);

  const knowledgeSourceDefinition = {
    name: knowledgeSourceName,
    kind: 'searchIndex',
    description: 'Knowledge source for Earth at Night index',
    searchIndexParameters: {
      searchIndexName: config.AZURE_SEARCH_INDEX_NAME
    }
  };

  await performSearchRequest('create-knowledge-source', knowledgeSourceUrl, {
    method: 'PUT',
    body: knowledgeSourceDefinition
  });

  // Step 2: Create agent
  const agentResourceName = config.AZURE_KNOWLEDGE_AGENT_NAME;
  const managementUrl = formatODataResourceUrl('agents', agentResourceName, config.AZURE_SEARCH_MANAGEMENT_API_VERSION);

  const agentProperties = {
    description: 'Knowledge agent for Earth at Night dataset',
    models: [
      {
        kind: 'azureOpenAI',
        azureOpenAIParameters: {
          resourceUri: config.AZURE_OPENAI_ENDPOINT,
          deploymentId: config.AZURE_OPENAI_GPT_DEPLOYMENT,
          modelName: config.AZURE_OPENAI_GPT_MODEL_NAME,
          apiKey: config.AZURE_OPENAI_API_KEY
        }
      }
    ],
    knowledgeSources: [
      {
        name: knowledgeSourceName,
        includeReferences: true,
        includeReferenceSourceData: true,
        // Finer-grained source-level controls per audit recommendations
        maxSubQueries: 3,
        alwaysQuerySource: false
      }
    ],
    outputConfiguration: {
      modality: 'answerSynthesis',
      includeActivity: true
    },
    requestLimits: {
      maxRuntimeInSeconds: 45
    }
  };

  const managementPayload = {
    name: agentResourceName,
    ...agentProperties
  };

  const { response } = await performSearchRequest('create-knowledge-agent-management', managementUrl, {
    method: 'PUT',
    body: managementPayload,
    allowedStatuses: [400]
  });

  if (!response.ok) {
    const errorText = await response.text();
    const shouldRetryWithDataPlane = response.status === 400 && /api-version/i.test(errorText ?? '');

    if (!shouldRetryWithDataPlane) {
      throw new Error(`Failed to create agent: ${response.status} ${response.statusText} - ${errorText}`);
    }

    console.warn(
      JSON.stringify({
        event: 'azure.search.request.fallback',
        operation: 'create-knowledge-agent-management',
        status: response.status,
        reason: 'api-version-unsupported',
        detail: errorText
      })
    );

    const dataPlaneUrl = formatODataResourceUrl('agents', agentResourceName, config.AZURE_SEARCH_DATA_PLANE_API_VERSION);
    const dataPlanePayload = {
      name: agentResourceName,
      ...agentProperties
    };

    await performSearchRequest('create-knowledge-agent-dataplane', dataPlaneUrl, {
      method: 'PUT',
      body: dataPlanePayload
    });
  }
}
