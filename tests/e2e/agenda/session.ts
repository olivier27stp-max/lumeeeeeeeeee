/**
 * Session d'un compte de test de l'Agenda, injectée dans le navigateur
 * (clé `lume-auth-token`, celle de src/lib/supabase.ts) : pas de formulaire
 * de connexion à chaque test.
 */
import type { Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** La version courante de la politique de témoins, lue dans la source (consentApi importe le client navigateur). */
const CURRENT_COOKIE_POLICY_VERSION = /CURRENT_COOKIE_POLICY_VERSION = '([^']+)'/.exec(
  readFileSync(fileURLToPath(new URL('../../../src/lib/consentApi.ts', import.meta.url)), 'utf8'),
)?.[1] ?? '';

export const URL_APP = process.env.AGENDA_APP_URL || 'http://localhost:5283';
export const URL_SUPABASE = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:58321';
export const CLE_ANON = process.env.VITE_SUPABASE_ANON_KEY || '';

export async function seConnecter(page: Page, email = 'proprio@agenda.test'): Promise<void> {
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(URL_SUPABASE)) throw new Error('Les tests de l’Agenda ne visent que la base locale.');
  const sb = createClient(URL_SUPABASE, CLE_ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: 'DevLocal1234!' });
  if (error || !data.session) throw new Error(`connexion ${email} : ${error?.message}`);
  const session = JSON.stringify(data.session);
  // Le compte a déjà répondu à la bannière de témoins (version courante de la politique).
  const temoins = JSON.stringify({ analytics: false, marketing: false, preferences: true, decidedAt: '2026-09-30T00:00:00.000Z', docVersion: CURRENT_COOKIE_POLICY_VERSION });
  await page.addInitScript(([s, t]) => {
    localStorage.setItem('lume-auth-token', s);
    localStorage.setItem('lume-language', 'fr');
    localStorage.setItem('lume.cookieConsent.v1', t);
  }, [session, temoins] as const);
}
