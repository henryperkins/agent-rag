import { z } from 'zod';
import { config as loadEnv } from 'dotenv';

loadEnv();

const envSchema = z.object({
  PROJECT_NAME: z.string().default('agentic-azure-chat'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8787),

  AZURE_SEARCH_ENDPOINT: z.string().url(),
  AZURE_SEARCH_API_VERSION: z.string().default('2025-10-01-preview'),
  AZURE_SEARCH_MANAGEMENT_API_VERSION: z.string().default('2025-10-01-preview'),
  AZURE_SEARCH_DATA_PLANE_API_VERSION: z.string().default('2025-08-01-preview'),
  AZURE_SEARCH_INDEX_NAME: z.string().default('earth_at_night'),
  AZURE_SEARCH_API_KEY: z.string().optional(),
  AZURE_KNOWLEDGE_AGENT_NAME: z.string().default('earth-knowledge-agent'),

  AZURE_OPENAI_ENDPOINT: z.string().url(),
  // v1 path segment is required for Responses API; coerce any value to 'v1'
  AZURE_OPENAI_API_VERSION: z.string().default('v1').transform(() => 'v1'),
  // Query string appended to all OpenAI requests, defaults to v1 preview
  AZURE_OPENAI_API_QUERY: z.string().default('api-version=preview'),
  AZURE_OPENAI_GPT_DEPLOYMENT: z.string().default('gpt-4o'),
  AZURE_OPENAI_GPT_MODEL_NAME: z.string().default('gpt-4o-2024-08-06'),
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
  LAZY_SUMMARY_MAX_CHARS: z.coerce.number().default(300),
  LAZY_PREFETCH_COUNT: z.coerce.number().default(10),
  LAZY_LOAD_THRESHOLD: z.coerce.number().default(0.5),
  RERANKER_THRESHOLD: z.coerce.number().default(2.5),
  TARGET_INDEX_MAX_DOCUMENTS: z.coerce.number().default(100),

  WEB_CONTEXT_MAX_TOKENS: z.coerce.number().default(8000),
  WEB_RESULTS_MAX: z.coerce.number().default(6),
  WEB_SEARCH_MODE: z.enum(['summary', 'full']).default('full'),

  CONTEXT_HISTORY_TOKEN_CAP: z.coerce.number().default(1800),
  CONTEXT_SUMMARY_TOKEN_CAP: z.coerce.number().default(600),
  CONTEXT_SALIENCE_TOKEN_CAP: z.coerce.number().default(400),
  CONTEXT_MAX_RECENT_TURNS: z.coerce.number().default(12),
  CONTEXT_MAX_SUMMARY_ITEMS: z.coerce.number().default(6),
  CONTEXT_MAX_SALIENCE_ITEMS: z.coerce.number().default(6),

  PLANNER_CONFIDENCE_DUAL_RETRIEVAL: z.coerce.number().default(0.45),
  RETRIEVAL_MIN_DOCS: z.coerce.number().default(3),
  RETRIEVAL_FALLBACK_RERANKER_THRESHOLD: z.coerce.number().default(1.5),
  ENABLE_ADAPTIVE_RETRIEVAL: z.coerce.boolean().default(false),
  ADAPTIVE_MIN_COVERAGE: z.coerce.number().default(0.4),
  ADAPTIVE_MIN_DIVERSITY: z.coerce.number().default(0.3),
  ADAPTIVE_MAX_ATTEMPTS: z.coerce.number().default(3),
  SEARCH_MIN_COVERAGE: z.coerce.number().default(0.8),
  ENABLE_SEMANTIC_SUMMARY: z.coerce.boolean().default(false),
  ENABLE_INTENT_ROUTING: z.coerce.boolean().default(true), // 20-30% cost savings via model selection
  INTENT_CLASSIFIER_MODEL: z.string().default('gpt-4o-mini'),
  INTENT_CLASSIFIER_MAX_TOKENS: z.coerce.number().default(100),
  MODEL_FAQ: z.string().default('gpt-4o-mini'),
  MODEL_RESEARCH: z.string().default('gpt-4o'),
  MODEL_FACTUAL: z.string().default('gpt-4o-mini'),
  MODEL_CONVERSATIONAL: z.string().default('gpt-4o-mini'),
  MAX_TOKENS_FAQ: z.coerce.number().default(500),
  MAX_TOKENS_RESEARCH: z.coerce.number().default(2000),
  MAX_TOKENS_FACTUAL: z.coerce.number().default(600),
  MAX_TOKENS_CONVERSATIONAL: z.coerce.number().default(400),

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

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),
  DOCUMENT_UPLOAD_MAX_MB: z.coerce.number().default(10),
  ENABLE_DOCUMENT_UPLOAD: z.coerce.boolean().default(true),

  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Responses API feature gates
  RESPONSES_PARALLEL_TOOL_CALLS: z.coerce.boolean().default(true),
  RESPONSES_STREAM_INCLUDE_USAGE: z.coerce.boolean().default(true), // Enable cost telemetry
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
