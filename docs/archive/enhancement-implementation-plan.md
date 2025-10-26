# Enhancement Implementation Plan

## Based on Liner Comparison Analysis

**Date:** October 3, 2025
**Version:** 1.0
**Status:** Planning

---

## Overview

This document outlines the implementation plan for priority enhancements identified in the Liner vs. Agent-RAG comparison analysis. Each enhancement is mapped to the existing codebase architecture with specific implementation steps.

---

## Current Architecture Analysis

### Backend Structure

```
backend/src/
├── routes/index.ts              # Current: /chat, /chat/stream, /admin/telemetry
├── orchestrator/index.ts        # Unified pipeline (context → plan → dispatch → synthesis → critique)
├── orchestrator/memoryStore.ts  # In-memory Map<sessionId, MemoryEntry>
├── services/
│   ├── chatStreamService.ts     # Streaming service using runSession
│   └── enhancedChatService.ts   # Sync service using runSession (current prod)
├── agents/
│   ├── critic.ts                # Legacy critic prompt wrapper
│   └── planner.ts               # Heuristic planner helper
├── azure/indexSetup.ts          # Index creation, document ingestion, embeddings
├── azure/openaiClient.ts        # Embeddings, chat, streaming
├── tools/index.ts               # agenticRetrieveTool, answerTool, webSearchTool
└── config/app.ts                # 40+ environment variables
```

### Service Layer Evolution

The system has evolved from simple services to a unified orchestrator pattern:

1. **Unified Flow** (`enhancedChatService.ts` + `chatStreamService.ts`):
   - Uses `runSession` for both sync and streaming
   - Session-based telemetry recording
   - Hash-based session ID derivation from first 2 messages
   - Shared tooling for sync and SSE responses

**Key Pattern**: New features should extend the orchestrator, not create parallel service implementations.

### Frontend Structure

```
frontend/src/
├── components/
│   ├── SourcesPanel.tsx         # Citation display (id, title, page, score, snippet, url)
│   ├── PlanPanel.tsx            # Plan, context, telemetry, critique history
│   └── ActivityPanel.tsx        # Real-time execution steps
├── hooks/
│   ├── useChat.ts               # Sync mode API wrapper (React Query)
│   └── useChatStream.ts         # SSE event handling (EventSource)
├── api/
│   └── client.ts                # Axios client (30s timeout, JSON only)
└── types.ts                     # Reference interface with citation fields
```

### API Client Architecture

**Current**: Basic axios client with JSON-only support

```typescript
// frontend/src/api/client.ts
export const apiClient = axios.create({
  baseURL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});
```

**Needs for Enhancements**:

- Multipart/form-data support (document upload)
- Authentication interceptors (JWT tokens)
- Specialized clients for different content types
- Request/response interceptors for error handling

### Key Data Structures

```typescript
// References already support academic citations
interface Reference {
  id?: string;
  title?: string;
  content?: string;
  chunk?: string;
  url?: string;
  page_number?: number;
  pageNumber?: number;
  score?: number;
}

// In-memory session storage (needs persistence)
interface MemoryEntry {
  sessionId: string;
  turn: number;
  summaryBullets: SummaryBullet[];
  salience: SalienceNote[];
  createdAt: number;
}

// Session ID derivation (from chatStreamService.ts)
// Hash-based on first 2 messages for consistency
function deriveSessionId(messages: AgentMessage[]): string {
  const keySource = messages
    .filter((message) => message.role !== 'system')
    .slice(0, 2)
    .map((message) => `${message.role}:${message.content}`)
    .join('|');
  return createHash('sha1').update(keySource).digest('hex');
}
```

### Telemetry Integration Pattern

All services use `createSessionRecorder` to track execution:

```typescript
const recorder = createSessionRecorder({
  sessionId,
  mode: 'sync' | 'stream',
  question: latestUserQuestion(messages),
  forward: (event, data) => sendEvent(event, data), // optional for streaming
});

try {
  const response = await runSession({ ...options, emit: recorder.emit });
  recorder.complete(response);
} catch (error) {
  recorder.fail(error);
}
```

