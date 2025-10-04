# Enhancement Implementation Guide
**Based on Liner Comparison Analysis**

This document provides detailed implementation guidance for adding Liner-inspired features to the Agent-RAG system, leveraging the existing architecture.

> [!IMPORTANT]
> **Current vs. Planned Scope**
> * Sections labeled “Current Architecture” describe capabilities that exist in the repository today (for example the unified orchestrator powering `/chat` and `/chat/stream`).
> * All implementation guides in “Quick Wins” and “Strategic Enhancements” outline **planned future work**. The referenced routes (`/documents/upload`), services (`database.ts`, `collections.ts`), and tools do **not** exist yet and will need to be created during implementation.
> * Use this guide as a blueprint when you are ready to build the features; do not expect any of the step-by-step instructions to work against the current codebase without first writing the described modules.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Current Architecture Snapshot](#current-architecture-snapshot)
3. [Planned Quick Wins (1-2 Sprints)](#planned-quick-wins-1-2-sprints)
4. [Strategic Enhancements (3-6 Months)](#strategic-enhancements-3-6-months)
5. [Implementation Patterns](#implementation-patterns)
6. [Database Schema](#database-schema)
7. [API Extensions](#api-extensions)

---

## Architecture Overview

### Current System Structure

```
Routes (backend/src/routes/)
  ↓
Services (backend/src/services/)
  ↓
Orchestrator (backend/src/orchestrator/)
  ├── Router (router.ts)
  ├── Plan (plan.ts)
  ├── Context (compact, memoryStore, summarySelector)
  ├── Dispatch (dispatch.ts)
  ├── Synthesis (generateAnswer/answerTool)
  └── Critique (critique.ts)
  ↓
Tools (backend/src/tools/)
  ├── retrieveTool
  ├── lazyRetrieveTool
  ├── webSearchTool
  └── answerTool
  ↓
Azure Services (backend/src/azure/)
  ├── directSearch
  ├── lazyRetrieval
  ├── openaiClient
  └── indexSetup
```

### Key Extension Points

1. **Routes** (`backend/src/routes/index.ts`): Add new endpoints
2. **Tools** (`backend/src/tools/index.ts`): Add new capabilities
3. **Azure Services**: New integrations (Blob Storage, Cosmos DB)
4. **Orchestrator**: Extend context pipeline
5. **Frontend Components**: New UI panels and features

---

## Current Architecture Snapshot

- Unified orchestrator already drives both `/chat` and `/chat/stream`, emitting route, plan, retrieval, critique, telemetry, and completion events (see [`backend/src/orchestrator/index.ts`](backend/src/orchestrator/index.ts) and [`backend/src/services/chatStreamService.ts`](backend/src/services/chatStreamService.ts)).
- No persistent storage layer or document upload tooling exists yet; the system operates entirely in-memory with Azure Search indexes bootstrapped via [`backend/src/azure/indexSetup.ts`](backend/src/azure/indexSetup.ts).
- Existing tools include `retrieveTool`, `lazyRetrieveTool`, `webSearchTool`, and `answerTool` (exported from [`backend/src/tools/index.ts`](backend/src/tools/index.ts)).

## Planned Quick Wins (1-2 Sprints)

### 1. PDF Upload & Processing _(Status: Planned — requires new backend & frontend modules)_

#### Backend Implementation _(to be implemented)_

**Step 1: Add Dependencies**
```bash
cd backend
pnpm add @azure/storage-blob pdf-parse
pnpm add -D @types/pdf-parse
```

**Step 2: Create Document Processing Tool**

Create `backend/src/tools/documentProcessor.ts`:

```typescript
import { BlobServiceClient } from '@azure/storage-blob';
import pdfParse from 'pdf-parse';
import { createEmbeddings } from '../azure/openaiClient.js';
import { config } from '../config/app.js';

export interface ProcessedDocument {
  id: string;
  filename: string;
  title: string;
  chunks: Array<{
    content: string;
    page: number;
    chunkIndex: number;
  }>;
  uploadedAt: string;
  userId?: string;
}

export interface ChunkedDocument {
  documentId: string;
  chunks: Array<{
    id: string;
    content: string;
    embedding: number[];
    page_number: number;
    chunk_index: number;
    document_title: string;
  }>;
}

const CHUNK_SIZE = 1000; // characters
const CHUNK_OVERLAP = 200;

function chunkText(text: string, pageNumber: number): Array<{ content: string; page: number; chunkIndex: number }> {
  const chunks: Array<{ content: string; page: number; chunkIndex: number }> = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const content = text.slice(start, end);

    if (content.trim().length > 0) {
      chunks.push({ content: content.trim(), page: pageNumber, chunkIndex });
      chunkIndex++;
    }

    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

export async function processPDF(buffer: Buffer, filename: string): Promise<ProcessedDocument> {
  const pdfData = await pdfParse(buffer);

  const chunks: Array<{ content: string; page: number; chunkIndex: number }> = [];

  // Simple chunking by pages
  const pages = pdfData.text.split('\f'); // PDF page delimiter
  pages.forEach((pageText, pageIndex) => {
    const pageChunks = chunkText(pageText, pageIndex + 1);
    chunks.push(...pageChunks);
  });

  const documentId = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const title = filename.replace('.pdf', '').replace(/_/g, ' ');

  return {
    id: documentId,
    filename,
    title,
    chunks,
    uploadedAt: new Date().toISOString()
  };
}

export async function embedAndIndex(doc: ProcessedDocument): Promise<ChunkedDocument> {
  const batchSize = 10;
  const embeddedChunks: ChunkedDocument['chunks'] = [];

  for (let i = 0; i < doc.chunks.length; i += batchSize) {
    const batch = doc.chunks.slice(i, i + batchSize);
    const texts = batch.map(chunk => chunk.content);

    const embeddingResponse = await createEmbeddings(texts);
    const embeddings = embeddingResponse.data.map(item => item.embedding);

    const processedBatch = batch.map((chunk, idx) => ({
      id: `${doc.id}_chunk_${chunk.page}_${chunk.chunkIndex}`,
      content: chunk.content,
      embedding: embeddings[idx],
      page_number: chunk.page,
      chunk_index: chunk.chunkIndex,
      document_title: doc.title
    }));

    embeddedChunks.push(...processedBatch);

    // Rate limiting
    if (i + batchSize < doc.chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return {
    documentId: doc.id,
    chunks: embeddedChunks
  };
}

export async function uploadToAzureSearch(chunkedDoc: ChunkedDocument): Promise<void> {
  const uploadUrl = `${config.AZURE_SEARCH_ENDPOINT}/indexes/${config.AZURE_SEARCH_INDEX_NAME}/docs/index?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.AZURE_SEARCH_API_KEY) {
    headers['api-key'] = config.AZURE_SEARCH_API_KEY;
  }

  const payload = {
    value: chunkedDoc.chunks.map(chunk => ({
      '@search.action': 'mergeOrUpload',
      id: chunk.id,
      page_chunk: chunk.content,
      page_embedding_text_3_large: chunk.embedding,
      page_number: chunk.page_number,
      document_title: chunk.document_title,
      document_id: chunkedDoc.documentId
    }))
  };

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload to Azure Search: ${response.status} - ${errorText}`);
  }
}
```

**Step 3: Add Upload Route**

Update `backend/src/routes/index.ts`:

```typescript
import multipart from '@fastify/multipart';

export async function registerRoutes(app: FastifyInstance) {
  // Register multipart
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB
    }
  });

  // ... existing routes ...

  // Document upload endpoint
  app.post('/documents/upload', async (request, reply) => {
    const data = await request.file();

    if (!data) {
      return reply.code(400).send({ error: 'No file provided' });
    }

    if (data.mimetype !== 'application/pdf') {
      return reply.code(400).send({ error: 'Only PDF files are supported' });
    }

    try {
      const buffer = await data.toBuffer();
      const processedDoc = await processPDF(buffer, data.filename);
      const chunkedDoc = await embedAndIndex(processedDoc);
      await uploadToAzureSearch(chunkedDoc);

      return {
        documentId: processedDoc.id,
        title: processedDoc.title,
        chunks: processedDoc.chunks.length,
        uploadedAt: processedDoc.uploadedAt
      };
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to process document', message: error.message });
    }
  });
}
```

**Step 4: Update Azure Search Index Schema**

Modify `backend/src/azure/indexSetup.ts` to add document metadata fields:

```typescript
{
  name: 'document_id',
  type: 'Edm.String',
  filterable: true,
  facetable: true
},
{
  name: 'document_title',
  type: 'Edm.String',
  searchable: true,
  filterable: true
}
```

#### Frontend Implementation _(to be implemented once backend endpoints exist)_

**Step 1: Create Upload Component**

Create `frontend/src/components/DocumentUpload.tsx`:

```typescript
import { useState } from 'react';
import { uploadDocument } from '../api/client';

export function DocumentUpload({ onUploadComplete }: { onUploadComplete?: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setError('Only PDF files are supported');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const result = await uploadDocument(file);
      onUploadComplete?.();
      alert(`Document uploaded: ${result.title} (${result.chunks} chunks)`);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="document-upload">
      <input
        type="file"
        accept=".pdf"
        onChange={handleFileChange}
        disabled={uploading}
      />
      {uploading && <p>Uploading and processing...</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

**Step 2: Add API Client Method**

Update `frontend/src/api/client.ts`:

```typescript
export async function uploadDocument(file: File) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Upload failed');
  }

  return response.json();
}
```

---

### 2. User Sessions & Query History _(Status: Planned — depends on introducing a database layer)_

#### Backend Implementation _(to be implemented — no persistence layer yet)_

**Step 1: Add Database Dependencies**

```bash
cd backend
pnpm add better-sqlite3
pnpm add -D @types/better-sqlite3
```

**Step 2: Create Database Service**

Create `backend/src/services/database.ts`:

```typescript
import Database from 'better-sqlite3';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), 'data', 'agent-rag.db');

export interface UserSession {
  id: string;
  userId?: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface QueryHistory {
  id: string;
  sessionId: string;
  query: string;
  answer: string;
  citations: string; // JSON
  createdAt: string;
}

class DatabaseService {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        created_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS query_history (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        query TEXT NOT NULL,
        answer TEXT NOT NULL,
        citations TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_history_session ON query_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_history_created ON query_history(created_at DESC);
    `);
  }

  createSession(id: string, userId?: string): UserSession {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, user_id, created_at, last_activity_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, userId || null, now, now);

    return { id, userId, createdAt: now, lastActivityAt: now };
  }

  updateSessionActivity(sessionId: string) {
    const stmt = this.db.prepare(`
      UPDATE sessions SET last_activity_at = ? WHERE id = ?
    `);
    stmt.run(new Date().toISOString(), sessionId);
  }

  saveQuery(sessionId: string, query: string, answer: string, citations: any[]) {
    const id = `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stmt = this.db.prepare(`
      INSERT INTO query_history (id, session_id, query, answer, citations, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      sessionId,
      query,
      answer,
      JSON.stringify(citations),
      new Date().toISOString()
    );

    this.updateSessionActivity(sessionId);
    return id;
  }

  getSessionHistory(sessionId: string, limit = 50): QueryHistory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM query_history
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(sessionId, limit) as QueryHistory[];
  }

  getUserSessions(userId: string, limit = 10): UserSession[] {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions
      WHERE user_id = ?
      ORDER BY last_activity_at DESC
      LIMIT ?
    `);
    return stmt.all(userId, limit) as UserSession[];
  }

  close() {
    this.db.close();
  }
}

export const db = new DatabaseService();
```

**Step 3: Integrate with Chat Services**

Update `backend/src/services/enhancedChatService.ts`:

```typescript
import { db } from './database.js';

export async function handleEnhancedChat(messages: AgentMessage[]): Promise<ChatResponse> {
  const sessionId = deriveSessionId(messages);

  // Ensure session exists
  try {
    db.createSession(sessionId);
  } catch {
    // Session already exists
  }

  const recorder = createSessionRecorder({
    sessionId,
    mode: 'sync',
    question: latestUserQuestion(messages)
  });

  try {
    const response = await runSession({
      messages,
      mode: 'sync',
      sessionId,
      emit: recorder.emit
    });

    recorder.complete(response);

    // Save to history
    const userQuery = latestUserQuestion(messages) || '';
    db.saveQuery(sessionId, userQuery, response.answer, response.citations);

    return response;
  } catch (error) {
    recorder.fail(error as Error);
    throw error;
  }
}
```

**Step 4: Add History Endpoints**

Update `backend/src/routes/index.ts`:

```typescript
import { db } from '../services/database.js';

export async function registerRoutes(app: FastifyInstance) {
  // ... existing routes ...

  // Get session history
  app.get<{ Params: { sessionId: string } }>(
    '/sessions/:sessionId/history',
    async (request, reply) => {
      const { sessionId } = request.params;
      const history = db.getSessionHistory(sessionId);
      return { sessionId, history };
    }
  );

  // Get user sessions
  app.get<{ Querystring: { userId: string } }>(
    '/sessions',
    async (request, reply) => {
      const { userId } = request.query;
      if (!userId) {
        return reply.code(400).send({ error: 'userId required' });
      }
      const sessions = db.getUserSessions(userId);
      return { userId, sessions };
    }
  );
}
```

#### Frontend Implementation _(to be implemented once backend is available)_

**Step 1: Create History Component**

Create `frontend/src/components/HistoryPanel.tsx`:

```typescript
import { useEffect, useState } from 'react';
import { getSessionHistory } from '../api/client';

interface HistoryItem {
  id: string;
  query: string;
  answer: string;
  createdAt: string;
}

export function HistoryPanel({ sessionId }: { sessionId: string }) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      try {
        const data = await getSessionHistory(sessionId);
        setHistory(data.history);
      } catch (error) {
        console.error('Failed to load history:', error);
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [sessionId]);

  if (loading) return <p>Loading history...</p>;

  return (
    <aside className="history-panel">
      <h3>Session History</h3>
      {history.length === 0 ? (
        <p>No history yet</p>
      ) : (
        <ul className="history-list">
          {history.map((item) => (
            <li key={item.id} className="history-item">
              <div className="history-query">{item.query}</div>
              <div className="history-timestamp">
                {new Date(item.createdAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
```

---

### 3. Citation Export _(Status: Planned)_

#### Backend Implementation _(to be implemented)_

**Step 1: Create Citation Formatter**

Create `backend/src/utils/citations.ts`:

```typescript
import type { Reference } from '../../../shared/types.js';

export type CitationStyle = 'apa' | 'mla' | 'chicago' | 'bibtex';

export interface FormattedCitation {
  style: CitationStyle;
  text: string;
}

function formatAPA(ref: Reference, index: number): string {
  const title = ref.title || `Reference ${index}`;
  const page = ref.page_number || ref.pageNumber;
  const pageStr = page ? `, p. ${page}` : '';
  const url = ref.url || '';

  return `[${index}] ${title}${pageStr}. ${url ? `Retrieved from ${url}` : ''}`.trim();
}

function formatMLA(ref: Reference, index: number): string {
  const title = ref.title || `Reference ${index}`;
  const page = ref.page_number || ref.pageNumber;
  const pageStr = page ? `. ${page}` : '';
  const url = ref.url || '';

  return `[${index}] "${title}"${pageStr}. ${url ? `Web. <${url}>` : ''}`.trim();
}

function formatChicago(ref: Reference, index: number): string {
  const title = ref.title || `Reference ${index}`;
  const page = ref.page_number || ref.pageNumber;
  const pageStr = page ? `, ${page}` : '';
  const url = ref.url || '';

  return `[${index}] ${title}${pageStr}. ${url || ''}`.trim();
}

function formatBibTeX(ref: Reference, index: number): string {
  const key = `ref${index}`;
  const title = ref.title || `Reference ${index}`;
  const url = ref.url || '';

  return `@misc{${key},
  title={${title}},
  ${url ? `url={${url}},` : ''}
  note={Reference ${index}}
}`;
}

export function formatCitations(
  citations: Reference[],
  style: CitationStyle
): FormattedCitation[] {
  return citations.map((ref, index) => {
    let text: string;

    switch (style) {
      case 'apa':
        text = formatAPA(ref, index + 1);
        break;
      case 'mla':
        text = formatMLA(ref, index + 1);
        break;
      case 'chicago':
        text = formatChicago(ref, index + 1);
        break;
      case 'bibtex':
        text = formatBibTeX(ref, index + 1);
        break;
      default:
        text = formatAPA(ref, index + 1);
    }

    return { style, text };
  });
}

export function generateBibliography(
  citations: Reference[],
  style: CitationStyle = 'apa'
): string {
  const formatted = formatCitations(citations, style);

  if (style === 'bibtex') {
    return formatted.map(f => f.text).join('\n\n');
  }

  return formatted.map(f => f.text).join('\n');
}
```

**Step 2: Add Export Endpoint**

Update `backend/src/routes/index.ts`:

```typescript
import { generateBibliography } from '../utils/citations.js';

app.post<{ Body: { citations: Reference[]; style: string } }>(
  '/citations/export',
  async (request, reply) => {
    const { citations, style } = request.body;

    if (!Array.isArray(citations)) {
      return reply.code(400).send({ error: 'citations array required' });
    }

    const validStyles = ['apa', 'mla', 'chicago', 'bibtex'];
    const citationStyle = validStyles.includes(style) ? style : 'apa';

    const bibliography = generateBibliography(citations, citationStyle as any);

    return {
      style: citationStyle,
      bibliography,
      count: citations.length
    };
  }
);
```

#### Frontend Implementation _(to be implemented after backend API exists)_

**Step 1: Add Export Button to Sources Panel**

Update `frontend/src/components/SourcesPanel.tsx`:

```typescript
import { useState } from 'react';
import { exportCitations } from '../api/client';

export function SourcesPanel({ citations, isStreaming }: SourcesPanelProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (style: string) => {
    setExporting(true);
    try {
      const result = await exportCitations(citations, style);

      // Download as text file
      const blob = new Blob([result.bibliography], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `citations-${style}.${style === 'bibtex' ? 'bib' : 'txt'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside className="sidebar">
      <header>
        <h3>Sources</h3>
        <span className="badge">{citations.length}</span>
      </header>

      {citations.length > 0 && (
        <div className="export-buttons">
          <button onClick={() => handleExport('apa')} disabled={exporting}>
            Export APA
          </button>
          <button onClick={() => handleExport('mla')} disabled={exporting}>
            Export MLA
          </button>
          <button onClick={() => handleExport('bibtex')} disabled={exporting}>
            Export BibTeX
          </button>
        </div>
      )}

      {/* ... existing sources list ... */}
    </aside>
  );
}
```

---

## Strategic Enhancements (3-6 Months) _(All items below are forward-looking proposals)_

### 4. Collection Management _(Status: Planned — requires database, auth, and new APIs)_

#### Database Schema

```sql
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE collection_items (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL,
  document_id TEXT,
  query_id TEXT,
  citation_id TEXT,
  note TEXT,
  added_at TEXT NOT NULL,
  FOREIGN KEY (collection_id) REFERENCES collections(id)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  UNIQUE(user_id, name)
);

CREATE TABLE collection_tags (
  collection_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  PRIMARY KEY (collection_id, tag_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id),
  FOREIGN KEY (tag_id) REFERENCES tags(id)
);
```

#### Implementation Pattern

1. **Collection Service** (`backend/src/services/collections.ts`):
   - CRUD operations for collections
   - Add/remove items
   - Tag management
   - Search within collections

2. **Collection Routes** (`backend/src/routes/collections.ts`):
   - `POST /collections` - Create collection
   - `GET /collections` - List user collections
   - `POST /collections/:id/items` - Add item
   - `DELETE /collections/:id/items/:itemId` - Remove item
   - `GET /collections/:id/search` - Search collection

3. **Frontend Components**:
   - `CollectionsList.tsx` - Display user collections
   - `CollectionView.tsx` - View collection contents
   - `AddToCollectionButton.tsx` - Quick-add citations/documents

---

### 5. Browser Extension _(Status: Planned)_

#### Architecture _(proposed structure — not yet scaffolded)_

```
Extension Structure:
├── manifest.json (V3)
├── background.js (Service worker)
├── content.js (Injected into pages)
├── popup/
│   ├── index.html
│   ├── popup.tsx
│   └── styles.css
└── utils/
    ├── api.ts (Communicate with backend)
    └── storage.ts (Chrome storage)
```

#### Core Features

1. **Text Highlighting**:
   - Select text on any webpage
   - Save highlight to backend
   - Visual overlay on page

2. **Quick Search**:
   - Popup interface for queries
   - Send to Agent-RAG backend
   - Display results in extension

3. **Save to Collections**:
   - Right-click menu
   - Add current page to collection
   - Tag and categorize

#### Implementation Steps

1. Create extension scaffold with Vite
2. Implement content script for highlighting
3. Build popup UI with React
4. Add message passing to backend
5. Store API keys in Chrome storage
6. Package and publish

---

### 6. Multi-modal Support _(Status: Planned)_

#### Image Analysis _(requires new Azure Vision integration)_

**Dependencies**:
```bash
pnpm add sharp @azure/cognitiveservices-computervision
```

**Implementation**:

Create `backend/src/tools/imageAnalysis.ts`:

```typescript
import { ComputerVisionClient } from '@azure/cognitiveservices-computervision';
import { CognitiveServicesCredentials } from '@azure/ms-rest-azure-js';

export async function analyzeImage(imageUrl: string) {
  const credentials = new CognitiveServicesCredentials(config.AZURE_VISION_API_KEY);
  const client = new ComputerVisionClient(credentials, config.AZURE_VISION_ENDPOINT);

  const analysis = await client.analyzeImage(imageUrl, {
    visualFeatures: ['Description', 'Tags', 'Objects', 'Categories']
  });

  return {
    description: analysis.description?.captions?.[0]?.text,
    tags: analysis.tags?.map(t => t.name),
    objects: analysis.objects?.map(o => o.object)
  };
}
```

#### YouTube Video Processing _(requires new Google API integration)_

Create `backend/src/tools/youtubeProcessor.ts`:

```typescript
import { google } from 'googleapis';

const youtube = google.youtube({
  version: 'v3',
  auth: config.YOUTUBE_API_KEY
});

export async function getVideoTranscript(videoId: string) {
  // Get captions
  const captionsResponse = await youtube.captions.list({
    part: ['snippet'],
    videoId
  });

  // Download and parse captions
  // Chunk transcript into searchable segments
  // Create embeddings for semantic search

  return {
    videoId,
    title: '', // from video metadata
    transcript: '', // full text
    segments: [] // timestamped chunks
  };
}
```

---

## Implementation Patterns

### Pattern 1: Tool Extension _(use when adding future capabilities)_

All new capabilities follow the tool pattern:

```typescript
// backend/src/tools/newTool.ts
export async function newToolFunction(args: ToolArgs) {
  // 1. Validate input
  // 2. Call external service
  // 3. Process results
  // 4. Return structured data
  return result;
}

// backend/src/tools/index.ts
export { newToolFunction } from './newTool.js';
```

### Pattern 2: Route Registration _(template for planned endpoints)_

```typescript
// backend/src/routes/newFeature.ts
export async function registerNewFeatureRoutes(app: FastifyInstance) {
  app.post('/feature/action', async (request, reply) => {
    // Validate
    // Process
    // Return
  });
}

// backend/src/routes/index.ts
import { registerNewFeatureRoutes } from './newFeature.js';

export async function registerRoutes(app: FastifyInstance) {
  // ... existing routes ...
  await registerNewFeatureRoutes(app);
}
```

### Pattern 3: Orchestrator Integration _(extend when new tools are added)_

```typescript
// backend/src/orchestrator/index.ts
export async function runSession(options: RunSessionOptions) {
  // Add new tool to tools object
  const tools: OrchestratorTools = {
    ...defaultTools,
    newTool: (args) => newToolFunction(args),
    ...(options.tools ?? {})
  };

  // Emit new events
  emit?.('newEvent', { data });
}
```

### Pattern 4: Frontend Component _(blueprint for future UI work)_

```typescript
// frontend/src/components/NewFeature.tsx
import { useState, useEffect } from 'react';
import { newApiCall } from '../api/client';

export function NewFeature({ prop }: Props) {
  const [state, setState] = useState<Type>(initial);

  useEffect(() => {
    // Load data
  }, [dep]);

  const handleAction = async () => {
    const result = await newApiCall(data);
    setState(result);
  };

  return (
    <div className="new-feature">
      {/* UI */}
    </div>
  );
}
```

---

## Configuration Management

### Environment Variables

Add to `.env`:

```bash
# Document Processing
AZURE_BLOB_STORAGE_CONNECTION_STRING=
AZURE_BLOB_CONTAINER_NAME=documents

# Database
DATABASE_PATH=./data/agent-rag.db

# Vision API (for image analysis)
AZURE_VISION_ENDPOINT=
AZURE_VISION_API_KEY=

# YouTube API
YOUTUBE_API_KEY=

# Feature Flags
ENABLE_DOCUMENT_UPLOAD=true
ENABLE_COLLECTIONS=true
ENABLE_IMAGE_ANALYSIS=false
```

Update `backend/src/config/app.ts`:

```typescript
const envSchema = z.object({
  // ... existing config ...

  AZURE_BLOB_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_BLOB_CONTAINER_NAME: z.string().default('documents'),
  DATABASE_PATH: z.string().default('./data/agent-rag.db'),

  ENABLE_DOCUMENT_UPLOAD: z.coerce.boolean().default(false),
  ENABLE_COLLECTIONS: z.coerce.boolean().default(false),
  ENABLE_IMAGE_ANALYSIS: z.coerce.boolean().default(false)
});
```

---

## Testing Strategy _(plan these alongside implementation)_

### Unit Tests

```typescript
// backend/src/tools/documentProcessor.test.ts
import { describe, it, expect } from 'vitest';
import { processPDF, chunkText } from './documentProcessor';

describe('documentProcessor', () => {
  it('should chunk text with overlap', () => {
    const text = 'A'.repeat(2000);
    const chunks = chunkText(text, 1);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].content.length).toBe(CHUNK_SIZE);
  });

  it('should process PDF and extract pages', async () => {
    const buffer = await readTestPDF();
    const doc = await processPDF(buffer, 'test.pdf');

    expect(doc.id).toBeDefined();
    expect(doc.chunks.length).toBeGreaterThan(0);
  });
});
```

### Integration Tests

```typescript
// backend/src/routes/documents.test.ts
import { describe, it, expect } from 'vitest';
import { build } from '../test-helpers';

describe('Document Upload', () => {
  it('should upload and index PDF', async () => {
    const app = await build();

    const response = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      payload: createFormData()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().documentId).toBeDefined();
  });
});
```

---

## Migration Path _(proposed phasing once work begins)_

### Phase 1: Foundation (Sprint 1)
1. Set up database with SQLite
2. Implement session tracking
3. Add basic query history

### Phase 2: Documents (Sprint 2)
1. Add PDF upload endpoint
2. Implement chunking and embedding
3. Update index schema
4. Create upload UI

### Phase 3: Citations (Sprint 3)
1. Build citation formatters
2. Add export endpoint
3. Create export UI

### Phase 4: Collections (Sprints 4-6)
1. Database schema for collections
2. Collection CRUD operations
3. UI for collection management
4. Tag system

### Phase 5: Extensions (Sprints 7-12)
1. Browser extension scaffold
2. Multi-modal support
3. Advanced search features
4. Collaboration features

---

## Performance Considerations _(keep in mind during future work)_

### Document Processing
- **Chunking**: Process in batches of 10
- **Embedding**: Rate limit at 1 second between batches
- **Upload**: Stream large files, don't buffer in memory

### Database
- **Indexes**: Add on frequently queried columns
- **Pagination**: Limit history queries to 50 items
- **Cleanup**: Archive old sessions periodically

### Caching
- **Document metadata**: Cache in Redis
- **Embeddings**: Cache frequently accessed embeddings
- **Search results**: Short-term cache for repeated queries

---

## Security Considerations _(account for these during implementation)_

### File Upload
- Validate file types (PDF only initially)
- Scan for malware
- Limit file size (10MB default)
- Sanitize filenames

### Authentication
- Implement JWT tokens
- Rate limit per user
- Validate session ownership
- Encrypt sensitive data

### Data Privacy
- User data isolation
- GDPR compliance (deletion)
- Audit logs
- Encryption at rest

---

## Monitoring & Observability _(capture once features are built)_

### Metrics to Track
- Upload success/failure rate
- Processing time per document
- Search query latency
- Storage usage per user
- API error rates

### Logging
```typescript
app.log.info({
  operation: 'document_upload',
  documentId: doc.id,
  chunks: doc.chunks.length,
  processingTimeMs: elapsed
});
```

### Alerts
- Failed uploads
- Storage quota exceeded
- API rate limits
- Search performance degradation

---

## Conclusion

This implementation guide provides a structured approach to adding Liner-inspired features to Agent-RAG while maintaining the system's core strengths in transparency, quality assurance, and Azure integration.

**Key Principles:**
1. Leverage existing architecture patterns
2. Maintain type safety throughout
3. Test incrementally
4. Document configuration clearly
5. Monitor performance impacts

**Next Steps:**
1. Review and prioritize features
2. Set up development environment
3. Implement Quick Wins (Sprints 1-3)
4. Iterate based on user feedback
5. Plan Strategic Enhancements
