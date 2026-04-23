import { supabase } from './supabase';
import * as tus from 'tus-js-client';

export const STORAGE_BUCKETS = {
  COMPANY_LOGOS: 'company-logos',
  JOB_PHOTOS: 'job-photos',
  ATTACHMENTS: 'attachments',
} as const;

// Files larger than this go through TUS resumable upload (supports up to 50 GB on Supabase).
const RESUMABLE_THRESHOLD_BYTES = 6 * 1024 * 1024; // 6 MB

export interface UploadOptions {
  /** Called with a value 0..1 during upload. */
  onProgress?: (ratio: number) => void;
  /** AbortSignal to cancel the upload. */
  signal?: AbortSignal;
}

/**
 * Upload a file to Supabase Storage.
 * Automatically switches to TUS resumable upload for files > 6 MB so that
 * multi-gigabyte videos (e.g. 3h courses) go through. Calls `onProgress` so
 * the UI can show a real-time loading bar.
 */
export async function uploadFile(
  bucket: string,
  path: string,
  file: File,
  options: UploadOptions = {},
): Promise<{ url: string; path: string }> {
  const { onProgress, signal } = options;

  if (file.size <= RESUMABLE_THRESHOLD_BYTES) {
    // Fast path: single POST for small files.
    onProgress?.(0);
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { cacheControl: '3600', upsert: true });
    if (error) throw error;
    onProgress?.(1);
    return { url: getPublicUrl(bucket, data.path), path: data.path };
  }

  // Large files: use TUS resumable upload.
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('Not authenticated');

  const projectUrl = (supabase as any).supabaseUrl as string;
  if (!projectUrl) throw new Error('Supabase URL unavailable');

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${projectUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 1500, 3000, 6000],
      headers: {
        authorization: `Bearer ${token}`,
        'x-upsert': 'true',
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || 'application/octet-stream',
        cacheControl: '3600',
      },
      chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB chunks
      onError: (err) => reject(err),
      onProgress: (bytesSent, bytesTotal) => {
        onProgress?.(bytesTotal > 0 ? bytesSent / bytesTotal : 0);
      },
      onSuccess: () => resolve(),
    });

    if (signal) {
      if (signal.aborted) {
        upload.abort();
        reject(new DOMException('Upload aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => {
        upload.abort();
        reject(new DOMException('Upload aborted', 'AbortError'));
      });
    }

    upload.findPreviousUploads().then((previousUploads) => {
      if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]);
      upload.start();
    }).catch(reject);
  });

  return { url: getPublicUrl(bucket, path), path };
}

/**
 * Delete a file from Supabase Storage.
 */
export async function deleteFile(bucket: string, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

/**
 * Get the public URL for a file in Supabase Storage.
 */
export function getPublicUrl(bucket: string, path: string): string {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
