import { supabase } from './supabase'

const BUCKET = 'rfq-quote-pdfs'

/**
 * Path layout: {project_id}/{rfq_doc_id}/{response_id}/{filename}
 * The first segment is used by storage RLS to authorise via project_members.
 */
export function buildQuotePdfPath(projectId: string, rfqDocId: string, responseId: string, filename: string): string {
  // Strip path-unsafe chars from filename, preserve extension
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `${projectId}/${rfqDocId}/${responseId}/${safe}`
}

export interface QuotePdfUploadResult {
  path: string
  name: string
  sizeBytes: number
}

/**
 * Upload a quote PDF for a given RFQ response. Replaces any existing object at the same path.
 * Returns the storage path + metadata to persist on rfq_responses.
 */
export async function uploadQuotePdf(
  projectId: string,
  rfqDocId: string,
  responseId: string,
  file: File,
): Promise<QuotePdfUploadResult> {
  if (file.type !== 'application/pdf') throw new Error('Only PDF files are allowed')
  const maxBytes = 10 * 1024 * 1024
  if (file.size > maxBytes) throw new Error(`PDF must be under 10MB (got ${(file.size / (1024 * 1024)).toFixed(1)}MB)`)

  const path = buildQuotePdfPath(projectId, rfqDocId, responseId, file.name)
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (error) throw new Error(`Upload failed: ${error.message}`)

  return { path, name: file.name, sizeBytes: file.size }
}

/**
 * Get a short-lived signed URL to view/download a quote PDF.
 * 5-minute TTL is enough for a click-to-view interaction without leaving long-lived URLs around.
 */
export async function getQuotePdfSignedUrl(path: string, expiresInSec = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSec)
  if (error) throw new Error(`Could not get signed URL: ${error.message}`)
  return data.signedUrl
}

/**
 * Delete a quote PDF. Used when removing an attachment or deleting a response.
 * Failures are non-fatal — the response row is the source of truth, the orphaned object
 * just takes up space until manual cleanup.
 */
export async function deleteQuotePdf(path: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) console.warn(`Failed to delete quote PDF at ${path}: ${error.message}`)
}

/**
 * Format a byte count for display, matching the HTML format ("123 KB" / "1.4 MB").
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
