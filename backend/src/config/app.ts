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
  AZURE_OPENAI_API_VERSION: z.string().default('v1'),
  AZURE_OPENAI_GPT_DEPLOYMENT: z.string().default('gpt-5'),
  AZURE_OPENAI_GPT_MODEL_NAME: z.string().default('gpt-5'),
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().default('text-embedding-3-large'),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_EMBEDDING_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_EMBEDDING_API_KEY: z.string().optional(),

  AZURE_BING_SUBSCRIPTION_KEY: z.string().optional(),
  AZURE_BING_ENDPOINT: z.string().url().default('https://api.bing.microsoft.com/v7.0/search'),

  RAG_TOP_K: z.coerce.number().default(5),
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

  ENABLE_CRITIC: z.coerce.boolean().default(true),
  CRITIC_MAX_RETRIES: z.coerce.number().default(1),
  CRITIC_THRESHOLD: z.coerce.number().default(0.8),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(10),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(30000),

  CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:5174'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
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
