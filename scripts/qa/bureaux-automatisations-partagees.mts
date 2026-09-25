/**
 * Automatisations partagées entre bureaux — prouvées contre staging (entreprise fictive à 2 bureaux).
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/bureaux-automatisations-partagees.mts
 *   (API locale :3188, Vite :5288 — API_URL_QA / FRONTEND_URL_QA pour changer)
 *
 *   1. Propriétaire de A et B : B est proposé comme bureau cible.
 *   2. Copie liée A → B : même nom, étape de pipeline retrouvée par son nom, personne gardée (membre de B), publiée.
 *   3. Modifier le modèle A : la copie de B suit.
 *   4. Un champ personnalisé absent de B : copie en brouillon, « champ personnalisé » à revoir, référence vidée.
 *   5. Modifier la copie dans B la détache : le modèle ne l'écrase plus.
 *   6. Préréglage : celui de même clé dans B est mis à jour, pas dupliqué.
 *   7. Membre de A seulement : aucun bureau cible ; forcer B = refusé, rien créé.
 *   8. automations.update retiré dans B (page Rôles) : B n'est pas proposé.
 *   9. À l'écran : menu « Copier vers d'autres bureaux », fenêtre, résultat ; badge « Copie liée » dans B.
 * Tout ce qui est créé est retiré à la fin.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const API = (process.env.API_URL_QA || 'http://localhost:3188').replace(/\/$/, '');
const BASE = (process.env.FRONTEND_URL_QA || 'http://localhost:5288').replace(/\/$/, '');
const url = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
if (!url.includes(process.env.SUPABASE_PROJECT_REF!) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD!)) throw new Error('staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const s = Date.now().toString(36);
const ok: string[] = [];
const ko: string[] = [];
const verifier = (nom: string, cond: boolean, detail = '') => (cond ? ok : ko).push(`${nom}${detail ? ` — ${detail}` : ''}`);
const nettoyer: Array<() => PromiseLike<unknown>> = [];

async function utilisateur(etiquette: string) {
  const courriel = `qa.auto.${etiquette}.${s}@exemple.invalid`;
  const mdp = crypto.randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('utilisateur');
  nettoyer.unshift(() => admin.auth.admin.deleteUser(data.user!.id));
  const anon = createClient(url, ANON, { auth: { persistSession: false } });
  const { data: sess, error: eS } = await anon.auth.signInWithPassword({ email: courriel, password: mdp });
  if (eS || !sess.session) throw eS ?? new Error('session');
  return { id: data.user.id, session: sess.session };
}
async function adhesion(user: string, org: string, role: string, extra: Record<string, unknown> = {}) {
  const { error } = await admin.from('memberships').upsert({ user_id: user, org_id: org, role, status: 'active', ...extra }, { onConflict: 'user_id,org_id' });
  if (error) throw new Error(`adhésion : ${error.message}`);
}
const api = async (jeton: string, bureau: string, chemin: string, method = 'GET', corps?: unknown) => {
  const r = await fetch(`${API}${chemin}`, {
    method,
    headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': bureau, ...(corps ? { 'Content-Type': 'application/json' } : {}) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  return { status: r.status, j: await r.json().catch(() => null) as any };
};
const regle = async (id: string) => (await admin.from('automation_rules').select('*').eq('id', id).single()).data as any;

try {
  const proprio = await utilisateur('proprio');
  const { data: A, error: eA } = await admin.from('orgs').insert({ name: `QA auto A ${s}`, created_by: proprio.id }).select('id, company_group_id').single();
  if (eA) throw eA;
  const { data: B, error: eB } = await admin.from('orgs').insert({ name: `QA auto B ${s}`, created_by: proprio.id, company_group_id: A.company_group_id }).select('id').single();
  if (eB) throw eB;
  nettoyer.unshift(() => admin.from('orgs').delete().in('id', [A.id, B.id]));
  nettoyer.unshift(() => admin.from('memberships').delete().in('org_id', [A.id, B.id]));
  nettoyer.unshift(() => admin.from('automation_rules').delete().in('org_id', [A.id, B.id]));
  await adhesion(proprio.id, A.id, 'owner', { created_at: new Date(Date.now() - 86400e3).toISOString() });
  await adhesion(proprio.id, B.id, 'owner');
  const { data: plan } = await admin.from('plans').select('id').eq('includes_sms', true).limit(1).single();
  const { data: abo, error: eAbo } = await admin.from('subscriptions').insert({ user_id: proprio.id, org_id: A.id, plan_id: plan!.id, status: 'active' }).select('id').single();
  if (eAbo) throw eAbo;
  nettoyer.unshift(() => admin.from('subscriptions').delete().eq('id', abo!.id));

  // Un pipeline « QA pipe » avec l'étape « QA étape » dans chaque bureau ; un champ perso dans A seulement.
  const etape = async (org: string) => {
    const { data: p, error } = await admin.from('pipelines_ventes').insert({ org_id: org, name: `QA pipe ${s}` }).select('id').single();
    if (error) throw error;
    const { data: e, error: eE } = await admin.from('pipeline_stages').insert({ org_id: org, pipeline_id: p.id, name_fr: 'QA étape', name_en: 'QA stage', position: 99 }).select('id').single();
    if (eE) throw eE;
    return e.id as string;
  };
  nettoyer.unshift(() => admin.from('pipelines_ventes').delete().in('org_id', [A.id, B.id]));
  nettoyer.unshift(() => admin.from('pipeline_stages').delete().in('org_id', [A.id, B.id]));
  const etapeA = await etape(A.id);
  const etapeB = await etape(B.id);
  const { data: champA, error: eCh } = await admin.from('custom_fields').insert({ org_id: A.id, object_type: 'client', key: `qa_${s}`, label: 'QA champ', field_type: 'single_line' }).select('id').single();
  if (eCh) throw eCh;
  nettoyer.unshift(() => admin.from('custom_fields').delete().in('org_id', [A.id, B.id]));

  const jeton = proprio.session.access_token;
  const creer = async (corps: Record<string, unknown>) => {
    const { data, error } = await admin.from('automation_rules').insert({ org_id: A.id, delay_seconds: 0, conditions: {}, is_preset: false, ...corps }).select('id').single();
    if (error) throw error;
    return data.id as string;
  };

  // 1
  const r1 = await api(jeton, A.id, '/api/automations/bureaux-cibles');
  verifier('1. propriétaire de A et B : B proposé', r1.status === 200 && r1.j?.offices?.length === 1 && r1.j.offices[0].org_id === B.id, `HTTP ${r1.status}, ${JSON.stringify(r1.j?.offices?.map((o: any) => o.name))}`);

  // 2
  const regleA = await creer({
    name: `QA relance ${s}`, trigger_event: 'quote.sent', is_active: true,
    actions: [
      { type: 'send_sms', config: { body: 'Bonjour version 1' } },
      { type: 'move_deal_stage', config: { stage_id: etapeA } },
      { type: 'assigner_responsable', config: { membre_id: proprio.id } },
    ],
  });
  const r2 = await api(jeton, A.id, `/api/automations/rules/${regleA}/copier-bureaux`, 'POST', { org_ids: [B.id] });
  const res2 = r2.j?.results?.[0];
  const copieB = res2?.rule_id ? await regle(res2.rule_id) : null;
  verifier('2. copie liée créée dans B, publiée', r2.status === 200 && res2?.statut === 'copiee' && res2.active === true && copieB?.org_id === B.id && copieB?.modele_id === regleA && copieB?.is_active === true,
    `HTTP ${r2.status}, ${JSON.stringify(res2)}`);
  verifier('2b. étape retrouvée par son nom dans B, personne gardée, texte copié',
    copieB?.actions?.[1]?.config?.stage_id === etapeB && copieB?.actions?.[2]?.config?.membre_id === proprio.id && copieB?.actions?.[0]?.config?.body === 'Bonjour version 1');

  // 3
  const r3 = await api(jeton, A.id, `/api/automations/rules/${regleA}`, 'PATCH', {
    actions: [
      { type: 'send_sms', config: { body: 'Bonjour version 2' } },
      { type: 'move_deal_stage', config: { stage_id: etapeA } },
      { type: 'assigner_responsable', config: { membre_id: proprio.id } },
    ],
  });
  const copieB3 = copieB ? await regle(copieB.id) : null;
  verifier('3. modifier le modèle : la copie de B suit', r3.status === 200 && copieB3?.actions?.[0]?.config?.body === 'Bonjour version 2' && copieB3?.actions?.[1]?.config?.stage_id === etapeB && copieB3?.is_active === true,
    `HTTP ${r3.status}, copies ${JSON.stringify(r3.j?.copies)}`);

  // 4
  const regleChamp = await creer({ name: `QA champ ${s}`, trigger_event: 'quote.sent', is_active: true, actions: [{ type: 'update_custom_field', config: { field_id: champA.id, value: 'oui' } }] });
  const r4 = await api(jeton, A.id, `/api/automations/rules/${regleChamp}/copier-bureaux`, 'POST', { org_ids: [B.id] });
  const res4 = r4.j?.results?.[0];
  const copie4 = res4?.rule_id ? await regle(res4.rule_id) : null;
  verifier('4. champ absent de B : brouillon, à revoir, référence vidée',
    res4?.statut === 'copiee' && res4.active === false && (res4.a_revoir || []).includes('champ personnalisé') && copie4?.is_active === false && copie4?.actions?.[0]?.config?.field_id === null,
    JSON.stringify(res4));

  // 5
  const r5 = await api(jeton, B.id, `/api/automations/rules/${copieB?.id}`, 'PATCH', { description: 'propre à B' });
  const detachee = copieB ? await regle(copieB.id) : null;
  await api(jeton, A.id, `/api/automations/rules/${regleA}`, 'PATCH', { actions: [{ type: 'send_sms', config: { body: 'Bonjour version 3' } }] });
  const apres5 = copieB ? await regle(copieB.id) : null;
  verifier('5. modifier la copie la détache ; le modèle ne l’écrase plus',
    r5.status === 200 && detachee?.modele_id === null && apres5?.actions?.[0]?.config?.body === 'Bonjour version 2' && apres5?.description === 'propre à B',
    `HTTP ${r5.status}, modele_id ${detachee?.modele_id}, corps ${apres5?.actions?.[0]?.config?.body}`);

  // 6. Préréglage : même clé dans les deux bureaux
  const cle = `qa_preset_${s}`;
  const presetA = await creer({ name: `QA préréglage ${s}`, trigger_event: 'invoice.paid', is_active: true, is_preset: true, preset_key: cle, actions: [{ type: 'send_sms', config: { body: 'Merci A' } }] });
  const { data: presetB, error: ePB } = await admin.from('automation_rules').insert({ org_id: B.id, name: `QA préréglage ${s}`, trigger_event: 'invoice.paid', delay_seconds: 0, conditions: {}, is_active: false, is_preset: true, preset_key: cle, actions: [{ type: 'send_sms', config: { body: 'Merci B' } }] }).select('id').single();
  if (ePB) throw ePB;
  const r6 = await api(jeton, A.id, `/api/automations/rules/${presetA}/copier-bureaux`, 'POST', { org_ids: [B.id] });
  const { count: nbPresetsB } = await admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', B.id).eq('preset_key', cle);
  const pB = await regle(presetB.id);
  verifier('6. préréglage : celui de B mis à jour, pas dupliqué',
    r6.j?.results?.[0]?.statut === 'preset_mis_a_jour' && nbPresetsB === 1 && pB?.actions?.[0]?.config?.body === 'Merci A' && pB?.modele_id === presetA && pB?.is_preset === true,
    `${JSON.stringify(r6.j?.results?.[0])}, ${nbPresetsB} préréglage(s)`);

  // 7
  const seulA = await utilisateur('seula');
  await adhesion(seulA.id, A.id, 'admin');
  const r7 = await api(seulA.session.access_token, A.id, '/api/automations/bureaux-cibles');
  const { count: avant7 } = await admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', B.id);
  const r7b = await api(seulA.session.access_token, A.id, `/api/automations/rules/${regleA}/copier-bureaux`, 'POST', { org_ids: [B.id] });
  const { count: apres7 } = await admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', B.id);
  verifier('7. membre de A seulement : aucun bureau cible, copie forcée refusée, rien créé',
    r7.j?.offices?.length === 0 && r7b.j?.results?.[0]?.statut === 'sans_droit' && avant7 === apres7, `${r7.j?.offices?.length} cible(s), ${JSON.stringify(r7b.j?.results?.[0]?.statut)}`);

  // 8
  const sansDroit = await utilisateur('sansdroit');
  await adhesion(sansDroit.id, A.id, 'admin');
  await adhesion(sansDroit.id, B.id, 'admin', { permissions: { 'automations.update': false } });
  const r8 = await api(sansDroit.session.access_token, A.id, '/api/automations/bureaux-cibles');
  verifier('8. automations.update retiré dans B : B non proposé', r8.status === 200 && r8.j?.offices?.length === 0, `HTTP ${r8.status}, ${r8.j?.offices?.length}`);

  // 9. À l'écran
  const nomUi = `QA ecran ${s}`;
  const regleUi = await creer({ name: nomUi, trigger_event: 'quote.sent', is_active: false, actions: [{ type: 'send_sms', config: { body: 'Écran' } }] });
  const dir = path.join(process.cwd(), 'qa-captures');
  fs.mkdirSync(dir, { recursive: true });
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const erreurs: string[] = [];
  try {
    const ouvrir = async (org: string, l: number, h: number) => {
      const page = await nav.newPage();
      page.on('pageerror', (e) => erreurs.push(e instanceof Error ? e.message : String(e)));
      await page.setViewport({ width: l, height: h });
      await page.evaluateOnNewDocument((t, o) => {
        localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o);
        localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-setup-dismissed', '1');
        localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
      }, { ...proprio.session, token_type: 'bearer' }, org);
      await page.goto(`${BASE}/automations`, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Refuser')?.click());
      // La liste est paginée (les préréglages d'abord) : chercher la règle par son nom.
      await page.waitForSelector('main input[placeholder="Rechercher"]', { timeout: 20000 });
      await page.type('main input[placeholder="Rechercher"]', nomUi);
      return page;
    };
    const page = await ouvrir(A.id, 1440, 900);
    const ligne = await page.waitForFunction((n) => document.body.innerText.includes(n), { timeout: 20000 }, nomUi).then(() => true).catch(() => false);
    await page.evaluate((n) => (document.querySelector(`[aria-label="Actions pour ${n}"]`) as HTMLButtonElement | null)?.click(), nomUi);
    const item = await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some((b) => (b.textContent || '').includes('Copier vers d’autres bureaux')), { timeout: 5000 }).then(() => true).catch(() => false);
    await page.evaluate(() => ([...document.querySelectorAll('[role="menuitem"]')].find((b) => (b.textContent || '').includes('Copier vers d’autres bureaux')) as HTMLButtonElement | undefined)?.click());
    const fenetre = await page.waitForFunction((b) => !!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]')!.textContent!.includes(b), { timeout: 5000 }, `QA auto B ${s}`).then(() => true).catch(() => false);
    await page.screenshot({ path: path.join(dir, 'auto-bureaux-fenetre.png') });
    await page.evaluate(() => ([...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent || '').trim() === 'Copier') as HTMLButtonElement | undefined)?.click());
    const resultat = await page.waitForFunction(() => /Copiée en brouillon/.test(document.querySelector('[role="dialog"]')?.textContent || ''), { timeout: 15000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: path.join(dir, 'auto-bureaux-resultat.png') });
    verifier('9. écran A : menu, fenêtre avec B, copie faite', ligne && item && fenetre && resultat, `ligne ${ligne}, menu ${item}, fenêtre ${fenetre}, résultat ${resultat}`);
    await page.evaluate(() => ([...document.querySelectorAll('[role="dialog"] button')].find((b) => (b.textContent || '').trim() === 'Fermer') as HTMLButtonElement | undefined)?.click());
    const resteA = await page.waitForFunction((n) => !document.querySelector('[role="dialog"]') && !!document.querySelector(`[aria-label="Actions pour ${n}"]`), { timeout: 10000 }, nomUi).then(() => true).catch(() => false);
    verifier('9a. après la copie, la règle de A est toujours dans sa liste', resteA);
    await page.close();

    const pageB = await ouvrir(B.id, 390, 844);
    const badge = await pageB.waitForFunction((n) => document.body.innerText.includes(n) && document.body.innerText.includes('Copie liée à un autre bureau'), { timeout: 20000 }, nomUi).then(() => true).catch(() => false);
    const deborde = await pageB.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await pageB.screenshot({ path: path.join(dir, 'auto-bureaux-b-telephone.png') });
    verifier('9b. écran B (téléphone) : la copie avec son badge « Copie liée »', badge, `badge ${badge}, débordement ${deborde}`);
    await pageB.close();
    void regleUi;
  } finally { await nav.close(); }
  verifier('9c. aucune erreur navigateur', erreurs.length === 0, erreurs.join(' | '));
} finally {
  for (const f of nettoyer) { try { await f(); } catch (e) { console.error('nettoyage :', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`${ok.length}/${ok.length + ko.length}`);
process.exit(ko.length ? 1 : 0);