**Implication**: New features should integrate with this telemetry pattern.

---

## Priority 1: Document Upload & Processing

### Current Capabilities

✅ Index creation with vector embeddings (`backend/src/azure/indexSetup.ts`)
✅ Batch document ingestion to Azure Search
✅ Text chunking and embedding generation
✅ Schema supports: id, page_chunk, page_embedding_text_3_large, page_number

### Required Additions

> [!CAUTION]
> The core upload endpoint and processor now exist (`backend/src/routes/documents.ts`, `backend/src/tools/documentProcessor.ts`). The snippets below are retained as an extension blueprint (e.g., when layering authentication or alternate storage) and do not mirror the production code verbatim.

#### 1.1 PDF Upload Endpoint

**Location:** `backend/src/routes/documents.ts`

```typescript
import type { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { processDocument } from '../services/documentService.js';
import { authenticateUser } from '../middleware/auth.js';
import { createSessionRecorder } from '../orchestrator/sessionTelemetryStore.js';

export async function registerDocumentRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
      files: 5,
    },
  });

  app.post('/documents/upload', { preHandler: authenticateUser }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    const userId = (request.user as any).id;
    const sessionId = `upload-${Date.now()}-${userId}`;

    // Integrate with telemetry
    const recorder = createSessionRecorder({
      sessionId,
      mode: 'sync',
      question: `Upload document: ${data.filename}`,
    });

    try {
      const result = await processDocument(data, userId);
      recorder.complete({ documentId: result.id, chunks: result.chunks.length });

      return {
        documentId: result.id,
        chunks: result.chunks.length,
        filename: data.filename,
      };
    } catch (error) {
      recorder.fail(error as Error);
      throw error;
    }
  });

  // Get user's uploaded documents
  app.get('/documents', { preHandler: authenticateUser }, async (request) => {
    const userId = (request.user as any).id;
    return getUserDocuments(userId);
  });
}
```

#### 1.2 Document Processing Service

**Location:** `backend/src/tools/documentProcessor.ts`

```typescript
import pdf from 'pdf-parse';
import { createEmbeddings } from '../azure/openaiClient.js';
import { config } from '../config/app.js';

interface DocumentChunk {
  id: string;
  page_chunk: string;
  page_number: number;
  page_embedding_text_3_large: number[];
}

export async function processDocument(file: any): Promise<{
  id: string;
  chunks: DocumentChunk[];
}> {
  const buffer = await file.toBuffer();
  const pdfData = await pdf(buffer);

  // Chunk by page or by token limit
  const chunks = chunkByPage(pdfData);

  // Generate embeddings in batches
  const texts = chunks.map((c) => c.text);
  const embeddings = await createEmbeddings(texts);

  // Format for Azure Search
  const documentChunks: DocumentChunk[] = chunks.map((chunk, idx) => ({
    id: `${file.filename}_chunk_${idx}`,
    page_chunk: chunk.text,
    page_number: chunk.pageNumber,
    page_embedding_text_3_large: embeddings.data[idx].embedding,
  }));

  // Upload to Azure Search using existing patterns
  await uploadToIndex(documentChunks);

  return {
    id: file.filename,
    chunks: documentChunks,
  };
}
```

#### 1.3 Frontend Upload Component & API Client

**Location:** `frontend/src/api/documents.ts` (new file)

```typescript
import axios from 'axios';
import { apiClient } from './client';

// Create specialized upload client with multipart support
const uploadClient = axios.create({
  baseURL: apiClient.defaults.baseURL,
  timeout: 60000, // 60s for larger files
  headers: {
    'Content-Type': 'multipart/form-data',
  },
});

// Add auth interceptor
uploadClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function uploadDocument(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await uploadClient.post('/documents/upload', formData, {
    onUploadProgress: (progressEvent) => {
      const percentCompleted = Math.round(
        (progressEvent.loaded * 100) / (progressEvent.total ?? 1),
      );
      // Emit progress event for UI
      window.dispatchEvent(new CustomEvent('upload-progress', { detail: percentCompleted }));
    },
  });

  return response.data;
}

export async function getUserDocuments() {
  const response = await apiClient.get('/documents');
  return response.data;
}
```

