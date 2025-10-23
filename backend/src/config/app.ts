import { z } from 'zod';
import { config as loadEnv } from 'dotenv';

loadEnv();

const SEARCH_SERVICE_PREVIEW_VERSION = '2025-08-01-preview' as const;
const azureSearchPreviewSchema = z
  .string()
  .default(SEARCH_SERVICE_PREVIEW_VERSION)
  .refine((value) => value === SEARCH_SERVICE_PREVIEW_VERSION, {
    message: `Azure Search API version must be ${SEARCH_SERVICE_PREVIEW_VERSION} to match searchservice-preview.json`
  });

const envSchema = z.object({
  PROJECT_NAME: z.string().default('agentic-azure-chat'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8787),

  AZURE_SEARCH_ENDPOINT: z.string().url(),
  AZURE_SEARCH_API_VERSION: azureSearchPreviewSchema,
  AZURE_SEARCH_MANAGEMENT_API_VERSION: azureSearchPreviewSchema,
  AZURE_SEARCH_DATA_PLANE_API_VERSION: azureSearchPreviewSchema,
  AZURE_SEARCH_INDEX_NAME: z.string().default('earth_at_night'),
  AZURE_SEARCH_API_KEY: z.string().optional(),
  AZURE_KNOWLEDGE_AGENT_NAME: z.string().default('earth-knowledge-agent'),
  RETRIEVAL_STRATEGY: z.enum(['direct', 'knowledge_agent', 'hybrid']).default('direct'),
  KNOWLEDGE_AGENT_INCLUDE_ACTIVITY: z.coerce.boolean().default(true),
  KNOWLEDGE_AGENT_INCLUDE_REFERENCES: z.coerce.boolean().default(true),
  KNOWLEDGE_AGENT_INCLUDE_SOURCE_DATA: z.coerce.boolean().default(true),
  KNOWLEDGE_AGENT_ATTEMPT_FAST_PATH: z.coerce.boolean().default(false),
  KNOWLEDGE_AGENT_TOP_K: z.coerce.number().default(5),

  AZURE_OPENAI_ENDPOINT: z.string().url(),
  // v1 path segment is required for Responses API; coerce any value to 'v1'
  AZURE_OPENAI_API_VERSION: z
    .string()
    .default('v1')
    .refine((value) => value === 'v1' || value === 'preview', {
      message: 'AZURE_OPENAI_API_VERSION must be one of: v1, preview'
    })
    .transform(() => 'v1'),
  // Query string appended to all OpenAI requests, defaults to v1 preview
  AZURE_OPENAI_API_QUERY: z
    .string()
    .default('api-version=preview')
    .refine(
      (value) => value === 'api-version=preview' || value === 'api-version=v1',
      { message: 'AZURE_OPENAI_API_QUERY must be api-version=preview or api-version=v1' }
    ),
  AZURE_OPENAI_GPT_DEPLOYMENT: z.string().default('gpt-5'),
  AZURE_OPENAI_GPT_MODEL_NAME: z.string().default('gpt-5'),
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().default('text-embedding-3-large'),
  AZURE_OPENAI_EMBEDDING_MODEL_NAME: z.string().default('text-embedding-3-large'),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_EMBEDDING_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_EMBEDDING_API_KEY: z.string().optional(),

  GOOGLE_SEARCH_API_KEY: z.string().optional(),
  GOOGLE_SEARCH_ENGINE_ID: z.string().optional(),
  GOOGLE_SEARCH_ENDPOINT: z.string().url().default('https://customsearch.googleapis.com/customsearch/v1'),

  ENABLE_MULTI_INDEX_FEDERATION: z.coerce.boolean().default(false),
  AZURE_SEARCH_FEDERATED_INDEXES: z.string().default(''),

  RAG_TOP_K: z.coerce.number().default(5),
  ENABLE_LAZY_RETRIEVAL: z.coerce.boolean().default(true), // 40-50% token savings
  LAZY_SUMMARY_MAX_CHARS: z.coerce.number().default(1000), // Increased from 300
  LAZY_PREFETCH_COUNT: z.coerce.number().default(20), // Increased from 10
  LAZY_LOAD_THRESHOLD: z.coerce.number().default(0.5),
  RERANKER_THRESHOLD: z.coerce.number().default(2.5),
  TARGET_INDEX_MAX_DOCUMENTS: z.coerce.number().default(100),

  WEB_CONTEXT_MAX_TOKENS: z.coerce.number().default(30000), // Increased from 8000 (GPT-5: 272K input)
  WEB_RESULTS_MAX: z.coerce.number().default(15), // Increased from 6
  WEB_SEARCH_MODE: z.enum(['summary', 'full']).default('full'),
  WEB_SAFE_MODE: z.enum(['off', 'active', 'high']).default('off'),
  WEB_DEFAULT_RECENCY: z.string().default(''),
  WEB_EMBEDDING_BATCH_SIZE: z.coerce.number().default(16),

  CONTEXT_HISTORY_TOKEN_CAP: z.coerce.number().default(40000), // Increased from 1800 (GPT-5: 272K input)
  CONTEXT_SUMMARY_TOKEN_CAP: z.coerce.number().default(10000), // Increased from 600
  CONTEXT_SALIENCE_TOKEN_CAP: z.coerce.number().default(5000), // Increased from 400
  CONTEXT_MAX_RECENT_TURNS: z.coerce.number().default(50), // Increased from 12
  CONTEXT_MAX_SUMMARY_ITEMS: z.coerce.number().default(20), // Increased from 6
  CONTEXT_MAX_SALIENCE_ITEMS: z.coerce.number().default(15), // Increased from 6

  PLANNER_CONFIDENCE_DUAL_RETRIEVAL: z.coerce.number().default(0.45),
  RETRIEVAL_MIN_DOCS: z.coerce.number().default(3),
  RETRIEVAL_FALLBACK_RERANKER_THRESHOLD: z.coerce.number().default(1.5),
  ENABLE_ADAPTIVE_RETRIEVAL: z.coerce.boolean().default(true), // 30-50% fewer "I don't know" responses
  ADAPTIVE_MIN_COVERAGE: z.coerce.number().default(0.4),
  ADAPTIVE_MIN_DIVERSITY: z.coerce.number().default(0.3),
  ADAPTIVE_MAX_ATTEMPTS: z.coerce.number().default(3),
  SEARCH_MIN_COVERAGE: z.coerce.number().default(0.8),
  ENABLE_SEMANTIC_SUMMARY: z.coerce.boolean().default(false),
  ENABLE_INTENT_ROUTING: z.coerce.boolean().default(true), // 20-30% cost savings via model selection
  INTENT_CLASSIFIER_MODEL: z.string().default('gpt-5'),
  INTENT_CLASSIFIER_MAX_TOKENS: z.coerce.number().default(2000), // GPT-5 uses 400-700 reasoning tokens before JSON payload
  MODEL_FAQ: z.string().default('gpt-5'),
  MODEL_RESEARCH: z.string().default('gpt-5'),
  MODEL_FACTUAL: z.string().default('gpt-5'),
  MODEL_CONVERSATIONAL: z.string().default('gpt-5'),
  MAX_TOKENS_FAQ: z.coerce.number().default(2000), // Increased from 500 (GPT-5: 128K output)
  MAX_TOKENS_RESEARCH: z.coerce.number().default(16000), // Increased from 2000 for comprehensive research
  MAX_TOKENS_FACTUAL: z.coerce.number().default(3000), // Increased from 600
  MAX_TOKENS_CONVERSATIONAL: z.coerce.number().default(1500), // Increased from 400
  REASONING_DEFAULT_EFFORT: z.enum(['low', 'medium', 'high']).default('medium'),
  // GPT-5 only supports 'detailed' for reasoning.summary - do not use 'auto' or 'concise'
  REASONING_DEFAULT_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).default('detailed'),
  REASONING_INTENT_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  REASONING_INTENT_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).optional(),
  REASONING_PLANNER_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  REASONING_PLANNER_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).optional(),
  REASONING_DECOMPOSITION_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  REASONING_DECOMPOSITION_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).optional(),
  REASONING_COMPACTION_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  REASONING_COMPACTION_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).optional(),
  REASONING_CRITIC_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  REASONING_CRITIC_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).optional(),
  REASONING_CRAG_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  REASONING_CRAG_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).optional(),
  REASONING_ADAPTIVE_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  REASONING_ADAPTIVE_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).optional(),
  REASONING_SYNTHESIS_EFFORT: z.enum(['low', 'medium', 'high']).optional(),
  REASONING_SYNTHESIS_SUMMARY: z.enum(['none', 'auto', 'concise', 'detailed']).optional(),

  SEMANTIC_MEMORY_DB_PATH: z.string().default('./data/semantic-memory.db'),
  ENABLE_SEMANTIC_MEMORY: z.coerce.boolean().default(false),
  SEMANTIC_MEMORY_RECALL_K: z.coerce.number().default(3),
  SEMANTIC_MEMORY_MIN_SIMILARITY: z.coerce.number().default(0.6),
  SEMANTIC_MEMORY_PRUNE_AGE_DAYS: z.coerce.number().default(90),

  ENABLE_QUERY_DECOMPOSITION: z.coerce.boolean().default(false),
  DECOMPOSITION_COMPLEXITY_THRESHOLD: z.coerce.number().default(0.6),
  DECOMPOSITION_MAX_SUBQUERIES: z.coerce.number().default(8),

  ENABLE_WEB_RERANKING: z.coerce.boolean().default(false),
  RRF_K_CONSTANT: z.coerce.number().default(60),
  RERANKING_TOP_K: z.coerce.number().default(10),
  ENABLE_SEMANTIC_BOOST: z.coerce.boolean().default(false),
  SEMANTIC_BOOST_WEIGHT: z.coerce.number().default(0.3),

  ENABLE_CRITIC: z.coerce.boolean().default(true),
  CRITIC_MAX_RETRIES: z.coerce.number().default(1),
  CRITIC_THRESHOLD: z.coerce.number().default(0.8),

  ENABLE_CITATION_TRACKING: z.coerce.boolean().default(true),

  ENABLE_WEB_QUALITY_FILTER: z.coerce.boolean().default(true),
  WEB_MIN_AUTHORITY: z.coerce.number().default(0.3),
  WEB_MAX_REDUNDANCY: z.coerce.number().default(0.9),
  WEB_MIN_RELEVANCE: z.coerce.number().default(0.3),

  ENABLE_ACADEMIC_SEARCH: z.coerce.boolean().default(true),
  ACADEMIC_SEARCH_MAX_RESULTS: z.coerce.number().default(6),

  ENABLE_CRAG: z.coerce.boolean().default(true), // 30-50% hallucination reduction
  CRAG_RELEVANCE_THRESHOLD: z.coerce.number().default(0.5),
  CRAG_MIN_CONFIDENCE_FOR_USE: z.enum(['correct', 'ambiguous', 'incorrect']).default('ambiguous'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),
  DOCUMENT_UPLOAD_MAX_MB: z.coerce.number().default(10),
  ENABLE_DOCUMENT_UPLOAD: z.coerce.boolean().default(true),

  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Responses API feature gates
  RESPONSES_PARALLEL_TOOL_CALLS: z.coerce.boolean().default(true),
  // NOTE: stream_options.include_usage is NOT supported by Azure Responses API
  // It's only available in Chat Completions API (/chat/completions)
  // Keeping this config for future compatibility, but it's currently unused
  RESPONSES_STREAM_INCLUDE_USAGE: z.coerce.boolean().default(false), // NOT SUPPORTED - see above
  ENABLE_RESPONSE_STORAGE: z.coerce.boolean().default(true), // Enable response audit trails

  SESSION_DB_PATH: z.string().default('./data/session-store.db')
});

export type AppConfig = z.infer<typeof envSchema>;

const rawEnv = { ...process.env };

if (rawEnv.TARGET_INDEX_MAX_DOCUMENTS === undefined && rawEnv.MAX_DOCS_FOR_RERANKER !== undefined) {
  rawEnv.TARGET_INDEX_MAX_DOCUMENTS = rawEnv.MAX_DOCS_FOR_RERANKER;
}

export const config = envSchema.parse(rawEnv);
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
