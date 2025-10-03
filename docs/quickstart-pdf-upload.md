# Quick Start: Implementing PDF Upload

**Goal:** Add PDF document upload capability to Agent-RAG
**Time Estimate:** 8-16 hours
**Difficulty:** Medium

> [!IMPORTANT]
> **Planned Feature Notice**
> The PDF upload flow described below is **not yet implemented** in the repository. None of the referenced files (for example `backend/src/tools/documentProcessor.ts`, `/documents/upload`) exist today. Treat this as an implementation playbook to follow when you are ready to build the capability.

This guide walks through implementing the first enhancement: PDF upload and indexing.

---

## Prerequisites

- [ ] Agent-RAG running locally
- [ ] Azure AI Search index deployed
- [ ] Node.js 18+ and pnpm installed
- [ ] Basic familiarity with the codebase

---

## Step-by-Step Implementation

### Phase 1: Backend Setup (4-6 hours, to be completed during implementation)

#### Step 1: Install Dependencies (5 minutes)

```bash
cd backend
pnpm add @fastify/multipart pdf-parse
pnpm add -D @types/pdf-parse
```

#### Step 2: Create Document Processor (45 minutes)

Create `backend/src/tools/documentProcessor.ts`:

```typescript
import pdfParse from 'pdf-parse';
import { createEmbeddings } from '../azure/openaiClient.js';
import { config } from '../config/app.js';

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

export interface DocumentChunk {
  content: string;
  page: number;
  chunkIndex: number;
}

export interface ProcessedDocument {
  id: string;
  filename: string;
  title: string;
  chunks: DocumentChunk[];
  uploadedAt: string;
}

function chunkText(text: string, pageNumber: number): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const content = text.slice(start, end).trim();

    if (content.length > 50) {  // Skip very short chunks
      chunks.push({ content, page: pageNumber, chunkIndex });
      chunkIndex++;
    }

    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

export async function processPDF(
  buffer: Buffer,
  filename: string
): Promise<ProcessedDocument> {
  // Parse PDF
  const pdfData = await pdfParse(buffer);

  // Split by pages and chunk
  const chunks: DocumentChunk[] = [];
  const pages = pdfData.text.split('\f'); // \f is PDF page delimiter

  pages.forEach((pageText, pageIndex) => {
    const pageChunks = chunkText(pageText, pageIndex + 1);
    chunks.push(...pageChunks);
  });

  // Generate document ID and metadata
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

export async function embedAndIndex(doc: ProcessedDocument) {
  const batchSize = 10;
  const results = [];

  for (let i = 0; i < doc.chunks.length; i += batchSize) {
    const batch = doc.chunks.slice(i, i + batchSize);
    const texts = batch.map(chunk => chunk.content);

    // Get embeddings
    const embeddingResponse = await createEmbeddings(texts);
    const embeddings = embeddingResponse.data.map(item => item.embedding);

    // Prepare for upload
    const documents = batch.map((chunk, idx) => ({
      id: `${doc.id}_chunk_${chunk.page}_${chunk.chunkIndex}`,
      page_chunk: chunk.content,
      page_embedding_text_3_large: embeddings[idx],
      page_number: chunk.page,
      document_id: doc.id,
      document_title: doc.title
    }));

    results.push(...documents);

    // Rate limiting
    if (i + batchSize < doc.chunks.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}

export async function uploadToIndex(documents: any[]) {
  const url = `${config.AZURE_SEARCH_ENDPOINT}/indexes/${config.AZURE_SEARCH_INDEX_NAME}/docs/index?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (config.AZURE_SEARCH_API_KEY) {
    headers['api-key'] = config.AZURE_SEARCH_API_KEY;
  }

  const payload = {
    value: documents.map(doc => ({
      '@search.action': 'mergeOrUpload',
      ...doc
    }))
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result;
}
```

#### Step 3: Update Index Schema (30 minutes)

**Option A: Manually update via Azure Portal**
1. Go to Azure Portal → Search Service → Indexes
2. Edit `earth_at_night` index
3. Add fields:
   - `document_id` (String, Filterable, Facetable)
   - `document_title` (String, Searchable, Filterable)
4. Save

**Option B: Update via script**

Modify `backend/src/azure/indexSetup.ts` in the `indexDefinition.fields` array:

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
  filterable: true,
  sortable: true
}
```

