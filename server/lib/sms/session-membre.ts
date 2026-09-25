/**
 * Une vraie session pour le membre qui écrit par texto.
 * ─────────────────────────────────────────────────────
 * Sans session, Lumi répond aux questions simples et échoue sur tout le
 * reste. Mesuré en production le 2026-09-24 : « regarde mes relances » →
 * « ça bogue de mon côté ». La cause n'est ni le texto ni l'assistant, c'est
 * l'identité.
 *
 * Une vingtaine d'outils passent par des fonctions de base de données gardées
 * par `has_org_membership(auth.uid(), org_id)` — factures, relances, rapports,
 * écritures. Avec le client de service, `auth.uid()` est NUL : la base refuse,
 * et elle a raison de le faire.
 *
 * On donne donc au canal texto ce que le navigateur a déjà : un jeton du
 * membre. Les permissions de la page Rôles s'appliquent alors exactement
 * comme dans l'application — c'est le but, pas un effet de bord.
 *
 * Le jeton est gardé en mémoire le temps de sa validité : créer une session
 * par texto multiplierait les lignes dans `auth.sessions` pour rien.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseAnonKey } from '../config';
import { getServiceClient } from '../supabase';
import { logger } from '../logger';

/** Marge avant l'expiration réelle : on renouvelle avant d'échouer. */
const MARGE_MS = 5 * 60 * 1000;

interface Entree { token: string; expireA: number }
const cache = new Map<string, Entree>();

/** Vide le cache — les tests en ont besoin, et un changement de mot de passe aussi. */
export function oublierSession(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * Un jeton d'accès pour cet utilisateur, ou `null`.
 *
 * `generateLink` + `verifyOtp` crée une session PROPRE au canal : elle ne
 * touche pas celle du navigateur, et l'usage normal de Lume ne la tue pas
 * (voir `oauth.ts`, même mécanique, même raison).
 *
 * L'identité est déjà vérifiée en amont par le numéro de téléphone
 * (`identifier-membre`) : aucune élévation de privilège ici.
 */
export async function jetonPourMembre(userId: string): Promise<string | null> {
  const vu = cache.get(userId);
  if (vu && vu.expireA > Date.now() + MARGE_MS) return vu.token;

  const admin = getServiceClient();
  // `getUserById` LÈVE sur un identifiant mal formé (et non une erreur
  // renvoyée) : sans ce try, un numéro rattaché à un compte supprimé ferait
  // remonter l'exception jusqu'au webhook.
  let email: string | undefined;
  try {
    const { data: u, error: eUser } = await admin.auth.admin.getUserById(userId);
    if (eUser) throw new Error(eUser.message);
    email = u?.user?.email;
  } catch (e: any) {
    logger.error('[sms/session] utilisateur introuvable — pas de session possible', { userId, error: e?.message || String(e) });
    return null;
  }
  if (!email) {
    logger.error('[sms/session] utilisateur sans courriel — pas de session possible', { userId });
    return null;
  }

  // `generateLink`/`verifyOtp` échoue par intermittence (latence GoTrue) :
  // mesuré ~15 % dans oauth.ts. Un hoquet ne doit pas rendre Lumi muet.
  for (let essai = 1; essai <= 3; essai += 1) {
    try {
      const { data: lien, error: e1 } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
      if (e1 || !lien?.properties?.hashed_token) throw new Error(e1?.message || 'pas de hashed_token');

      const anon = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: sess, error: e2 } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
      const token = sess?.session?.access_token;
      if (e2 || !token) throw new Error(e2?.message || 'pas d’access_token');

      const expiresIn = Number(sess.session?.expires_in ?? 3600) * 1000;
      cache.set(userId, { token, expireA: Date.now() + expiresIn });
      return token;
    } catch (e: any) {
      logger.error(`[sms/session] essai ${essai}/3`, { userId, error: e?.message || String(e) });
      if (essai < 3) await new Promise((r) => setTimeout(r, 400 * essai));
    }
  }
  return null;
}

/**
 * Le client Supabase à donner aux outils : celui du membre quand on a pu
 * ouvrir une session, le client de service sinon.
 *
 * Le repli n'est pas une faille : sans session, la base refuse les fonctions
 * gardées, donc on est plus restreint, jamais plus permissif. Lumi répondra
 * aux questions simples et dira honnêtement qu'il n'a pas pu pour le reste.
 */
export async function clientPourMembre(
  userId: string,
  bureau: string,
): Promise<{ client: SupabaseClient; accessToken?: string }> {
  const token = await jetonPourMembre(userId);
  if (!token) return { client: getServiceClient() };
  return {
    // `x-lume-org` = le bureau qui possède le numéro texté. Sans lui, les
    // fonctions qui lisent current_org_id() (création de job, de soumission)
    // écrivaient dans le PLUS ANCIEN bureau du membre (fuite H1, 2026-09-25).
    client: createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}`, 'x-lume-org': bureau } },
    }),
    accessToken: token,
  };
}
