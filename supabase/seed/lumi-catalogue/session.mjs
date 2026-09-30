#!/usr/bin/env node
/**
 * Ouvre une session Supabase pour un compte de test du catalogue (STAGING).
 * Aucun mot de passe : lien magique généré par la clé service puis vérifié.
 *
 *   import { ouvrirSession } from './supabase/seed/lumi-catalogue/session.mjs';
 *   const s = await ouvrirSession('comptable');   // clé de PERSONNES (donnees.mjs)
 *   fetch(`${API}/api/lumi/chat`, { headers: { Authorization: `Bearer ${s.accessToken}`, 'x-lume-org': s.orgId } … })
 *
 * En ligne de commande (vérifie seulement que la connexion marche, n'affiche pas le jeton) :
 *   node --env-file=.env.local supabase/seed/lumi-catalogue/session.mjs comptable
 */
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { PERSONNES, BUREAUX } from './donnees.mjs';

export async function ouvrirSession(cle, bureau = null) {
  const p = PERSONNES[cle];
  if (!p) throw new Error(`compte inconnu : ${cle} (${Object.keys(PERSONNES).join(', ')})`);
  const url = process.env.VITE_SUPABASE_URL ?? '';
  const refProd = process.env.SUPABASE_PROJECT_REF_PROD;
  if (!refProd || url.includes(refProd)) throw new Error('Refus : ces comptes de test n\'existent que sur staging.');
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', opts);
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: p.courriel });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', opts);
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session : ${e2?.message ?? 'aucune'}`);
  return { accessToken: s.session.access_token, userId: s.session.user.id, orgId: BUREAUX[bureau ?? p.bureaux[0]].id, courriel: p.courriel };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const s = await ouvrirSession(process.argv[2] ?? 'proprio', process.argv[3] ?? null);
  console.log(`Session ouverte pour ${s.courriel} (bureau ${s.orgId}).`);
}
