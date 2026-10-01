/**
 * Outils communs des scripts de l'agent A (mission « correction finale Automatisations »).
 *
 * Tout tourne contre la PILE LOCALE (refus sinon) et dans les bureaux
 * « [TEST] QA Automatisations A/B (a) » (QA_AUTO_SUFFIXE=a).
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/<script>.mts
 *
 * Les sorties (captures, JSON) vont HORS du worktree : D:/lume-final/sorties/a.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assurerBureauTest, COMPTES, type BureauTest } from '../../../../tests/automations-suite/harnais/bureau-test';

export const URL_SUPABASE = process.env.VITE_SUPABASE_URL ?? '';
if (!/localhost|127\.0\.0\.1/.test(URL_SUPABASE)) {
  throw new Error('REFUS : les scripts de l’agent A ne visent que la pile LOCALE (VITE_SUPABASE_URL doit être localhost).');
}
if ((process.env.QA_AUTO_SUFFIXE ?? '') !== 'a') {
  throw new Error('REFUS : QA_AUTO_SUFFIXE=a obligatoire (bureaux de test de l’agent A).');
}

export const API = process.env.QA_A_API ?? 'http://127.0.0.1:3492';
export const APP = process.env.QA_A_APP ?? 'http://127.0.0.1:5492';
export const SORTIES = process.env.QA_A_SORTIES ?? 'D:/lume-final/sorties/a';
mkdirSync(SORTIES, { recursive: true });

export const admin: SupabaseClient = createClient(URL_SUPABASE, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

let bureau: Promise<BureauTest> | null = null;
export function bureauA(): Promise<BureauTest> {
  if (!bureau) {
    bureau = assurerBureauTest(admin).then(async (b) => {
      // Le consentement de localisation est tranché d'avance : sa fenêtre capte tous les clics
      // (même geste que tests/automations-suite/harnais/serveurs-ui.ts).
      for (const id of Object.values(b.users)) {
        await admin.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);
      }
      return b;
    });
  }
  return bureau;
}
export { COMPTES };

/** Une session complète d'un compte de test (lien magique → verifyOtp, aucun courriel). */
export async function session(email: string) {
  const anon = process.env.VITE_SUPABASE_ANON_KEY ?? '';
  // La pile locale est partagée entre agents : une coupure passagère (ECONNRESET) se réessaie.
  let derniere = '';
  for (let essai = 0; essai < 4; essai++) {
    const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (error) { derniere = `lien magique : ${error.message}`; await new Promise((r) => setTimeout(r, 800 * (essai + 1))); continue; }
    const { data: s, error: e2 } = await createClient(URL_SUPABASE, anon, { auth: { persistSession: false, autoRefreshToken: false } })
      .auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
    if (e2 || !s.session) { derniere = `session ${email} : ${e2?.message}`; await new Promise((r) => setTimeout(r, 800 * (essai + 1))); continue; }
    return s.session;
  }
  throw new Error(derniere);
}

const VERSION_TEMOINS = (() => {
  const src = readFileSync(join(process.cwd(), 'src/lib/consentApi.ts'), 'utf8');
  return src.match(/CURRENT_COOKIE_POLICY_VERSION\s*=\s*'([^']+)'/)?.[1] ?? '';
})();

let navigateur: Browser | null = null;
export async function fermerNavigateur(): Promise<void> {
  await navigateur?.close().catch(() => undefined);
  navigateur = null;
}

export interface Onglet {
  context: BrowserContext;
  page: Page;
  erreurs: string[];
  /** Chaque appel /api/* vu par l'onglet : méthode, chemin, statut, corps envoyé (tronqué). */
  appels: Array<{ methode: string; chemin: string; statut: number; envoye: string }>;
  fermer: () => Promise<void>;
}

/** Un onglet Chromium connecté au bureau A (a), au vrai Vite local. */
export async function ouvrirOnglet(o: { langue?: 'fr' | 'en'; email?: string; viewport?: { width: number; height: number } } = {}): Promise<Onglet> {
  const b = await bureauA();
  const s = await session(o.email ?? COMPTES.proprioA.email);
  if (!navigateur?.isConnected()) navigateur = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });
  const context = await navigateur.newContext({
    viewport: o.viewport ?? { width: 1440, height: 900 },
    locale: o.langue === 'en' ? 'en-CA' : 'fr-CA',
    timezoneId: 'America/Toronto',
  });
  const jeton = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, expires_in: s.expires_in, token_type: 'bearer', user: s.user };
  await context.addInitScript(({ jeton, org, langue, origine, version }) => {
    if (location.origin !== origine) return;
    if (sessionStorage.getItem('qa-ui-init')) return;
    sessionStorage.setItem('qa-ui-init', '1');
    localStorage.setItem('lume-auth-token', JSON.stringify(jeton));
    localStorage.setItem('lume-active-org', org);
    localStorage.setItem('lume-language', langue);
    localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: version }));
    localStorage.setItem('lume-setup-dismissed', '1');
  }, { jeton, org: b.orgA, langue: o.langue ?? 'fr', origine: APP, version: VERSION_TEMOINS });
  const page = await context.newPage();
  page.setDefaultTimeout(25_000);
  const erreurs: string[] = [];
  const appels: Onglet['appels'] = [];
  page.on('console', (m) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/api/')) return;
    const req = r.request();
    appels.push({ methode: req.method(), chemin: u.pathname + u.search, statut: r.status(), envoye: (req.postData() ?? '').slice(0, 4000) });
  });
  return { context, page, erreurs, appels, fermer: () => context.close().catch(() => undefined) };
}

