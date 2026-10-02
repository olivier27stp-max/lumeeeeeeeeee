/**
 * Outillage de la passe sur le VRAI site (https://lumecrm.net), bureau de test « Grok Audit (TEST) ».
 *
 * Garde-fous :
 *  · refuse tout autre bureau que celui-là (vérifié par son nom en base) ;
 *  · exige que le bureau soit en bac à sable (`orgs_envois_simules`) : aucun texto, courriel ni
 *    webhook ne peut partir ; `assurerBacASable()` l'y inscrit ;
 *  · n'écrit, par le client service_role, QUE dans ce bureau.
 *
 *   cd D:/lume-uiaudit/outils && PLAYWRIGHT_BROWSERS_PATH=D:/lume-uiaudit/pw-browsers \
 *     node --env-file=D:/lume-uiaudit/wt/.env.local mon-script.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { moniteur, inventaire } from './nav.mjs';

const require = createRequire('D:/lume-uiaudit/wt/package.json');
const pw = require('@playwright/test');
const { createClient } = require('@supabase/supabase-js');

export const SITE = 'https://lumecrm.net';
export const ORG = '0df93da0-dc34-481c-be91-bab69a4989b0';
export const NOM_ORG = 'Grok Audit (TEST)';
export const CAPTURES = 'D:/lume-uiaudit/sorties/captures-prod';
mkdirSync(CAPTURES, { recursive: true });
export { inventaire };

const url = process.env.SUPABASE_URL_PROD;
export const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY_PROD, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: org } = await admin.from('orgs').select('name').eq('id', ORG).single();
if (org?.name !== NOM_ORG) throw new Error('REFUS : pas le bureau de test.');

let anon = null;
async function cleAnon() {
  if (anon) return anon;
  const html = await (await fetch(SITE)).text();
  const js = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  anon = (await (await fetch(SITE + js)).text()).match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0];
  if (!anon) throw new Error('clé publique introuvable');
  return anon;
}

/** Inscrit le bureau de test au bac à sable (idempotent) et le vérifie. */
export async function assurerBacASable() {
  const { error } = await admin.from('orgs_envois_simules')
    .upsert({ org_id: ORG, mode: 'succes', raison: 'Audit UI Automatisations 2026-10-01 — bureau de test, aucun envoi réel' }, { onConflict: 'org_id' });
  if (error) throw new Error(`bac à sable : ${error.message}`);
  const { data } = await admin.from('orgs_envois_simules').select('org_id, mode').eq('org_id', ORG).maybeSingle();
  if (!data) throw new Error('ARRÊT : le bureau de test n’est pas en bac à sable.');
  return data;
}
export async function enBacASable() {
  const { data } = await admin.from('orgs_envois_simules').select('org_id').eq('org_id', ORG).maybeSingle();
  return !!data;
}

/** Les comptes du bureau de test, par rôle. */
export async function comptes() {
  const { data: m } = await admin.from('memberships').select('user_id, role, status, full_name').eq('org_id', ORG).eq('status', 'active');
  const out = {};
  for (const x of m ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(x.user_id);
    if (u?.user?.email) out[x.role] = { email: u.user.email, id: x.user_id, nom: x.full_name };
  }
  return out;
}

export async function session(email) {
  const { data: lien, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`lien magique : ${error.message}`);
  const pub = createClient(url, await cleAnon(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await pub.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (e2 || !s.session) throw new Error(`session ${email} : ${e2?.message}`);
  return s.session;
}

/** Ouvre un onglet connecté au bureau de test. o : { email, navigateur, viewport, langue, tactile } */
export async function ouvrir(o = {}) {
  if (!(await enBacASable())) throw new Error('ARRÊT : bureau de test hors bac à sable — lance assurerBacASable() d’abord.');
  const s = await session(o.email ?? 'viktor.audit@lume-test.ca');
  const type = o.navigateur ?? 'chromium';
  const browser = await pw[type].launch({ headless: true });
  const viewport = o.viewport ?? { width: 1440, height: 900 };
  const langue = o.langue ?? 'fr';
  const context = await browser.newContext({
    viewport, locale: langue === 'en' ? 'en-CA' : 'fr-CA', timezoneId: 'America/Toronto',
    ...(o.tactile ? { hasTouch: true, ...(type !== 'firefox' && viewport.width < 800 ? { isMobile: true } : {}) } : {}),
    ...(o.userAgent ? { userAgent: o.userAgent } : {}),
  });
  await context.addInitScript(({ s, org, langue }) => {
    if (location.origin !== 'https://lumecrm.net') return;
    if (sessionStorage.getItem('qa-init')) return;
    sessionStorage.setItem('qa-init', '1');
    localStorage.setItem('lume-auth-token', s);
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', langue);
    localStorage.setItem('lume-setup-dismissed', '1');
  }, { s: JSON.stringify(s), org: ORG, langue });
  const page = await context.newPage();
  page.setDefaultTimeout(o.delai ?? 20_000);
  const m = moniteur(page, SITE);
  return {
    page, context, browser, base: SITE, m, jeton: s.access_token,
    /** Répond au bandeau de témoins s'il est là (il recouvre le bas de l'écran). */
    temoins: async () => { const b = page.getByRole('button', { name: /Tout refuser|Reject all/ }); if (await b.count()) await b.first().click().catch(() => undefined); },
    fermer: async () => { await context.close().catch(() => undefined); await browser.close().catch(() => undefined); },
  };
}

export async function capture(page, nom, plein = false) {
  const chemin = join(CAPTURES, `${nom.replace(/[^a-z0-9-]+/gi, '_').slice(0, 90)}.png`);
  await page.screenshot({ path: chemin, fullPage: plein }).catch(() => undefined);
  return chemin;
}

/** Les règles du bureau de test dont le nom contient la marque — pour vérifier et faire le ménage. */
export async function reglesMarquees(marque) {
  const { data } = await admin.from('automation_rules').select('*').eq('org_id', ORG).ilike('name', `%${marque}%`).order('created_at');
  return data ?? [];
}
/** Ménage : met à la corbeille puis retire définitivement les règles marquées (bureau de test seulement). */
export async function nettoyer(marque) {
  if (!marque || marque.length < 6) throw new Error('marque trop courte');
  const regles = await reglesMarquees(marque);
  const ids = regles.map((r) => r.id);
  if (!ids.length) return 0;
  await admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids).eq('org_id', ORG);
  await admin.from('automation_rules').delete().in('id', ids).eq('org_id', ORG);
  return ids.length;
}
