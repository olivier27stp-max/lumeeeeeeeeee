// Profile photos. DiceBear is the default (UnifiedAvatar); a user can upload a
// real photo, saved to their own profiles.avatar_url (profiles RLS: a user can
// update their own row, id = auth.uid()).
//
// We store the file in the `job-photos` bucket (public, authenticated-write) —
// the `company-logos` bucket's RLS rejected the insert ("new row violates row-
// level security policy") whereas job-photos uploads are proven to work.

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../supabase';
import { STORAGE_BUCKETS, getPublicUrl, uploadBase64 } from '../storage';
import { tr } from '@/lib/i18n';

const AVATAR_BUCKET = STORAGE_BUCKETS.JOB_PHOTOS;

/** Camera capture with square (1:1) crop — clean profile photo. Null if cancelled. */
export async function captureAvatar(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error(tr().mobileErrors.cameraDenied);
  const res = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 1, exif: false });
  if (res.canceled || !res.assets?.[0]) return null;
  return res.assets[0].uri;
}

/** Library pick with square (1:1) crop. Null if cancelled. */
export async function pickAvatar(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(tr().mobileErrors.photoLibraryDenied);
  const res = await ImagePicker.launchImageLibraryAsync({
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    exif: false,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  return res.assets[0].uri;
}

async function compressSquare(uri: string): Promise<string> {
  const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 512 } }], {
    compress: 0.75,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: true,
  });
  if (!out.base64) throw new Error(tr().mobileErrors.imageFailed);
  return out.base64;
}

/** Upload a new profile photo for the signed-in user and save it to their profile. */
export async function uploadMyAvatar(userId: string, uri: string): Promise<string> {
  const b64 = await compressSquare(uri);
  const path = `avatars/${userId}_${Date.now()}.jpg`;
  await uploadBase64(AVATAR_BUCKET, path, b64, 'image/jpeg');
  const url = getPublicUrl(AVATAR_BUCKET, path);
  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);
  if (error) throw new Error(error.message);
  return url;
}

/** Reset to the generated DiceBear avatar (clears the stored photo). */
export async function clearMyAvatar(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) throw new Error(error.message);
}
