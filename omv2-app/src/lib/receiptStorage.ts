/**
 * receiptStorage.ts
 * Handles upload, delete, and signed-URL generation for expense receipts.
 * Files live in Supabase Storage bucket 'receipts'.
 * Path format: receipts/{project_id}/{expense_id}/{filename}
 */

import { supabase } from './supabase'

export const RECEIPT_BUCKET = 'receipts'
const SIGNED_URL_EXPIRY = 3600 // 1 hour

export async function uploadReceipt(
  projectId: string,
  expenseId: string,
  file: File,
): Promise<{ path: string; error: string | null }> {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${projectId}/${expenseId}/${Date.now()}_${safeName}`

  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false })

  if (error) return { path: '', error: error.message }
  return { path, error: null }
}

export async function deleteReceipt(path: string): Promise<string | null> {
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).remove([path])
  return error ? error.message : null
}

export async function getSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY)
  if (error || !data) return null
  return data.signedUrl
}

export function fileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return '📄'
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) return '🖼'
  return '📎'
}

export function fileName(path: string): string {
  // path is projectId/expenseId/timestamp_filename.ext
  const parts = path.split('/')
  const raw = parts[parts.length - 1] || path
  // strip the leading timestamp_
  return raw.replace(/^\d+_/, '')
}