Then run:
```bash
pnpm cleanup  # Delete existing index
pnpm setup    # Recreate with new schema
```

⚠️ **Warning:** This deletes all existing data!

#### Step 4: Add Upload Route (30 minutes)

Update `backend/src/routes/index.ts`:

```typescript
import multipart from '@fastify/multipart';
import { processPDF, embedAndIndex, uploadToIndex } from '../tools/documentProcessor.js';

export async function registerRoutes(app: FastifyInstance) {
  // Register multipart plugin
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
      files: 1
    }
  });

  // ... existing routes ...

  // Document upload endpoint
  app.post('/documents/upload', async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.code(400).send({ error: 'No file provided' });
      }

      if (data.mimetype !== 'application/pdf') {
        return reply.code(400).send({
          error: 'Invalid file type. Only PDF files are supported.'
        });
      }

      // Log upload start
      request.log.info({ filename: data.filename }, 'Processing PDF upload');

      // Convert to buffer
      const buffer = await data.toBuffer();

      // Process PDF
      const processedDoc = await processPDF(buffer, data.filename);
      request.log.info({
        documentId: processedDoc.id,
        chunks: processedDoc.chunks.length
      }, 'PDF processed');

      // Generate embeddings and prepare for indexing
      const documents = await embedAndIndex(processedDoc);
      request.log.info({
        documents: documents.length
      }, 'Embeddings generated');

      // Upload to Azure Search
      await uploadToIndex(documents);
      request.log.info({
        documentId: processedDoc.id
      }, 'Documents indexed');

      return {
        success: true,
        documentId: processedDoc.id,
        title: processedDoc.title,
        filename: processedDoc.filename,
        chunks: processedDoc.chunks.length,
        uploadedAt: processedDoc.uploadedAt
      };

    } catch (error: any) {
      request.log.error(error, 'PDF upload failed');
      return reply.code(500).send({
        error: 'Failed to process document',
        message: error.message
      });
    }
  });

  // ... rest of routes ...
}
```

#### Step 5: Test Backend (30 minutes)

Create `backend/src/tools/documentProcessor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processPDF } from './documentProcessor.js';

describe('documentProcessor', () => {
  it('should process a PDF and extract chunks', async () => {
    // You'll need a sample PDF in backend/test-fixtures/
    const pdfPath = join(__dirname, '../test-fixtures/sample.pdf');
    const buffer = readFileSync(pdfPath);

    const result = await processPDF(buffer, 'sample.pdf');

    expect(result.id).toBeDefined();
    expect(result.title).toBe('sample');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.chunks[0].content).toBeDefined();
    expect(result.chunks[0].page).toBeGreaterThan(0);
  });
});
```

Run tests:
```bash
pnpm test
```

Manual test with curl:
```bash
curl -X POST http://localhost:8787/documents/upload \
  -F "file=@path/to/test.pdf" \
  -H "Content-Type: multipart/form-data"
```

---

### Phase 2: Frontend Integration (2-3 hours, begins after backend API is created)

#### Step 6: Create Upload Component (45 minutes)

Create `frontend/src/components/DocumentUpload.tsx`:

```typescript
import { useState, useRef } from 'react';
import toast from 'react-hot-toast';

interface UploadResult {
  success: boolean;
  documentId: string;
  title: string;
  chunks: number;
  uploadedAt: string;
}

export function DocumentUpload() {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are supported');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setUploading(true);
    const uploadToast = toast.loading('Uploading and processing PDF...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE || 'http://localhost:8787'}/documents/upload`,
        {
          method: 'POST',
          body: formData
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Upload failed');
      }

      const result: UploadResult = await response.json();

      toast.success(
        `Successfully uploaded "${result.title}" (${result.chunks} chunks)`,
        { id: uploadToast }
      );

      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

    } catch (error: any) {
      toast.error(`Upload failed: ${error.message}`, { id: uploadToast });
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleUpload(file);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleUpload(file);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="document-upload">
      <div
        className={`upload-zone ${dragActive ? 'drag-active' : ''} ${uploading ? 'uploading' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          disabled={uploading}
          style={{ display: 'none' }}
        />

        <div className="upload-icon">📄</div>

        {uploading ? (
          <>
            <p className="upload-text">Processing PDF...</p>
            <div className="upload-spinner"></div>
          </>
        ) : (
          <>
            <p className="upload-text">
              Drop PDF file here or click to browse
            </p>
            <p className="upload-hint">
              Maximum file size: 10MB
            </p>
          </>
        )}
      </div>
    </div>
  );
}
```

#### Step 7: Add Styles (15 minutes)

Add to `frontend/src/App.css`:

```css
.document-upload {
  margin: 1rem 0;
}

.upload-zone {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: #fafafa;
}

.upload-zone:hover:not(.uploading) {
  border-color: #4a90e2;
  background: #f0f7ff;
}

.upload-zone.drag-active {
  border-color: #4a90e2;
  background: #e3f2fd;
  transform: scale(1.02);
}

.upload-zone.uploading {
  cursor: not-allowed;
  opacity: 0.7;
}

.upload-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.upload-text {
  font-size: 1.1rem;
  font-weight: 500;
  color: #333;
  margin: 0.5rem 0;
}

.upload-hint {
  font-size: 0.9rem;
  color: #666;
  margin: 0.25rem 0;
}

.upload-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #4a90e2;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 1rem auto 0;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

#### Step 8: Integrate into App (15 minutes)

Update `frontend/src/App.tsx`:

```typescript
import { DocumentUpload } from './components/DocumentUpload';

function ChatApp() {
  // ... existing state ...

  return (
    <div className="layout">
      <header className="app-header">
        <div>
          <h1>{import.meta.env.VITE_APP_TITLE ?? 'Agentic Azure Chat'}</h1>
          <p>Grounded answers with transparent citations powered by Azure AI Search.</p>
        </div>

        {/* Add upload component */}
        <DocumentUpload />

        {/* ... existing mode toggle ... */}
      </header>

      {/* ... rest of app ... */}
    </div>
  );
}
```

#### Step 9: Test Frontend (30 minutes)

```bash
cd frontend
pnpm dev
```

**Manual Testing Checklist:**
- [ ] Click to upload works
- [ ] Drag and drop works
- [ ] Only PDFs accepted
- [ ] File size validation
- [ ] Success toast shows
- [ ] Error handling works
- [ ] Loading state displays
- [ ] File input clears after upload

---

### Phase 3: Verification & Polish (1-2 hours, execute once full stack is wired up)

#### Step 10: End-to-End Test (30 minutes)

1. **Upload a PDF:**
   - Use the frontend upload
   - Verify success message
   - Note the document ID

2. **Verify Indexing:**
   - Open Azure Portal
   - Navigate to Search Service → Indexes
   - Query the index for your document_id
   - Confirm chunks are present

3. **Test Retrieval:**
   - Ask a question related to the PDF content
   - Verify citations include the uploaded document
   - Check document_title appears in citations

Example test:
```bash
# Upload document
curl -X POST http://localhost:8787/documents/upload \
  -F "file=@research-paper.pdf"

# Test chat with uploaded content
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "What are the key findings in the research paper I uploaded?"
      }
    ]
  }'