**Location:** `frontend/src/components/DocumentUpload.tsx` (new file)

```typescript
import { useState, useEffect } from 'react';
import { uploadDocument } from '../api/documents';
import toast from 'react-hot-toast';

export function DocumentUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const handleProgress = (e: CustomEvent) => {
      setProgress(e.detail);
    };

    window.addEventListener('upload-progress', handleProgress as EventListener);
    return () => {
      window.removeEventListener('upload-progress', handleProgress as EventListener);
    };
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setProgress(0);

    try {
      const result = await uploadDocument(file);
      toast.success(`Uploaded ${result.chunks} chunks from ${result.filename}`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <div className="upload-zone">
      <input
        type="file"
        accept=".pdf,.docx,.txt"
        onChange={handleUpload}
        disabled={uploading}
      />
      {uploading && (
        <div className="upload-progress">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
          <span>{progress}% uploaded</span>
        </div>
      )}
    </div>
  );
}
```

#### 1.4 Dependencies to Add

```bash
cd backend
pnpm add @fastify/multipart pdf-parse
pnpm add -D @types/pdf-parse
```

**Estimated Effort:** 2-3 days

---

## Priority 2: Citation Export

### Current Capabilities

✅ Reference interface with all needed fields (title, page_number, url, content)
✅ Frontend displays citations in SourcesPanel
✅ Citation tracking through full pipeline

### Required Additions

#### 2.1 Citation Formatter Service

**Location:** `backend/src/services/citationFormatter.ts` (new file)

```typescript
import type { Reference } from '../../../shared/types.js';

interface FormattedCitation {
  format: 'apa' | 'mla' | 'chicago' | 'bibtex';
  citation: string;
}

export function formatCitation(
  ref: Reference,
  format: 'apa' | 'mla' | 'chicago' | 'bibtex',
): string {
  switch (format) {
    case 'apa':
      return formatAPA(ref);
    case 'mla':
      return formatMLA(ref);
    case 'chicago':
      return formatChicago(ref);
    case 'bibtex':
      return formatBibTeX(ref);
  }
}

function formatAPA(ref: Reference): string {
  // Author, A. A. (Year). Title. Publisher. URL
  const title = ref.title || 'Untitled';
  const url = ref.url || '';
  const page = ref.page_number || ref.pageNumber;

  let citation = title;
  if (url) citation += `. Retrieved from ${url}`;
  if (page) citation += ` (p. ${page})`;

  return citation;
}

function formatMLA(ref: Reference): string {
  // Author. "Title." Publisher, Year, pp. X-Y. URL.
  const title = ref.title || 'Untitled';
  const url = ref.url || '';
  const page = ref.page_number || ref.pageNumber;

  let citation = `"${title}."`;
  if (page) citation += ` p. ${page}.`;
  if (url) citation += ` ${url}.`;

  return citation;
}

function formatChicago(ref: Reference): string {
  // Author. Title. Publisher, Year.
  const title = ref.title || 'Untitled';
  const url = ref.url || '';

  let citation = title;
  if (url) citation += `. ${url}`;

  return citation;
}

function formatBibTeX(ref: Reference): string {
  const id = ref.id || 'ref';
  const title = ref.title || 'Untitled';
  const url = ref.url || '';

  return `@misc{${id},
  title = {${title}},
  url = {${url}},
  note = {Accessed: ${new Date().toISOString().split('T')[0]}}
}`;
}

export function exportBibliography(
  citations: Reference[],
  format: 'apa' | 'mla' | 'chicago' | 'bibtex',
): string {
  return citations
    .map((ref, idx) => {
      const formatted = formatCitation(ref, format);
      return format === 'bibtex' ? formatted : `[${idx + 1}] ${formatted}`;
    })
    .join('\n\n');
}
```

