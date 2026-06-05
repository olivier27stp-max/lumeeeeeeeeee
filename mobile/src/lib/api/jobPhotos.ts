// Job photos: capture/pick → compress → upload to the `job-photos` bucket →
// append metadata to jobs.attachments (mirrors the web's {url, path} shape).

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../supabase';
import { getPublicUrl, getSignedUrl, STORAGE_BUCKETS, uploadBase64 } from '../storage';
import { JobAttachment } from '@/types/db';

const MAX_WIDTH = 1600;
const THUMB_WIDTH = 320;

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type PickedImage = { uri: string };

/** Ask for camera permission and capture a photo. Returns null if cancelled. */
export async function capturePhoto(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera permission denied');
  const res = await ImagePicker.launchCameraAsync({ quality: 1, exif: false });
  if (res.canceled || !res.assets?.[0]) return null;
  return { uri: res.assets[0].uri };
}

/** Pick a photo from the library. Returns null if cancelled. */
export async function pickPhoto(): Promise<PickedImage | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library permission denied');
  const res = await ImagePicker.launchImageLibraryAsync({
    quality: 1,
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    exif: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  return { uri: res.assets[0].uri };
}

async function compress(uri: string, width: number): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!out.base64) throw new Error('Image compression failed');
  return out.base64;
}

/**
 * Upload a captured/picked image to a job: a web-sized image + a thumbnail,
 * then append both to jobs.attachments. Returns the new attachment.
 */
export async function uploadJobPhoto(params: {
  jobId: string;
  orgId: string;
  uri: string;
  userId?: string | null;
}): Promise<JobAttachment> {
  const { jobId, orgId, uri, userId } = params;
  const bucket = STORAGE_BUCKETS.JOB_PHOTOS;
  const id = randomId();
  const base = `${orgId}/${jobId}/${id}`;

  const [fullB64, thumbB64] = await Promise.all([
    compress(uri, MAX_WIDTH),
    compress(uri, THUMB_WIDTH),
  ]);

  const fullPath = `${base}.jpg`;
  const thumbPath = `${base}_thumb.jpg`;
  await uploadBase64(bucket, fullPath, fullB64);
  await uploadBase64(bucket, thumbPath, thumbB64);

  const attachment: JobAttachment = {
    url: getPublicUrl(bucket, fullPath), // for web interop
    path: fullPath,
    thumb_path: thumbPath,
    name: `${id}.jpg`,
    uploaded_by: userId ?? undefined,
    created_at: new Date().toISOString(),
    kind: 'photo',
  };

  await appendAttachment(jobId, attachment);
  return attachment;
}

/** Read-modify-write append to jobs.attachments (jsonb array). */
export async function appendAttachment(
  jobId: string,
  attachment: JobAttachment,
): Promise<void> {
  const { data: row, error: readErr } = await supabase
    .from('jobs')
    .select('attachments')
    .eq('id', jobId)
    .single();
  if (readErr) throw new Error(readErr.message);

  const current: JobAttachment[] = Array.isArray(row?.attachments) ? row.attachments : [];
  const next = [...current, attachment];

  const { error: writeErr } = await supabase
    .from('jobs')
    .update({ attachments: next })
    .eq('id', jobId);
  if (writeErr) throw new Error(writeErr.message);
}

/** Resolve a signed display URL for an attachment (private bucket safe). */
export async function attachmentDisplayUrl(
  att: JobAttachment,
  preferThumb = false,
): Promise<string | null> {
  const path = preferThumb && att.thumb_path ? att.thumb_path : att.path;
  return getSignedUrl(STORAGE_BUCKETS.JOB_PHOTOS, path);
}
