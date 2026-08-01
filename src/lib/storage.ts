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
 * Authenticated server relay for image uploads blocked by storage RLS.
 * The path MUST start with the caller's org id (`${orgId}/…`) — the server
 * rejects anything else. Exported for buckets with no client INSERT policy
 * at all (e.g. `avatars`), where trying the direct upload first is pointless.
 */
export async function uploadViaServer(
  bucket: string,
  path: string,
  file: File,
  options: { upsert?: boolean } = {},
): Promise<{ url: string; path: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not authenticated');
  let activeOrg = '';
  try { activeOrg = localStorage.getItem('lume-active-org') || ''; } catch {}

  const upsertParam = options.upsert ? '&upsert=true' : '';
  const res = await fetch(`/api/storage/upload?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}${upsertParam}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Requested-With': 'XMLHttpRequest',
      ...(activeOrg ? { 'x-org-id': activeOrg } : {}),
    },
    body: file,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Upload failed (${res.status}).`);
  return { url: body.url as string, path: body.path as string };
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
    // upsert:false — all call sites use unique timestamped paths, and upsert
    // requires a storage UPDATE policy the live DB doesn't have (it made every
    // upload fail with "new row violates row-level security policy").
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (error) {
      // The live DB's storage INSERT policies have drifted for some buckets.
      // Image uploads fall back to the authenticated server relay, which
      // enforces org-scoped paths and uploads via the service client.
      if (/row-level security/i.test(error.message || '') && file.type.startsWith('image/')) {
        const relayed = await uploadViaServer(bucket, path, file);
        onProgress?.(1);
        return relayed;
      }
      throw error;
    }
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
        // Same as the fast path: no upsert — unique paths, and the live DB has
        // no storage UPDATE policy, so upsert trips RLS.
        'x-upsert': 'false',
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

// Buckets made private by migration 20260717250000 — the DB still stores
// public-format URLs for them, which now 400 in the browser. Display code
// must resolve those to signed URLs.
const PRIVATE_BUCKETS = new Set(['attachments', 'job-photos', 'director-panel']);

// Long enough to cover a full course session (3h videos use range requests
// against the same signed URL throughout playback).
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 12;

const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Resolve a stored storage URL for display. Public-format URLs pointing at a
 * private bucket are exchanged for a signed URL (cached); anything else
 * (external links, public buckets) is returned unchanged.
 */
export async function resolveStorageUrl(url: string): Promise<string> {
  const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/([^?]+)/);
  if (!match || !PRIVATE_BUCKETS.has(match[1])) return url;

  const cached = signedUrlCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const path = decodeURIComponent(match[2]);
  const { data, error } = await supabase.storage
    .from(match[1])
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return url;

  // Expire the cache entry 5 min before the URL itself so we never hand out
  // an about-to-die link.
  signedUrlCache.set(url, {
    url: data.signedUrl,
    expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 300) * 1000,
  });
  return data.signedUrl;
}
