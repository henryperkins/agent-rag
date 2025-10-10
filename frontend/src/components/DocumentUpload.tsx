import { useRef, useState, type ChangeEvent } from 'react';
import toast from 'react-hot-toast';
import type { AgentMessage } from '../types';

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_DOCUMENT_MAX_MB ?? '10');
const API_BASE = (import.meta.env.VITE_API_BASE ?? __API_BASE__) as string;

interface DocumentUploadProps {
  onUploaded?: (message: AgentMessage) => void;
}

interface UploadResponse {
  success: boolean;
  documentId: string;
  title: string;
  filename: string;
  chunks: number;
  uploadedAt: string;
}

const ERROR_MESSAGE_KEYS = ['error', 'message', 'detail', 'title'] as const;

const extractUploadErrorMessage = (payload: unknown): string | undefined => {
  if (!payload) {
    return undefined;
  }

  if (payload instanceof Error) {
    return payload.message;
  }

  if (typeof payload === 'string') {
    return payload.trim() || undefined;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = extractUploadErrorMessage(item);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  if (typeof payload === 'object') {
    for (const key of ERROR_MESSAGE_KEYS) {
      const value = (payload as Record<string, unknown>)[key];
      const message = extractUploadErrorMessage(value);
      if (message) {
        return message;
      }
    }
  }

  return undefined;
};

export function DocumentUpload({ onUploaded }: DocumentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (file.type !== 'application/pdf') {
      toast.error('Only PDF files are supported');
      return;
    }

    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error(`File size must be less than ${MAX_UPLOAD_MB}MB`);
      return;
    }

    setUploading(true);
    const loadingToast = toast.loading(`Uploading "${file.name}"...`);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_BASE}/documents/upload`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => undefined);
        const statusMessage = response.statusText?.trim();
        const message =
          extractUploadErrorMessage(errorPayload) ??
          (statusMessage ? statusMessage : undefined) ??
          'Upload failed';
        throw new Error(message);
      }

      const result = (await response.json()) as UploadResponse;
      toast.success(`Uploaded "${result.title}" (${result.chunks} chunks)`, { id: loadingToast });

      onUploaded?.({
        role: 'system',
        content: `Uploaded document "${result.title}" with ${result.chunks} chunks. Ask questions referencing "${result.title}" to query the new content.`
      });
    } catch (error) {
      const message = extractUploadErrorMessage(error) ?? 'Upload failed';
      toast.error(message, { id: loadingToast });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const onInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = event.target.files ?? [];
    if (file) {
      await handleFile(file);
    }
  };

  const triggerUpload = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="document-upload">
      <button type="button" onClick={triggerUpload} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload PDF'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={onInputChange}
      />
    </div>
  );
}