export async function capturer(page: Page, nom: string): Promise<string> {
  const chemin = join(SORTIES, `${nom.replace(/[^a-z0-9-]+/gi, '_').slice(0, 80)}.png`);
  await page.screenshot({ path: chemin, fullPage: false }).catch(() => undefined);
  return chemin;
}

export interface LigneRegle {
  id: string; org_id: string; name: string; trigger_event: string;
  conditions: Record<string, unknown> | null; delay_seconds: number;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  steps: Array<Record<string, any>> | null; settings: Record<string, unknown> | null;
  is_active: boolean; is_preset: boolean; deleted_at: string | null; purged_at: string | null;
  updated_at: string; created_at: string; lumi_conversation: Array<{ role: string; content: string }> | null;
}

export async function lireRegle(id: string): Promise<LigneRegle> {
  const { data, error } = await admin.from('automation_rules').select('*').eq('id', id).single();
  if (error) throw new Error(`lecture de la règle ${id} : ${error.message}`);
  return data as LigneRegle;
}

/** Les textes de tous les messages (texto, courriel) de `steps` et de `actions`, côte à côte. */
export function messagesDe(r: Pick<LigneRegle, 'steps' | 'actions'>): { steps: string[]; actions: string[] } {
  const corps = (a: any) => `${a?.type}:${String(a?.config?.subject ? `[${a.config.subject}] ` : '')}${String(a?.config?.body ?? '')}`;
  return {
    steps: (r.steps ?? []).filter((e) => e?.type === 'action' && ['send_sms', 'send_email'].includes(e.action?.type)).map((e) => corps(e.action)),
    actions: (r.actions ?? []).filter((a) => ['send_sms', 'send_email'].includes(a?.type)).map(corps),
  };
}

/** Ménage : dépublie, met à la corbeille et purge toute règle du bureau A dont le nom contient la marque. */
export async function nettoyer(marque: string): Promise<number> {
  const b = await bureauA();
  const { data } = await admin.from('automation_rules').select('id').eq('org_id', b.orgA).ilike('name', `%${marque}%`);
  const ids = (data ?? []).map((r) => r.id as string);
  if (!ids.length) return 0;
  await admin.from('automation_scheduled_tasks').update({ status: 'cancelled' }).in('automation_rule_id', ids).eq('status', 'pending');
  const maintenant = new Date().toISOString();
  await admin.from('automation_rules').update({ is_active: false, deleted_at: maintenant, purged_at: maintenant }).in('id', ids);
  return ids.length;
}

/**
 * Ménage par DATE : toute règle non fournie (is_preset = false) du bureau A créée depuis `debut`.
 * Nécessaire quand Lumi a RENOMMÉ la règle (constat A-04) : la marque du nom a disparu.
 */
export async function nettoyerDepuis(debut: string): Promise<number> {
  const b = await bureauA();
  const { data } = await admin.from('automation_rules').select('id').eq('org_id', b.orgA).eq('is_preset', false).gte('created_at', debut);
  const ids = (data ?? []).map((r) => r.id as string);
  if (!ids.length) return 0;
  await admin.from('automation_scheduled_tasks').update({ status: 'cancelled' }).in('automation_rule_id', ids).eq('status', 'pending');
  const maintenant = new Date().toISOString();
  await admin.from('automation_rules').update({ is_active: false, deleted_at: maintenant, purged_at: maintenant }).in('id', ids);
  return ids.length;
}

export function marque(sujet: string): string {
  return `[QA-A ${sujet} ${Date.now().toString(36)}]`;
}

/** Dépense Lumi du bureau depuis un instant (ai_usage, toutes sources), en cents. */
export async function depenseDepuis(orgId: string, depuis: string): Promise<{ cents: number; appels: number }> {
  const { data, error } = await admin.from('ai_usage').select('cost_cents').eq('org_id', orgId).gte('created_at', depuis);
  if (error) throw new Error(`ai_usage : ${error.message}`);
  return { cents: (data ?? []).reduce((s, l: any) => s + Number(l.cost_cents ?? 0), 0), appels: (data ?? []).length };
}