#### 2.2 Export Endpoint

**Location:** Add to `backend/src/routes/index.ts`

```typescript
app.post<{ Body: { citations: Reference[]; format: string } }>(
  '/citations/export',
  async (request, reply) => {
    const { citations, format } = request.body;

    if (!['apa', 'mla', 'chicago', 'bibtex'].includes(format)) {
      return reply.code(400).send({ error: 'Invalid format' });
    }

    const bibliography = exportBibliography(
      citations,
      format as 'apa' | 'mla' | 'chicago' | 'bibtex',
    );

    reply.header('Content-Type', 'text/plain');
    reply.header('Content-Disposition', `attachment; filename="citations.${format}.txt"`);
    return bibliography;
  },
);
```

#### 2.3 Frontend Export UI

**Location:** Add to `frontend/src/components/SourcesPanel.tsx`

```typescript
const handleExport = async (format: 'apa' | 'mla' | 'chicago' | 'bibtex') => {
  const response = await fetch('/citations/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ citations, format })
  });

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `citations.${format}.txt`;
  a.click();
};

// Add to SourcesPanel render:
<div className="export-buttons">
  <button onClick={() => handleExport('apa')}>APA</button>
  <button onClick={() => handleExport('mla')}>MLA</button>
  <button onClick={() => handleExport('chicago')}>Chicago</button>
  <button onClick={() => handleExport('bibtex')}>BibTeX</button>
</div>
```

**Estimated Effort:** 1-2 days

---

## Priority 3: User Sessions & Persistent History

> [!INFO]
> Session transcripts and salience snapshots now persist via `backend/src/services/sessionStore.ts` and `backend/src/orchestrator/memoryStore.ts`. The guidance below covers additional enhancements such as multi-user auth and richer history queries.

### Current State

❌ In-memory Map storage (`sessionMemory.ts`)
❌ No user authentication
❌ No query history persistence
❌ Sessions cleared on server restart

### Required Additions

#### 3.1 Database Schema

**Technology Choice:** SQLite (easy setup) or PostgreSQL (production)

```sql
-- users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- conversations table
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  turn_number INTEGER NOT NULL,
  role VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- memory_summaries table
CREATE TABLE memory_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  summary_text TEXT NOT NULL,
  embedding VECTOR(3072), -- pgvector extension
  turn_number INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- salience_notes table
CREATE TABLE salience_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  fact TEXT NOT NULL,
  topic VARCHAR(255),
  last_seen_turn INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- query_history table
CREATE TABLE query_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  session_id UUID REFERENCES sessions(id),
  query TEXT NOT NULL,
  answer TEXT,
  citations JSONB,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### 3.2 Database Service

**Location:** `backend/src/services/databaseService.ts` (new file)

```typescript
import { Pool } from 'pg';
import type { AgentMessage, Reference } from '../../../shared/types.js';
import type { SummaryBullet, SalienceNote } from '../orchestrator/compact.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function saveConversation(sessionId: string, messages: AgentMessage[]) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const [idx, msg] of messages.entries()) {
      await client.query(
        `INSERT INTO conversations (session_id, turn_number, role, content)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [sessionId, idx, msg.role, msg.content],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function saveSummaries(sessionId: string, summaries: SummaryBullet[], turn: number) {
  const client = await pool.connect();
  try {
    for (const summary of summaries) {
      await client.query(
        `INSERT INTO memory_summaries (session_id, summary_text, embedding, turn_number)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, summary.text, summary.embedding, turn],
      );
    }
  } finally {
    client.release();
  }
}

export async function loadSessionHistory(sessionId: string): Promise<AgentMessage[]> {
  const result = await pool.query(
    `SELECT role, content FROM conversations
     WHERE session_id = $1
     ORDER BY turn_number ASC`,
    [sessionId],
  );

  return result.rows.map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
  }));
}

