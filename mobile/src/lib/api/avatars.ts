// Photos de profil et bannières — MÊMES chemins et MÊME bucket que le web,
// pour qu'une photo changée d'un côté se voie de l'autre.
//
//   photo    → avatars/{orgId}/avatars/{userId}.jpg
//   bannière → avatars/{orgId}/banners/{userId}
//
// ⚠️ Ce fichier écrivait avant dans `job-photos`, au chemin
// `avatars/{userId}_{ts}.jpg`. Deux bugs en un :
//  1. La policy d'écriture de `job-photos` exige
//     `has_org_membership(auth.uid(), lume_storage_object_org(name))`, et cette
//     fonction ne lit un org que dans les DEUX premiers segments du chemin.
//     Ici le 1er segment valait « avatars » et le 2e « <uuid>_<ts>.jpg » :
//     aucun des deux n'est un UUID → org null → refus.
//     C'est le « new row violates row-level security policy » signalé.
//  2. `job-photos` est un bucket PRIVÉ : même réussi, `getPublicUrl()` aurait
//     rendu une adresse qui ne charge pas.
//
// L'écriture passe par le relais serveur, comme le web : les policies du
// bucket `avatars` n'autorisent un client que sous `{auth.uid()}/…`, alors que
// la convention partagée est `{orgId}/…`.

import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '../supabase';
import { STORAGE_BUCKETS, getPublicUrl, uploadViaServer } from '../storage';
import { tr } from '@/lib/i18n';

const AVATAR_BUCKET = STORAGE_BUCKETS.AVATARS;

/** Chemin de la photo de profil — identique au web (ProfileSettings.tsx). */
function cheminAvatar(orgId: string, userId: string): string {
  return `${orgId}/avatars/${userId}.jpg`;
}

/** Chemin de la bannière — identique au web. Aucune colonne en base : c'est une convention. */
export function cheminBanniere(orgId: string, userId: string): string {
  return `${orgId}/banners/${userId}`;
}

/**
 * Adresse de la bannière d'une personne, ou null sans bureau. Le fichier peut
 * ne pas exister (personne n'en a jamais mis) : l'appelant retombe alors sur
 * le fond uni, comme le web.
 */
export function bannerUrl(orgId: string | null, userId: string | null): string | null {
  if (!orgId || !userId) return null;
  return getPublicUrl(AVATAR_BUCKET, cheminBanniere(orgId, userId));
}

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

/** Téléverse une nouvelle photo de profil et l'enregistre sur la fiche. */
export async function uploadMyAvatar(userId: string, uri: string, orgId: string): Promise<string> {
  if (!orgId) throw new Error(tr().mobileErrors.imageFailed);
  const b64 = await compressSquare(uri);
  const { url: publicUrl } = await uploadViaServer(
    AVATAR_BUCKET,
    cheminAvatar(orgId, userId),
    b64,
    'image/jpeg',
    { upsert: true },
  );
  // Le chemin est stable (une photo par personne) : sans ce paramètre, l'ancienne
  // image resterait en cache et le changement ne se verrait pas. Le web fait pareil.
  const url = `${publicUrl}?v=${Date.now()}`;

  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);
  if (error) throw new Error(error.message);
  // Le web écrit AUSSI sur team_members : c'est cette colonne que lisent le
  // classement, la carte et l'en-tête. Sans elle, la photo ne changeait qu'à
  // moitié d'un bord à l'autre.
  await supabase.from('team_members').update({ avatar_url: url }).eq('user_id', userId);
  return url;
}

/** Reset to the generated DiceBear avatar (clears the stored photo). */
export async function clearMyAvatar(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) throw new Error(error.message);
  await supabase.from('team_members').update({ avatar_url: null }).eq('user_id', userId);
}
