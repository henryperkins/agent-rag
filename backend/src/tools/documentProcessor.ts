import * as pdfParseModule from 'pdf-parse';
import { randomUUID } from 'node:crypto';
import type { AgentMessage } from '../../../shared/types.js';
import { getSearchAuthHeaders } from '../azure/directSearch.js';
import { config } from '../config/app.js';
import { embedTexts } from '../utils/embeddings.js';
import { withRetry } from '../utils/resilience.js';

// Handle CommonJS module in ESM context
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const MIN_CHUNK_LENGTH = 50;
const EMBEDDING_BATCH_SIZE = 8;

export interface DocumentChunk {
  id: string;
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
  metadata?: Record<string, unknown>;
}

export interface UploadResult {
  success: boolean;
  documentId: string;
  chunks: number;
  azureResponse: unknown;
}

function chunkText(text: string, pageNumber: number): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    const content = text.slice(start, end).replace(/\s+/g, ' ').trim();

    if (content.length >= MIN_CHUNK_LENGTH) {
      chunks.push({
        id: `${pageNumber}_${index}`,
        content,
        page: pageNumber,
        chunkIndex: index
      });
      index += 1;
    }

    if (end >= text.length) {
      break;
    }

    start = end - CHUNK_OVERLAP;
    if (start < 0) {
      start = 0;
    }
  }

  return chunks;
}

export async function processPDF(buffer: Buffer, filename: string): Promise<ProcessedDocument> {
  const { text = '' } = await pdfParse(buffer);
  const pageTexts = text ? text.split('\f') : [''];

  const chunks: DocumentChunk[] = [];

  pageTexts.forEach((pageText: string, idx: number) => {
    const pageNumber = idx + 1;
    const pageChunks = chunkText(pageText, pageNumber);
    chunks.push(
      ...pageChunks.map((chunk) => ({
        ...chunk,
        id: `${pageNumber}_${chunk.chunkIndex}`
      }))
    );
  });

  const title = filename.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim() || filename;
  const documentId = `doc_${Date.now()}_${randomUUID()}`;

  return {
    id: documentId,
    filename,
    title,
    chunks,
    uploadedAt: new Date().toISOString()
  };
}

export async function buildAzureDocuments(doc: ProcessedDocument) {
  const results: Array<Record<string, unknown>> = [];

  for (let offset = 0; offset < doc.chunks.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = doc.chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((chunk) => chunk.content);
    const embeddings = await embedTexts(texts, EMBEDDING_BATCH_SIZE);

    if (embeddings.length !== batch.length) {
      throw new Error(`Embedding count mismatch: expected ${batch.length}, received ${embeddings.length}`);
    }

    batch.forEach((chunk, idx) => {
      const embedding = embeddings[idx];
      if (!Array.isArray(embedding)) {
        console.warn(`[EMBEDDING_SKIPPED] Invalid embedding for chunk ${chunk.id}; skipping.`);
        return;
      }

      results.push({
        id: `${doc.id}_chunk_${chunk.page}_${chunk.chunkIndex}`,
        document_id: doc.id,
        document_title: doc.title,
        chunk_id: chunk.id,
        page_chunk: chunk.content,
        page_number: chunk.page,
        page_embedding_text_3_large: embedding,
        uploaded_at: doc.uploadedAt,
        content_type: 'pdf',
        metadata: {
          filename: doc.filename,
          chunk_index: chunk.chunkIndex
        }
      });
    });
  }

  return results;
}

export async function uploadDocumentsToIndex(documents: Array<Record<string, unknown>>) {
  if (!documents.length) {
    return null;
  }

  const encodedIndexName = encodeURIComponent(config.AZURE_SEARCH_INDEX_NAME);
  const endpoint = `${config.AZURE_SEARCH_ENDPOINT}/indexes('${encodedIndexName}')/docs/index?api-version=${config.AZURE_SEARCH_DATA_PLANE_API_VERSION}`;
  const authHeaders = await getSearchAuthHeaders();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders
  };

  const results: unknown[] = [];
  const batchSize = 100;

  for (let offset = 0; offset < documents.length; offset += batchSize) {
    const batch = documents.slice(offset, offset + batchSize);
    const payload = {
      value: batch.map((doc) => ({
        '@search.action': 'mergeOrUpload',
        ...doc
      }))
    };

    const result = await withRetry('upload-index-batch', async (signal) => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload documents: ${response.status} ${errorText}`);
      }

      return response.json();
    });

    results.push(result);
  }

  return results;
}

export function buildTranscriptMessages(doc: ProcessedDocument): AgentMessage[] {
  return [
    {
      role: 'system' as const,
      content: `Document "${doc.title}" uploaded with ${doc.chunks.length} processed chunks.`
    }
  ];
}