export function ecrireSortie(nom: string, contenu: unknown): string {
  const chemin = join(SORTIES, nom);
  writeFileSync(chemin, typeof contenu === 'string' ? contenu : JSON.stringify(contenu, null, 1));
  return chemin;
}

/** Lit un flux SSE de /api/lumi/chat ou /execute. */
export interface ReponseLumi {
  statut: number; texte: string; outils: string[];
  proposition: { tool_use_id: string; tool: string; args: Record<string, unknown> } | null;
  executes: Array<{ tool_use_id: string; ok: boolean; auto?: boolean }>;
  conversation_id: string | null; cout: number; erreur: unknown; evenements: Array<Record<string, any>>;
}
function lireSse(statut: number, brut: string, ok: boolean): ReponseLumi {
  const r: ReponseLumi = { statut, texte: '', outils: [], proposition: null, executes: [], conversation_id: null, cout: 0, erreur: null, evenements: [] };
  if (!ok) { try { r.erreur = JSON.parse(brut); } catch { r.erreur = brut; } return r; }
  for (const ev of brut.split('\n\n')) {
    const type = /event: (\w+)/.exec(ev)?.[1];
    const donnees = /data: (.*)/.exec(ev)?.[1];
    if (!type || !donnees) continue;
    let j: Record<string, any>;
    try { j = JSON.parse(donnees); } catch { continue; }
    if (type !== 'text') r.evenements.push({ type, ...j });
    if (type === 'text') r.texte += String(j.delta ?? '');
    else if (type === 'tool' && j.statut === 'debut') r.outils.push(String(j.name));
    else if (type === 'proposal' && !j.auto) r.proposition = { tool_use_id: j.tool_use_id, tool: j.tool, args: j.args ?? {} };
    else if (type === 'executed') r.executes.push({ tool_use_id: j.tool_use_id, ok: !!j.ok, auto: !!j.auto });
    else if (type === 'error') r.erreur = j;
    else if (type === 'done') {
      r.conversation_id = j.conversation_id ?? null;
      r.cout += Number(j.cost_cents ?? 0);
      if (j.proposal && !r.proposition) r.proposition = j.proposal;
    }
  }
  return r;
}

export interface SessionApi { jeton: string; orgId: string; langue: 'fr' | 'en' }
export async function sessionApi(langue: 'fr' | 'en' = 'fr', email = COMPTES.proprioA.email): Promise<SessionApi> {
  const b = await bureauA();
  const s = await session(email);
  return { jeton: s.access_token, orgId: b.orgA, langue };
}
async function poster(s: SessionApi, chemin: string, corps: Record<string, unknown>): Promise<Response> {
  return fetch(`${API}${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.jeton}`, 'x-org-id': s.orgId, 'Accept-Language': s.langue },
    body: JSON.stringify(corps),
  });
}
/** Un message au clavardage général de Lumi (POST /api/lumi/chat), vrai modèle. */
export async function demanderALumi(s: SessionApi, message: string, conversationId: string | null = null): Promise<ReponseLumi> {
  const res = await poster(s, '/api/lumi/chat', { message, conversation_id: conversationId, language: s.langue });
  return lireSse(res.status, await res.text(), res.ok);
}
/** Le bouton « Confirmer » / « Annuler » d'une carte (POST /api/lumi/execute). */
export async function deciderCarte(s: SessionApi, conversationId: string, toolUseId: string, decision: 'confirm' | 'cancel'): Promise<ReponseLumi> {
  const res = await poster(s, '/api/lumi/execute', { conversation_id: conversationId, tool_use_id: toolUseId, decision, language: s.langue });
  return lireSse(res.status, await res.text(), res.ok);
}
/** Le panneau « Construire avec Lumi » de l'éditeur (POST /api/automations/rules/generer). */
export async function genererParcours(s: SessionApi, corps: { demande: string; echanges?: Array<{ role: string; content: string }>; parcours_actuel?: unknown; rule_id?: string | null }): Promise<{ statut: number; json: any }> {
  const res = await poster(s, '/api/automations/rules/generer', { ...corps, langue: s.langue });
  return { statut: res.status, json: await res.json().catch(() => null) };
}
export async function appelApi(s: SessionApi, methode: string, chemin: string, corps?: unknown): Promise<{ statut: number; json: any }> {
  const res = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.jeton}`, 'x-org-id': s.orgId, 'Accept-Language': s.langue },
    ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
  });
  return { statut: res.status, json: await res.json().catch(() => null) };
}
