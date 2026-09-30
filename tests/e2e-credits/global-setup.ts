/**
 * Session du bureau de test « Grok Audit (TEST) » (viktor.audit@lume-test.ca),
 * par lien magique côté serveur : aucun mot de passe touché, rien d'écrit
 * sur le compte. Refuse tout autre bureau.
 * Variables : SUPABASE_URL_PROD, SUPABASE_SERVICE_ROLE_KEY_PROD (ou E2E_*).
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ORG_TEST = '0df93da0-dc34-481c-be91-bab69a4989b0';
const COURRIEL_TEST = 'viktor.audit@lume-test.ca';

/** Une session NEUVE du bureau de test (le jeton de rafraîchissement tourne : jamais partagé entre tests). */
export async function nouvelleSession(): Promise<Record<string, string>> {
  const url = process.env.E2E_SUPABASE_URL || process.env.SUPABASE_URL_PROD!;
  const service = process.env.E2E_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY_PROD!;
  const site = process.env.E2E_URL || 'https://lumecrm.net';
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: org } = await admin.from('orgs').select('name').eq('id', ORG_TEST).single();
  if (org?.name !== 'Grok Audit (TEST)') throw new Error('REFUS : pas le bureau de test');

  // La clé publique (anon) est celle que le site sert à tous les visiteurs.
  const html = await (await fetch(site)).text();
  const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  const anon = (await (await fetch(site + js)).text()).match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
  if (!anon) throw new Error('clé publique introuvable dans le site');

  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COURRIEL_TEST });
  if (error) throw error;
  const pub = createClient(url, anon, { auth: { persistSession: false } });
  const jeton = lien?.properties?.hashed_token;
  if (!jeton) throw new Error('lien magique sans jeton');
  const { data: sess, error: e2 } = await pub.auth.verifyOtp({ token_hash: jeton, type: 'magiclink' });
  if (e2 || !sess.session) throw e2 ?? new Error('pas de session');
  return { 'lume-auth-token': JSON.stringify(sess.session), 'lume-active-org': ORG_TEST };
}

/** Vérifie avant tout test que la session du bureau de test s'ouvre. */
export default async function globalSetup() {
  await nouvelleSession();
}