export async function getUserQueryHistory(userId: string, limit = 50) {
  const result = await pool.query(
    `SELECT id, query, answer, created_at, metadata
     FROM query_history
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit],
  );

  return result.rows;
}
```

#### 3.3 Update Memory Store to Use Database

**Location:** Modify `backend/src/orchestrator/memoryStore.ts`

```typescript
import {
  saveSummaries,
  loadSessionHistory,
  loadSummariesFromDB,
  loadSalienceFromDB,
} from '../services/databaseService.js';
import type { CompactedContext } from './compact.js';

// Keep existing in-memory Map for backward compatibility
const sessionMemory = new Map<string, MemoryEntry>();

export async function upsertMemory(
  sessionId: string,
  turn: number,
  compacted: CompactedContext,
  summaries?: SummaryBullet[],
) {
  // Save to database instead of in-memory Map
  if (summaries?.length) {
    await saveSummaries(sessionId, summaries, turn);
  }

  // Also save salience to database
  if (compacted.salience?.length) {
    await saveSalience(sessionId, compacted.salience, turn);
  }

  // Keep in-memory cache for performance (LRU with max 1000 entries)
  sessionMemory.set(sessionId, {
    sessionId,
    turn,
    summaryBullets: summaries || [],
    salience: compacted.salience,
    createdAt: Date.now(),
  });

  // Evict oldest entries if cache too large
  if (sessionMemory.size > 1000) {
    const oldest = [...sessionMemory.entries()].sort(
      ([, a], [, b]) => a.createdAt - b.createdAt,
    )[0][0];
    sessionMemory.delete(oldest);
  }
}

export async function loadMemory(sessionId: string, maxAgeInTurns = 50) {
  // Try in-memory first (hot path optimization)
  const cached = sessionMemory.get(sessionId);
  if (cached) {
    return {
      summaryBullets: cached.summaryBullets.slice(-20),
      salience: cached.salience.filter(
        (note) => cached.turn - (note.lastSeenTurn ?? cached.turn) <= maxAgeInTurns,
      ),
    };
  }

  // Load from database (cold path)
  const summaries = await loadSummariesFromDB(sessionId);
  const salience = await loadSalienceFromDB(sessionId, maxAgeInTurns);

  // Populate cache for next access
  sessionMemory.set(sessionId, {
    sessionId,
    turn: summaries[0]?.turn_number ?? 0,
    summaryBullets: summaries.map((s) => ({ text: s.text, embedding: s.embedding })),
    salience: salience,
    createdAt: Date.now(),
  });

  return {
    summaryBullets: summaries.slice(-20).map((s) => ({ text: s.text, embedding: s.embedding })),
    salience,
  };
}

// Persist session on completion (call from service layer)
export async function persistSession(sessionId: string, messages: AgentMessage[]) {
  await saveConversation(sessionId, messages);
}
```

**Integration with Service Layer** - Update `enhancedChatService.ts`:

```typescript
import { persistSession } from '../orchestrator/memoryStore.js';

export async function handleEnhancedChat(messages: AgentMessage[]): Promise<ChatResponse> {
  const sessionId = deriveSessionId(messages);
  const recorder = createSessionRecorder({
    sessionId,
    mode: 'sync',
    question: latestUserQuestion(messages),
  });

  try {
    const response = await runSession({
      messages,
      mode: 'sync',
      sessionId,
      emit: recorder.emit,
    });

    recorder.complete(response);

    // Persist session to database
    await persistSession(sessionId, messages);

    return response;
  } catch (error) {
    recorder.fail(error as Error);
    throw error;
  }
}
```

#### 3.4 Authentication Middleware & Frontend Integration

**Location:** `backend/src/middleware/auth.ts` (new file)

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function authenticateUser(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch (error) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

// Optional: API key fallback for development
export async function authenticateUserOrApiKey(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'];

  if (apiKey && apiKey === process.env.API_KEY) {
    // Valid API key
    return;
  }

  // Otherwise require JWT
  try {
    await request.jwtVerify();
  } catch (error) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}
```

**Location:** `frontend/src/api/auth.ts` (new file)

```typescript
import { apiClient } from './client';

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
  };
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await apiClient.post('/auth/login', { email, password });

  // Store token in localStorage
  localStorage.setItem('auth_token', response.data.token);
  localStorage.setItem('user', JSON.stringify(response.data.user));

  return response.data;
}

export async function logout() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('user');
}

