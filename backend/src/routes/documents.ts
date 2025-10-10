import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { config } from '../config/app.js';
import {
  processPDF,
  buildAzureDocuments,
  uploadDocumentsToIndex,
  buildTranscriptMessages
} from '../tools/documentProcessor.js';
import { sessionStore } from '../services/sessionStore.js';

const ALLOWED_MIME_TYPES = new Set(['application/pdf']);

export async function setupDocumentRoutes(app: FastifyInstance) {
  await app.register(multipart, {
    attachFieldsToBody: false,
    limits: {
      fileSize: config.DOCUMENT_UPLOAD_MAX_MB * 1024 * 1024
    }
  });

  app.post('/documents/upload', async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return reply.code(400).send({ error: 'Only PDF files are supported' });
    }

    const maxBytes = config.DOCUMENT_UPLOAD_MAX_MB * 1024 * 1024;
    try {
      const buffer = await file.toBuffer();
      if (buffer.byteLength > maxBytes) {
        return reply
          .code(413)
          .send({ error: `File exceeds size limit of ${config.DOCUMENT_UPLOAD_MAX_MB}MB` });
      }

      request.log.info(
        { filename: file.filename, size: buffer.byteLength },
        'Processing PDF upload'
      );

      const processed = await processPDF(buffer, file.filename);
      request.log.info(
        { documentId: processed.id, chunks: processed.chunks.length },
        'PDF processed'
      );

      const documents = await buildAzureDocuments(processed);
      const azureResponse = await uploadDocumentsToIndex(documents);

      sessionStore.saveTranscript(processed.id, buildTranscriptMessages(processed));

      return {
        success: true,
        documentId: processed.id,
        title: processed.title,
        filename: processed.filename,
        chunks: processed.chunks.length,
        uploadedAt: processed.uploadedAt,
        azureResponse
      };
    } catch (error) {
      request.log.error(error, 'Failed to process upload');
      return reply.code(500).send({
        error: 'Failed to process document',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
