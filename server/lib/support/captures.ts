/**
 * Captures d'écran du support (2026-09-17).
 * ──────────────────────────────────────────
 * « Ça marche pas » sans image, c'est une escalade qui repart avec une
 * question. Le client joint jusqu'à MAX_CAPTURES images à son message :
 *   1. POST /api/support/captures (corps image/*, ≤ 6 Mo, réduit à 1 600 px
 *      par le navigateur) → le serveur la range dans le bucket privé
 *      `support-captures` sous <org>/<user>/<uuid>.<ext> et renvoie la pièce ;
 *   2. POST /api/support/chat { captures: [chemin…] } : le serveur vérifie
 *      que chaque chemin est bien sous l'org du client (verifierChemins),
 *      les attache au message, les donne à Lumi en blocs image, et les
 *      envoie à l'équipe dans Slack par lien signé 7 jours.
 * Le client relit ses propres captures par lien signé 1 h (vue du ticket).
 * Aucune policy storage : service_role seul.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { logger } from '../logger';

export const BUCKET_CAPTURES = 'support-captures';
export const MAX_CAPTURES = 3;
export const TAILLE_MAX_OCTETS = 6 * 1024 * 1024;
export const LIEN_CLIENT_S = 3600;
export const LIEN_EQUIPE_S = 7 * 86_400;

export type TypeImage = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
export interface Piece { chemin: string; nom: string; type: TypeImage; taille: number }

const EXT: Record<TypeImage, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export function typeImage(contentType: string | undefined): TypeImage | null {
  const t = String(contentType || '').split(';')[0].trim().toLowerCase();
  return t in EXT ? (t as TypeImage) : null;
}

/** Nom lisible et sûr pour Slack et l'app : « Capture 2026-09-17 à 14.03.png » → « Capture-2026-09-17-a-14.03.png ». */
export function nomSur(nom: string | undefined, type: TypeImage): string {
  const base = String(nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const propre = base && /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base || 'capture'}.${EXT[type]}`;
  return propre;
}

export function cheminCapture(orgId: string, userId: string, type: TypeImage): string {
  return `${orgId}/${userId}/${randomUUID()}.${EXT[type]}`;
}

export interface CaptureDemandee { chemin: string; nom?: string }

/** Chaque chemin doit être sous l'org du client (pas d'accès aux captures d'une autre entreprise), et pas plus de MAX_CAPTURES. Pur. */
export function verifierChemins(orgId: string, captures: unknown): CaptureDemandee[] | null {
  if (!Array.isArray(captures) || captures.length > MAX_CAPTURES) return null;
  const out: CaptureDemandee[] = [];
  for (const c of captures) {
    const chemin = typeof c === 'string' ? c : c && typeof c === 'object' ? (c as { chemin?: unknown }).chemin : null;
    const nom = c && typeof c === 'object' ? (c as { nom?: unknown }).nom : undefined;
    if (typeof chemin !== 'string' || !chemin.startsWith(`${orgId}/`) || chemin.includes('..') || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(chemin)) return null;
    out.push({ chemin, nom: typeof nom === 'string' ? nom.slice(0, 120) : undefined });
  }
  return out;
}

export async function televerserCapture(admin: SupabaseClient, p: { orgId: string; userId: string; type: TypeImage; nom?: string; octets: Buffer }): Promise<Piece> {
  const chemin = cheminCapture(p.orgId, p.userId, p.type);
  const { error } = await admin.storage.from(BUCKET_CAPTURES).upload(chemin, p.octets, { contentType: p.type, upsert: false });
  if (error) throw new Error(`capture upload : ${error.message}`);
  return { chemin, nom: nomSur(p.nom, p.type), type: p.type, taille: p.octets.length };
}

/** Les pièces (métadonnées) des chemins déjà téléversés : on relit l'objet pour le type et la taille ; le nom vient du client (rendu sûr). */
export async function piecesDepuisChemins(admin: SupabaseClient, captures: CaptureDemandee[]): Promise<Piece[]> {
  const out: Piece[] = [];
  for (const { chemin, nom } of captures) {
    const dossier = chemin.slice(0, chemin.lastIndexOf('/'));
    const fichier = chemin.slice(chemin.lastIndexOf('/') + 1);
    const { data } = await admin.storage.from(BUCKET_CAPTURES).list(dossier, { search: fichier, limit: 1 });
    const obj = (data || []).find((o) => o.name === fichier);
    const type = typeImage(obj?.metadata?.mimetype) ?? (fichier.endsWith('.png') ? 'image/png' : fichier.endsWith('.webp') ? 'image/webp' : fichier.endsWith('.gif') ? 'image/gif' : 'image/jpeg');
    out.push({ chemin, nom: nomSur(nom || fichier, type), type, taille: Number(obj?.metadata?.size ?? 0) });
  }
  return out;
}

/** L'image en base64 pour le modèle (null si introuvable : Lumi répond sans). */
export async function lireCaptureBase64(admin: SupabaseClient, piece: Piece): Promise<{ media_type: TypeImage; data: string } | null> {
  const { data, error } = await admin.storage.from(BUCKET_CAPTURES).download(piece.chemin);
  if (error || !data) { logger.warn('[support/captures] lecture impossible', { chemin: piece.chemin, error: error?.message }); return null; }
  return { media_type: piece.type, data: Buffer.from(await data.arrayBuffer()).toString('base64') };
}

/** Liens signés (client : 1 h ; équipe : 7 jours). Une pièce illisible est simplement omise. */
export async function liensPieces(admin: SupabaseClient, pieces: Piece[] | null | undefined, secondes: number): Promise<Array<{ nom: string; url: string }>> {
  const out: Array<{ nom: string; url: string }> = [];
  for (const p of pieces || []) {
    const { data, error } = await admin.storage.from(BUCKET_CAPTURES).createSignedUrl(p.chemin, secondes);
    if (error || !data) { logger.warn('[support/captures] signature impossible', { chemin: p.chemin, error: error?.message }); continue; }
    out.push({ nom: p.nom, url: data.signedUrl });
  }
  return out;
}

/** « 📎 <url|nom> · <url|nom> » pour un message Slack (mrkdwn), ou ''. */
export function pieceJointeSlack(liens: Array<{ nom: string; url: string }>): string {
  return liens.length ? `\n📎 ${liens.map((l) => `<${l.url}|${l.nom.replace(/[<>|]/g, '')}>`).join(' · ')}` : '';
}