export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token');
}

export function getCurrentUser() {
  const user = localStorage.getItem('user');
  return user ? JSON.parse(user) : null;
}

// Add auth interceptor to apiClient
apiClient.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);
```

#### 3.5 Dependencies to Add

```bash
cd backend
pnpm add pg @fastify/jwt
pnpm add -D @types/pg

# For SQLite alternative:
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

**Estimated Effort:** 4-5 days

---

## Priority 4: Collection Management

### Required Additions

#### 4.1 Collections Schema

```sql
CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE collection_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  reference_id VARCHAR(255) NOT NULL,
  reference_data JSONB NOT NULL, -- Store full Reference object
  tags TEXT[],
  notes TEXT,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_collection_items_collection ON collection_items(collection_id);
CREATE INDEX idx_collection_items_tags ON collection_items USING GIN(tags);
```

#### 4.2 Collections Service

**Location:** `backend/src/services/collectionsService.ts` (new file)

```typescript
import type { Reference } from '../../../shared/types.js';
import { pool } from './databaseService.js';

export async function createCollection(userId: string, name: string, description?: string) {
  const result = await pool.query(
    `INSERT INTO collections (user_id, name, description)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, created_at`,
    [userId, name, description],
  );

  return result.rows[0];
}

export async function addToCollection(
  collectionId: string,
  reference: Reference,
  tags?: string[],
  notes?: string,
) {
  const result = await pool.query(
    `INSERT INTO collection_items (collection_id, reference_id, reference_data, tags, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [collectionId, reference.id, JSON.stringify(reference), tags, notes],
  );

  return result.rows[0];
}

