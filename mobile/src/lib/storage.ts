// React Native storage helpers for Supabase Storage.
// Unlike the web `src/lib/storage.ts` (which uploads a browser `File`), mobile
// uploads raw bytes (ArrayBuffer) decoded from a base64 image, and renders
// private buckets via signed URLs.

import { decode } from 'base64-arraybuffer';

import { supabase } from './supabase';

export const STORAGE_BUCKETS = {
  COMPANY_LOGOS: 'company-logos',
  JOB_PHOTOS: 'job-photos',
  ATTACHMENTS: 'attachments',
} as const;

/** Upload base64 image bytes to a bucket. Returns the stored object path. */
export async function uploadBase64(
  bucket: string,
  path: string,
  base64: string,
  contentType = 'image/jpeg',
): Promise<{ path: string }> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, decode(base64), {
      cacheControl: '3600',
      upsert: true,
      contentType,
    });
  if (error) throw error;
  return { path: data.path };
}

/** Public URL (works only if the bucket is public). Stored for web interop. */
export function getPublicUrl(bucket: string, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Signed URL for a private bucket. Robust for both private and public buckets,
 * so we use it for rendering on mobile regardless of bucket visibility.
 */
export async function getSignedUrl(
  bucket: string,
  path: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data.signedUrl;
}

export async function removeFile(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}
