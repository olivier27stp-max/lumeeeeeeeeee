// React Native storage helpers for Supabase Storage.
// Unlike the web `src/lib/storage.ts` (which uploads a browser `File`), mobile
// uploads raw bytes (ArrayBuffer) decoded from a base64 image, and renders
// private buckets via signed URLs.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'base64-arraybuffer';
// `fetch` de React Native passe par XHR et n'envoie pas proprement un corps
// binaire ; celui d'Expo est conforme WinterCG et accepte un Uint8Array.
import { fetch as fetchBinaire } from 'expo/fetch';

import { ACTIVE_ORG_KEY } from './membership';
import { supabase } from './supabase';

export const STORAGE_BUCKETS = {
  COMPANY_LOGOS: 'company-logos',
  JOB_PHOTOS: 'job-photos',
  ATTACHMENTS: 'attachments',
  /** Photos de profil ET bannières — public, mêmes chemins que le web. */
  AVATARS: 'avatars',
} as const;

/**
 * Téléverse une image par le RELAIS SERVEUR (`POST /api/storage/upload`),
 * comme le fait le web (`uploadViaServer` dans src/lib/storage.ts).
 *
 * Pourquoi pas en direct : les policies RLS de `storage.objects` n'autorisent
 * un client à écrire dans `avatars` que sous `{auth.uid()}/…`, alors que la
 * convention de chemin partagée avec le web est `{orgId}/…`. Le relais
 * s'authentifie, force le chemin sous le bureau de l'appelant, puis écrit avec
 * la clé de service — le même chemin des deux côtés, sans policy à contourner.
 */
export async function uploadViaServer(
  bucket: string,
  path: string,
  base64: string,
  contentType = 'image/jpeg',
  options: { upsert?: boolean } = {},
): Promise<{ url: string; path: string }> {
  const base = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/$/, '') ?? '';
  if (!base) throw new Error('EXPO_PUBLIC_WEB_URL manquant.');

  const { data } = await supabase.auth.getSession();
  let session = data.session;
  if (session && (session.expires_at ?? 0) * 1000 < Date.now() + 60_000) {
    const { data: r } = await supabase.auth.refreshSession();
    if (r.session) session = r.session;
  }
  const token = session?.access_token;
  if (!token) throw new Error('Non connecté.');

  const org = (await AsyncStorage.getItem(ACTIVE_ORG_KEY)) ?? '';
  const qs = `?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}${options.upsert ? '&upsert=true' : ''}`;

  // Le serveur lit un corps binaire brut (express.raw, type image/*).
  const res = await fetchBinaire(`${base}/api/storage${qs.replace('?', '/upload?')}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
      'X-Requested-With': 'XMLHttpRequest',
      ...(org ? { 'x-org-id': org } : {}),
    },
    body: new Uint8Array(decode(base64)),
  });
  const body = (await res.json().catch(() => ({}))) as { url?: string; path?: string; error?: string };
  if (!res.ok) throw new Error(body?.error || `Téléversement refusé (${res.status}).`);
  return { url: body.url as string, path: body.path as string };
}

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