export async function getCollections(userId: string) {
  const result = await pool.query(
    `SELECT c.*, COUNT(ci.id) as item_count
     FROM collections c
     LEFT JOIN collection_items ci ON c.id = ci.collection_id
     WHERE c.user_id = $1
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    [userId],
  );

  return result.rows;
}

export async function getCollectionItems(collectionId: string) {
  const result = await pool.query(
    `SELECT id, reference_data, tags, notes, added_at
     FROM collection_items
     WHERE collection_id = $1
     ORDER BY added_at DESC`,
    [collectionId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    reference: JSON.parse(row.reference_data) as Reference,
    tags: row.tags,
    notes: row.notes,
    addedAt: row.added_at,
  }));
}

export async function searchCollectionItems(userId: string, query: string, tags?: string[]) {
  let sql = `
    SELECT ci.id, ci.reference_data, ci.tags, ci.notes, c.name as collection_name
    FROM collection_items ci
    JOIN collections c ON ci.collection_id = c.id
    WHERE c.user_id = $1
  `;

  const params: any[] = [userId];
  let paramCount = 1;

  if (query) {
    paramCount++;
    sql += ` AND (ci.reference_data::text ILIKE $${paramCount} OR ci.notes ILIKE $${paramCount})`;
    params.push(`%${query}%`);
  }

  if (tags?.length) {
    paramCount++;
    sql += ` AND ci.tags && $${paramCount}`;
    params.push(tags);
  }

  const result = await pool.query(sql, params);
  return result.rows;
}
```

#### 4.3 Collections Routes

**Location:** `backend/src/routes/collections.ts` (new file)

```typescript
import type { FastifyInstance } from 'fastify';
import { authenticateUser } from '../middleware/auth.js';
import * as collectionsService from '../services/collectionsService.js';

export async function registerCollectionRoutes(app: FastifyInstance) {
  // List user's collections
  app.get('/collections', { preHandler: authenticateUser }, async (request) => {
    const userId = (request.user as any).id;
    return collectionsService.getCollections(userId);
  });

  // Create collection
  app.post('/collections', { preHandler: authenticateUser }, async (request) => {
    const userId = (request.user as any).id;
    const { name, description } = request.body as any;
    return collectionsService.createCollection(userId, name, description);
  });

  // Get collection items
  app.get('/collections/:id/items', { preHandler: authenticateUser }, async (request) => {
    const { id } = request.params as any;
    return collectionsService.getCollectionItems(id);
  });

  // Add item to collection
  app.post('/collections/:id/items', { preHandler: authenticateUser }, async (request) => {
    const { id } = request.params as any;
    const { reference, tags, notes } = request.body as any;
    return collectionsService.addToCollection(id, reference, tags, notes);
  });

  // Search across collections
  app.post('/collections/search', { preHandler: authenticateUser }, async (request) => {
    const userId = (request.user as any).id;
    const { query, tags } = request.body as any;
    return collectionsService.searchCollectionItems(userId, query, tags);
  });
}
```

#### 4.4 Frontend Collections UI

**Location:** `frontend/src/components/CollectionsPanel.tsx` (new file)

```typescript
import { useState, useEffect } from 'react';
import { getCollections, addToCollection } from '../api/collections';
import type { Reference } from '../types';

interface Collection {
  id: string;
  name: string;
  description?: string;
  item_count: number;
}

export function CollectionsPanel({ citations }: { citations: Reference[] }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('');

  useEffect(() => {
    loadCollections();
  }, []);

  const loadCollections = async () => {
    const data = await getCollections();
    setCollections(data);
  };

  const handleSaveToCollection = async (reference: Reference) => {
    if (!selectedCollection) return;

    await addToCollection(selectedCollection, reference);
    // Show success notification
  };

  return (
    <div className="collections-panel">
      <h3>Save to Collection</h3>

      <select
        value={selectedCollection}
        onChange={(e) => setSelectedCollection(e.target.value)}
      >
        <option value="">Select collection...</option>
        {collections.map(c => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.item_count} items)
          </option>
        ))}
      </select>

      <div className="citations-to-save">
        {citations.map((citation, idx) => (
          <div key={citation.id ?? idx} className="citation-save-item">
            <span>{citation.title ?? `Reference ${idx + 1}`}</span>
            <button onClick={() => handleSaveToCollection(citation)}>
              Save
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Estimated Effort:** 3-4 days

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

- [ ] Set up database (PostgreSQL or SQLite)
- [ ] Implement user authentication (JWT)
- [ ] Add session persistence
- [ ] Create database migration scripts

### Phase 2: Document Management (Week 3-4)

- [ ] PDF upload endpoint with multipart support
- [ ] Document processing service (chunking, embeddings)
- [ ] Integration with Azure Search indexing
- [ ] Frontend upload component

### Phase 3: Citation & Export (Week 5)

- [ ] Citation formatting service (APA, MLA, Chicago, BibTeX)
- [ ] Export endpoints
- [ ] Frontend export UI in SourcesPanel
- [ ] Download functionality

### Phase 4: Collections (Week 6-7)

- [ ] Collections database schema
- [ ] Collections service layer
- [ ] Collections API routes
- [ ] Frontend collections management UI
- [ ] Search and tagging functionality

### Phase 5: Query History (Week 8)

- [ ] Query history storage
- [ ] History retrieval endpoints
- [ ] Frontend history panel
- [ ] Session restoration from history

---

## Configuration Updates

### New Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/agentrag
DATABASE_POOL_SIZE=20

# Authentication
JWT_SECRET=your-secret-key
JWT_EXPIRATION=7d

# Document Upload
MAX_FILE_SIZE_MB=10
MAX_FILES_PER_UPLOAD=5
ALLOWED_FILE_TYPES=pdf,docx,txt

# Collections
MAX_COLLECTIONS_PER_USER=50
MAX_ITEMS_PER_COLLECTION=1000
```

### Dependencies Summary

```json
{
  "dependencies": {
    "@fastify/multipart": "^8.0.0",
    "@fastify/jwt": "^7.0.0",
    "pdf-parse": "^1.1.1",
    "pg": "^8.11.0",
    "better-sqlite3": "^9.0.0"
  },
  "devDependencies": {
    "@types/pdf-parse": "^1.1.4",
    "@types/pg": "^8.10.0",
    "@types/better-sqlite3": "^7.6.8"
  }
}
```

---

## Testing Strategy

### Unit Tests

- Citation formatter (all formats)
- Document chunking logic
- Database queries (with test database)
- Authentication middleware

### Integration Tests

- PDF upload → chunking → embedding → indexing pipeline
- Citation export end-to-end
- Collections CRUD operations
- Session persistence and restoration

### Manual Testing Checklist

- [ ] Upload various PDF sizes and formats
- [ ] Export citations in all formats
- [ ] Create and manage collections
- [ ] Verify session persistence across server restarts
- [ ] Test authentication flow
- [ ] Verify query history accuracy

---

## Migration Guide

### Database Setup

```bash
# Create database
createdb agentrag

# Run migrations
psql agentrag < migrations/001_initial_schema.sql
psql agentrag < migrations/002_collections.sql
```

### Gradual Rollout

1. Deploy database schema
2. Add authentication (optional, can be enabled per user)
3. Enable document upload (feature flag) — ✅ Completed in current build
4. Enable collections (feature flag)
5. Migrate existing in-memory sessions to database — ✅ Implemented via SQLite session store

---

## Success Metrics

### Document Upload

- Upload success rate > 95%
- Average processing time < 10s per PDF
- Embedding generation < 5s per page

### Citation Export

- Format accuracy (manual verification)
- Export completion time < 2s
- Support for 100+ citations per export

### Collections

- Collection creation < 500ms
- Item addition < 200ms
- Search response time < 1s

### Session Persistence

- Zero session loss on server restart
- Query history retrieval < 500ms
- Memory overhead < 100MB for 1000 sessions

---

## Future Enhancements (Post-MVP)

### Medium Priority

- [ ] Browser extension for web page highlighting
- [ ] Multi-modal input (images, videos)
- [ ] Academic source filtering (scholar mode)
- [ ] Collaborative features (shared collections)

### Long-term

- [ ] Mobile applications (iOS/Android)
- [ ] Research workflow templates
- [ ] Citation recommendation engine
- [ ] Integration with reference managers (Zotero, Mendeley)

---

## Risk Assessment

| Risk                       | Impact | Mitigation                                      |
| -------------------------- | ------ | ----------------------------------------------- |
| PDF parsing failures       | High   | Multiple parser fallbacks, error logging        |
| Database performance       | Medium | Connection pooling, query optimization, caching |
| Authentication complexity  | Medium | Use established libraries (@fastify/jwt)        |
| Storage costs (embeddings) | Low    | Compress embeddings, implement cleanup policies |
| Migration complexity       | Medium | Gradual rollout, feature flags, rollback plan   |

---

## Appendix: Code Patterns

### Error Handling Pattern

```typescript
try {
  const result = await riskyOperation();
  return result;
} catch (error) {
  request.log.error({ error, context: 'operation_name' });
  reply.code(500).send({
    error: 'Operation failed',
    message: error instanceof Error ? error.message : 'Unknown error',
  });
}
```

### Database Transaction Pattern

```typescript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  // Multiple operations
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### Citation Formatting Pattern

```typescript
export const citationFormatters = {
  apa: (ref: Reference) => formatAPA(ref),
  mla: (ref: Reference) => formatMLA(ref),
  chicago: (ref: Reference) => formatChicago(ref),
  bibtex: (ref: Reference) => formatBibTeX(ref),
};

const formatter = citationFormatters[format];
if (!formatter) throw new Error('Invalid format');
return formatter(reference);
```
