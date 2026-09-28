// Usage : FRONTEND_URL=http://localhost:5184 node --env-file=.env.local scripts/qa/verifier-champs-pipeline.mjs [dossier-captures]
//
// Étape 4 du plan « Étiquettes et champs dans la pipeline » (2026-09-28), de
// bout en bout, contre STAGING (refuse la prod), dans un VRAI navigateur :
//   1. /ventes?deal=<id> ouvre la fiche du deal, et ses champs sont visibles
//      dès l'onglet qui s'ouvre (section « Informations ») ;
//   2. vue Liste : « Gérer les champs » ajoute la colonne d'un champ du deal ;
//   3. réglages du pipeline → onglet « Cartes » : ce pipeline, sans sélecteur ;
//   4. recherche globale : une valeur d'un champ du deal renvoie `dealId` ;
//   5. version 0 = « doit encore être vide » : remplit un champ vide, refuse
//      d'écraser un champ rempli (Nouveau deal sur un deal existant).
//
// Crée ses propres données (préfixe ZZSonde), remet les réglages touchés
// (colonnes de l'utilisateur, cartes du pipeline) et supprime tout à la fin.
// Aucun envoi : rien ici ne déclenche courriel ni texto.
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = process.env.FRONTEND_URL || 'http://localhost:5173';
const OUT = process.argv[2] || null;
if (process.env.SUPABASE_PROJECT_REF === process.env.SUPABASE_PROJECT_REF_PROD) throw new Error('prod refusée');
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const verif = (n, c, d = '') => { c ? ok++ : ko++; console.log(`${c ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`); };

const COMPTE = 'qa-pipeline@lume.test', MDP = 'QaPipeline1234!';
const { data: session, error: eS } = await anon.auth.signInWithPassword({ email: COMPTE, password: MDP });
if (eS) throw eS;
const uid = session.user.id;
const { data: mb } = await admin.from('memberships').select('org_id').eq('user_id', uid).eq('status', 'active').limit(1).single();
const ORG = mb.org_id;
const { data: pip } = await admin.from('pipelines_ventes').select('id').eq('org_id', ORG).eq('is_default', true).single();
const { data: etapes } = await admin.from('pipeline_stages').select('id, kind, position')
  .eq('pipeline_id', pip.id).is('archived_at', null).order('position');
const ouverte = etapes.find((e) => e.kind === 'open');

const api = async (chemin, init = {}) => {
  const r = await fetch(`${BASE}${chemin}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session.access_token}`, 'x-org-id': ORG, ...(init.headers ?? {}) },
  });
  return { status: r.status, corps: await r.json().catch(() => null) };
};

const trace = { champs: [], client: null, deal: null, colonnesAvant: undefined, cartesAvant: null };
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