```

#### Step 11: Error Handling Polish (30 minutes)

Add comprehensive error handling:

```typescript
// In documentProcessor.ts
export async function processPDF(
  buffer: Buffer,
  filename: string
): Promise<ProcessedDocument> {
  try {
    const pdfData = await pdfParse(buffer);

    if (!pdfData.text || pdfData.text.trim().length === 0) {
      throw new Error('PDF contains no extractable text. It may be scanned or image-based.');
    }

    // ... rest of processing ...

  } catch (error: any) {
    if (error.message.includes('Invalid PDF')) {
      throw new Error('File is not a valid PDF document');
    }
    throw error;
  }
}
```

#### Step 12: Add Logging & Monitoring (30 minutes)

Enhance logging for debugging:

```typescript
// In upload route
request.log.info({
  filename: data.filename,
  size: buffer.length,
  timestamp: Date.now()
}, 'PDF upload started');

// After processing
request.log.info({
  documentId: processedDoc.id,
  chunks: processedDoc.chunks.length,
  avgChunkSize: processedDoc.chunks.reduce((sum, c) => sum + c.content.length, 0) / processedDoc.chunks.length,
  processingTimeMs: Date.now() - startTime
}, 'PDF processing completed');
```

---

## Troubleshooting

### Common Issues

#### Issue 1: "Invalid PDF structure"
**Cause:** Corrupted or password-protected PDF
**Solution:**
- Verify PDF opens in Adobe Reader
- Remove password protection
- Try re-exporting the PDF

#### Issue 2: "Failed to upload to Azure Search"
**Cause:** Index schema mismatch or authentication
**Solution:**
```bash
# Check index schema
curl https://YOUR-SEARCH.search.windows.net/indexes/earth_at_night?api-version=2025-08-01-preview \
  -H "api-key: YOUR-KEY"

# Verify document_id and document_title fields exist
```

#### Issue 3: "Out of memory during processing"
**Cause:** Large PDF file
**Solution:**
- Increase Node.js memory: `NODE_OPTIONS=--max-old-space-size=4096`
- Process in smaller chunks
- Stream instead of buffering

#### Issue 4: "Rate limit exceeded"
**Cause:** Too many embedding requests
**Solution:**
- Increase delay between batches (change 1000ms to 2000ms)
- Reduce batch size from 10 to 5

---

## Next Steps

After completing PDF upload:

1. **Add Document Management:**
   - List uploaded documents endpoint
   - Delete document endpoint
   - Document metadata storage

2. **Enhance Chunking:**
   - Smarter paragraph-based chunking
   - Preserve document structure
   - Table and image extraction

3. **User Interface:**
   - Document library view
   - Upload progress bar
   - Document preview

4. **Advanced Features:**
   - OCR for scanned PDFs
   - Multi-file upload
   - Batch processing

---

## Success Criteria

You've successfully implemented PDF upload when (post-implementation checklist):

- [x] Backend accepts PDF files via multipart upload
- [x] PDFs are parsed and chunked correctly
- [x] Chunks are embedded and indexed in Azure Search
- [x] Frontend provides drag-drop upload interface
- [x] Success/error messages display appropriately
- [x] Uploaded content is retrievable in chat queries
- [x] All tests pass

---

## Estimated Time

- **Backend:** 4-6 hours
- **Frontend:** 2-3 hours
- **Testing:** 1-2 hours
- **Total:** 8-16 hours

---

## Resources

- [pdf-parse documentation](https://www.npmjs.com/package/pdf-parse)
- [@fastify/multipart docs](https://github.com/fastify/fastify-multipart)
- [Azure Search REST API](https://learn.microsoft.com/en-us/rest/api/searchservice/)
- [OpenAI Embeddings API](https://platform.openai.com/docs/api-reference/embeddings)

---

**Ready to start?** Plan the work, create the new modules described above, then begin with Phase 1, Step 1 once you are ready to implement.