try {
  // ── Données ──
  const creerChamp = async (corps) => {
    const r = await api('/api/custom-fields', { method: 'POST', body: JSON.stringify({ object_type: 'deal', sur_formulaire: false, ...corps }) });
    if (r.status >= 300) throw new Error(`création du champ : ${r.status} ${JSON.stringify(r.corps)}`);
    trace.champs.push(r.corps.field.id);
    return r.corps.field;
  };
  const type = await creerChamp({ label: 'ZZSonde Type', field_type: 'dropdown_single', options: [{ label: 'Résidentiel', color: '#22c55e' }, { label: 'Commercial', color: '#3b82f6' }] });
  const refere = await creerChamp({ label: 'ZZSonde Référé par', field_type: 'single_line', is_searchable: true });
  const note = await creerChamp({ label: 'ZZSonde Note', field_type: 'single_line' });
  const commercial = type.options.find((o) => o.label === 'Commercial');

  const { data: c, error: eC } = await admin.from('clients').insert({
    org_id: ORG, first_name: 'ZZSonde', last_name: 'Champs', status: 'lead', email: 'zzsonde.champs@example.invalid', created_by: uid,
  }).select('id').single();
  if (eC) throw eC; trace.client = c.id;
  const { data: d, error: eD } = await admin.from('deals').insert({
    org_id: ORG, pipeline_id: pip.id, stage_id: ouverte.id, client_id: c.id, source: 'manual', created_by: uid, assigned_user_id: uid,
  }).select('id').single();
  if (eD) throw eD; trace.deal = d.id;
  const ecr = await api(`/api/custom-values/deal/${d.id}`, { method: 'PUT', body: JSON.stringify({ values: [
    { field_id: type.id, value: commercial.id }, { field_id: refere.id, value: 'Zzsondemarco' },
  ] }) });
  verif('valeurs posées sur le deal', ecr.status === 200, String(ecr.status));

  // Réglages de l'utilisateur et du pipeline, remis à la fin.
  trace.colonnesAvant = (await admin.from('table_view_preferences').select('columns').eq('org_id', ORG).eq('user_id', uid).eq('object_type', 'deal').maybeSingle()).data?.columns ?? null;
  trace.cartesAvant = (await api(`/api/custom-fields/pipeline-cards/${pip.id}`)).corps?.field_ids ?? [];

  // ── 5. Version 0 : compléter sans écraser ──
  const v0vide = await api(`/api/custom-values/deal/${d.id}`, { method: 'PUT', body: JSON.stringify({ values: [{ field_id: note.id, value: 'complété', version: 0 }] }) });
  verif('version 0 sur un champ VIDE : écrit', v0vide.status === 200 && v0vide.corps?.results?.[0]?.ok === true, String(v0vide.status));
  const v0plein = await api(`/api/custom-values/deal/${d.id}`, { method: 'PUT', body: JSON.stringify({ values: [{ field_id: refere.id, value: 'Écrasé', version: 0 }] }) });
  verif('version 0 sur un champ REMPLI : conflit, pas d’écrasement', v0plein.status === 409 && v0plein.corps?.results?.[0]?.conflict === true, String(v0plein.status));
  const relu = await api(`/api/custom-values/deal/${d.id}`);
  verif('la valeur existante est intacte', relu.corps?.values?.[refere.id]?.value === 'Zzsondemarco');

  // ── 4. Recherche globale ──
  const rech = await api('/api/search/suggestions?q=Zzsondemarco&limit=8');
  const trouve = (rech.corps?.items ?? []).find((i) => i.dealId === d.id);
  verif('recherche : la valeur du champ du deal porte dealId', !!trouve, JSON.stringify((rech.corps?.items ?? []).map((i) => [i.type, i.subtitle, i.dealId])));

  // ── Navigateur ──
  const page = await nav.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((o, p) => {
    localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-active-org', o); localStorage.setItem('lume-pipeline-vu', p);
  }, ORG, pip.id);
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForSelector('input[type=email]', { timeout: 90000 });
  await page.evaluate((m, p) => {
    const st = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const e = document.querySelector('input[type=email]'); const w = document.querySelector('input[type=password]');
    st.call(e, m); e.dispatchEvent(new Event('input', { bubbles: true }));
    st.call(w, p); w.dispatchEvent(new Event('input', { bubbles: true }));
  }, COMPTE, MDP);
  await page.focus('input[type=password]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !location.pathname.startsWith('/auth'), { timeout: 60000 }).catch(() => {});
  await pause(2500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^tout refuser$/i.test(x.textContent.trim())); if (b) b.click(); });

  // ── 1. Lien direct + section « Informations » ──
  await page.goto(`${BASE}/ventes?deal=${d.id}`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => !!document.querySelector('[data-section-informations]'), { timeout: 45000 }).catch(() => {});
  await pause(800);
  const fiche = await page.evaluate(() => ({
    onglet: document.querySelector('[role="tablist"][aria-orientation="vertical"] [role="tab"][aria-selected="true"]')?.textContent?.trim(),
    section: !!document.querySelector('[data-section-informations]'),
    texte: document.querySelector('[data-section-informations]')?.textContent ?? '',
    url: location.search,
  }));
  verif('le lien /ventes?deal= ouvre la fiche sur l’onglet Client', fiche.onglet === 'Client', fiche.onglet);
  verif('section « Informations » avec les champs du deal dès l’ouverture', fiche.section && /ZZSonde Référé par/.test(fiche.texte) && /ZZSonde Type/.test(fiche.texte));
  verif('le paramètre deal est retiré de l’adresse', !/deal=/.test(fiche.url), fiche.url);
  if (OUT) await page.screenshot({ path: `${OUT}/1-fiche-informations.png` });
  await page.keyboard.press('Escape');
  await pause(600);

  // ── 2. Vue Liste : colonne d'un champ ──
  await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => /ZZSonde Champs/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  await page.evaluate(() => document.querySelector('button[aria-label="Vue liste"]')?.click());
  await pause(800);
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Gérer les champs')?.click());
  await page.waitForFunction(() => /Ajouter des champs/.test(document.body.innerText), { timeout: 10000 }).catch(() => {});
  // Déplier les groupes, cocher « ZZSonde Type », appliquer.
  await page.evaluate(() => { for (const b of document.querySelectorAll('[role="dialog"] button[aria-expanded="false"]')) b.click(); });
  await pause(300);
  await page.evaluate(() => {
    const l = [...document.querySelectorAll('[role="dialog"] label')].find((x) => x.textContent.trim() === 'ZZSonde Type');
    l?.querySelector('input')?.click();
  });
  await pause(300);
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Appliquer')?.click());
  await page.waitForFunction(() => [...document.querySelectorAll('th')].some((t) => /ZZSonde Type/i.test(t.textContent)), { timeout: 15000 }).catch(() => {});
  await pause(800);
  const ligne = await page.evaluate(() => {
    const entetes = [...document.querySelectorAll('th')].map((t) => t.textContent.trim());
    const i = entetes.findIndex((t) => /ZZSonde Type/i.test(t));
    const tr = [...document.querySelectorAll('tbody tr')].find((r) => /ZZSonde Champs/.test(r.textContent));
    return { entetes, valeur: i >= 0 ? tr?.querySelectorAll('td')[i]?.textContent.trim() : null };
  });
  verif('vue Liste : colonne « ZZSonde Type » ajoutée', ligne.entetes.some((t) => /ZZSonde Type/i.test(t)), ligne.entetes.join(' | '));
  verif('vue Liste : la valeur s’affiche formatée (libellé de l’option)', ligne.valeur === 'Commercial', ligne.valeur);
  const colonnesEnBase = (await admin.from('table_view_preferences').select('columns').eq('org_id', ORG).eq('user_id', uid).eq('object_type', 'deal').maybeSingle()).data?.columns ?? [];
  verif('colonnes gardées par utilisateur (table_view_preferences, objet deal)', colonnesEnBase.includes(`cf:${type.id}`));
  if (OUT) {
    const tableau = await page.$('table');
    await (tableau ? tableau.screenshot({ path: `${OUT}/2-liste-colonne-champ.png` }) : page.screenshot({ path: `${OUT}/2-liste-colonne-champ.png` }));
    await page.screenshot({ path: `${OUT}/2b-liste-page.png` });
  }

  // ── 3. Réglages du pipeline → « Cartes » ──
  await page.goto(`${BASE}/ventes?tab=reglages&pipeline=${pip.id}`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim() === 'Cartes'), { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Cartes')?.click());
  await page.waitForFunction(() => /Champs affichés sur les cartes du pipeline/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  await pause(800);
  const cartes = await page.evaluate(() => ({
    titre: /Champs affichés sur les cartes du pipeline/.test(document.body.innerText),
    selecteur: [...document.querySelectorAll('label')].some((l) => l.textContent.trim() === 'Pipeline'),
    proposeType: [...document.querySelectorAll('label')].some((l) => l.textContent.trim() === 'ZZSonde Type'),
  }));
  verif('onglet « Cartes » : le réglage des cartes de ce pipeline', cartes.titre && cartes.proposeType);
  verif('onglet « Cartes » : pas de sélecteur de pipeline', !cartes.selecteur);
  if (OUT) await page.screenshot({ path: `${OUT}/3-reglages-cartes.png` });
} catch (e) {
  ko++; console.log('💥', e.message ?? e);
} finally {
  await nav.close();
  const effacer = async (etiquette, req) => { const { error } = await req; if (error) console.log(`⚠ nettoyage ${etiquette} :`, error.message); };
  // Réglages remis comme avant.
  if (trace.colonnesAvant === null) await effacer('colonnes', admin.from('table_view_preferences').delete().eq('org_id', ORG).eq('user_id', uid).eq('object_type', 'deal'));
  else if (trace.colonnesAvant !== undefined) await effacer('colonnes', admin.from('table_view_preferences').update({ columns: trace.colonnesAvant }).eq('org_id', ORG).eq('user_id', uid).eq('object_type', 'deal'));
  if (trace.cartesAvant) await api(`/api/custom-fields/pipeline-cards/${pip.id}`, { method: 'PUT', body: JSON.stringify({ field_ids: trace.cartesAvant }) });
  if (trace.deal) {
    await effacer('événements', admin.from('pipeline_events').delete().eq('deal_id', trace.deal));
    await effacer('historique', admin.from('deal_stage_history').delete().eq('deal_id', trace.deal));
    await effacer('tâches', admin.from('automation_scheduled_tasks').delete().eq('entity_id', trace.deal));
    await effacer('valeurs', admin.from('custom_field_values').delete().eq('deal_id', trace.deal));
    await effacer('deal', admin.from('deals').delete().eq('id', trace.deal));
  }
  if (trace.client) {
    await effacer('ancien pipeline (client)', admin.from('pipeline_deals').delete().eq('client_id', trace.client));
    await effacer('journal client', admin.from('activity_log').delete().eq('related_entity_id', trace.client));
    await effacer('client', admin.from('clients').delete().eq('id', trace.client));
  }
  for (const id of trace.champs) {
    await api(`/api/custom-fields/${id}/archive`, { method: 'POST', body: '{}' });
    const r = await api(`/api/custom-fields/${id}`, { method: 'DELETE', body: JSON.stringify({ valeurs_confirmees: 0 }) });
    if (r.status >= 300) console.log('⚠ purge du champ :', r.status, JSON.stringify(r.corps));
  }
  const resteClients = (await admin.from('clients').select('id').eq('first_name', 'ZZSonde').eq('last_name', 'Champs')).data.length;
  const resteChamps = (await admin.from('custom_fields').select('id').eq('org_id', ORG).like('label', 'ZZSonde%')).data.length;
  console.log(`\n${ok} ✅  ${ko} ❌   — nettoyage : ${resteClients + resteChamps === 0 ? 'rien ne reste' : `${resteClients} client(s), ${resteChamps} champ(s) restant(s)`}`);
}
