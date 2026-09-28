// Usage : FRONTEND_URL=http://localhost:5174 node --env-file=.env.local scripts/qa/verifier-devis-depuis-deal.mjs [dossier-captures]
//
// « Faire un devis » depuis la fiche d'un deal (2026-09-28), de bout en bout,
// contre STAGING (refuse la prod), dans un VRAI navigateur :
//   1. la fiche du deal offre « Faire un devis » (client + deal dans le lien) et « Facturer » ;
//   2. le devis enregistré depuis ce lien est RATTACHÉ au deal (deals.quote_id) ;
//   3. la fiche affiche alors « Voir le devis » ;
//   4. « Devis envoyé » fait passer le deal à « Soumission envoyée » ;
//   5. jamais en arrière : un deal déjà gagné ne bouge pas.
//
// L'« envoi » passe par l'événement d'automatisation (POST
// /api/automations/events/quote-sent), jamais par un vrai courriel au client.
// Crée ses propres données (préfixe ZZSonde) et les supprime à la fin.
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = process.env.FRONTEND_URL || 'http://localhost:5173';
const OUT = process.argv[2] || null;
if (process.env.SUPABASE_PROJECT_REF === process.env.SUPABASE_PROJECT_REF_PROD) throw new Error('prod refusée');
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const attendre = async (cond, ms = 10000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await cond()) return true; await pause(400); } return false; };
let ok = 0, ko = 0;
const verif = (n, c, d = '') => { c ? ok++ : ko++; console.log(`${c ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`); };

const COMPTE = 'qa-pipeline@lume.test', MDP = 'QaPipeline1234!';
const { data: session, error: eS } = await anon.auth.signInWithPassword({ email: COMPTE, password: MDP });
if (eS) throw eS;
const uid = session.user.id;
const { data: mb } = await admin.from('memberships').select('org_id').eq('user_id', uid).eq('status', 'active').limit(1).single();
const ORG = mb.org_id;
const { data: pip } = await admin.from('pipelines_ventes').select('id').eq('org_id', ORG).eq('is_default', true).single();
const { data: etapes } = await admin.from('pipeline_stages').select('id, name_fr, role_systeme, position, kind')
  .eq('pipeline_id', pip.id).is('archived_at', null).order('position');
const envoyee = etapes.find((e) => e.role_systeme === 'soumission_envoyee');
const avant = etapes.filter((e) => e.kind === 'open' && e.position < envoyee.position).at(-1);
const gagne = etapes.find((e) => e.kind === 'won');
verif('le pipeline a une étape ouverte avant « Soumission envoyée », et une étape gagnée', !!avant && !!gagne, `${avant?.name_fr} › ${envoyee.name_fr}`);
const { data: regle } = await admin.from('automation_rules').select('id, is_active').eq('org_id', ORG).eq('preset_key', 'quote_sent_move_deal').maybeSingle();
verif('l’automatisation par défaut « Avancer le deal quand la soumission est envoyée » existe et est active', !!regle?.is_active);

const trace = { client: null, deal: null, deal2: null, quotes: [] };
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const quoteSent = (quoteId) => fetch(`${BASE}/api/automations/events/quote-sent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.session.access_token}`, 'x-org-id': ORG },
  body: JSON.stringify({ quoteId, channel: 'email' }),
});

try {
  const { data: c, error: eC } = await admin.from('clients').insert({
    org_id: ORG, first_name: 'ZZSonde', last_name: 'DevisDeal', status: 'lead',
    email: 'zzsonde.devisdeal@example.invalid', created_by: uid,
  }).select('id').single();
  if (eC) throw eC; trace.client = c.id;
  const { data: d, error: eD } = await admin.from('deals').insert({
    org_id: ORG, pipeline_id: pip.id, stage_id: avant.id, client_id: c.id, source: 'manual', created_by: uid, assigned_user_id: uid,
  }).select('id').single();
  if (eD) throw eD; trace.deal = d.id;

  // ── 1. La fiche du deal ──
  const page = await nav.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((o) => { localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-active-org', o); }, ORG);
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

  const ouvrirFiche = async () => {
    await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
    await page.waitForFunction(() => /ZZSonde DevisDeal/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="button"], button, article, li, div')]
        .filter((x) => /ZZSonde DevisDeal/.test(x.textContent || '') && x.children.length < 40)
        .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0];
      (el?.closest('[role="button"]') || el)?.click();
    });
    await page.waitForFunction(() => /rattach/.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
    await pause(800);
  };
  await ouvrirFiche();
  const liens = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href') || '' })));
  const faire = liens.find((l) => l.t === 'Faire un devis' && l.h.includes('dealId='));
  verif('fiche : « Faire un devis » porte le client ET le deal', !!faire && faire.h.includes(`dealId=${d.id}`) && faire.h.includes(`clientId=${c.id}`), faire?.h);
  verif('fiche : « Facturer » pré-remplit le client', liens.some((l) => l.t === 'Facturer' && l.h.includes(`clientId=${c.id}`)));
  verif('fiche : « Aucun devis ni job rattaché à ce deal. »', await page.evaluate(() => /Aucun devis ni job rattaché/.test(document.body.innerText)));
  if (OUT) await page.screenshot({ path: `${OUT}/fiche-deal-actions.png` });

  // ── 2. Le devis enregistré depuis ce lien est rattaché au deal ──
  await page.evaluate((h) => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === h); a?.click(); }, faire?.h);
  await page.waitForFunction(() => location.pathname === '/quotes/new', { timeout: 20000 }).catch(() => {});
  await page.waitForSelector('#quote-new-form', { timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => /ZZSonde/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  await pause(1500);
  verif('nouveau devis : le client du deal est pré-sélectionné', await page.evaluate(() => /ZZSonde/.test(document.body.innerText)));
  await page.evaluate(() => { const b = document.querySelector('button[form="quote-new-form"][type="submit"]'); b?.click(); });
  await page.waitForFunction(() => /^\/quotes\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 45000 }).catch(() => {});
  const quoteId = await page.evaluate(() => location.pathname.split('/').pop());
  if (/^[0-9a-f-]{36}$/.test(quoteId)) trace.quotes.push(quoteId);
  const erreur = await page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? '');
  verif('le devis est enregistré', /^[0-9a-f-]{36}$/.test(quoteId), erreur);
  const lie = (await admin.from('deals').select('quote_id, stage_id').eq('id', d.id).single()).data;
  verif('le devis est rattaché au deal', lie.quote_id === quoteId);

  // ── 3. La fiche affiche « Voir le devis » ──
  await ouvrirFiche();
  const liens2 = await page.evaluate(() => [...document.querySelectorAll('a')].map((a) => ({ t: a.textContent.trim(), h: a.getAttribute('href') || '' })));
  verif('fiche : « Voir le devis » mène au devis rattaché', liens2.some((l) => l.t === 'Voir le devis' && l.h === `/quotes/${quoteId}`));
  if (OUT) await page.screenshot({ path: `${OUT}/fiche-deal-devis-rattache.png` });

  // ── 4. Devis envoyé → « Soumission envoyée » ──
  verif('avant l’envoi, le deal est à « ' + avant.name_fr + ' »', lie.stage_id === avant.id);
  const r = await quoteSent(quoteId);
  verif('événement « devis envoyé » accepté', r.ok, String(r.status));
  await attendre(async () => (await admin.from('deals').select('stage_id').eq('id', d.id).single()).data.stage_id === envoyee.id);
  verif('le deal passe tout seul à « Soumission envoyée »', (await admin.from('deals').select('stage_id').eq('id', d.id).single()).data.stage_id === envoyee.id);

  // ── 5. Jamais en arrière : un deal gagné ne bouge pas ──
  const { data: q2, error: eQ2 } = await admin.from('quotes').insert({
    org_id: ORG, client_id: c.id, title: 'ZZSonde révision', quote_number: `ZZSONDE-REV-${Date.now()}`, status: 'draft', created_by: uid,
  }).select('id').single();
  if (eQ2) throw eQ2; trace.quotes.push(q2.id);
  const { data: d2, error: eD2 } = await admin.from('deals').insert({
    org_id: ORG, pipeline_id: pip.id, stage_id: gagne.id, client_id: c.id, quote_id: q2.id, source: 'manual', created_by: uid,
  }).select('id').single();
  if (eD2) throw eD2; trace.deal2 = d2.id;
  await pause(1000);
  await quoteSent(q2.id);
  await pause(5000);
  verif('un deal déjà gagné ne recule pas à « Soumission envoyée »', (await admin.from('deals').select('stage_id').eq('id', d2.id).single()).data.stage_id === gagne.id);
} catch (e) {
  ko++; console.log('💥', e.message ?? e);
} finally {
  await nav.close();
  const effacer = async (etiquette, req) => { const { error } = await req; if (error) console.log(`⚠ nettoyage ${etiquette} :`, error.message); };
  for (const dId of [trace.deal, trace.deal2].filter(Boolean)) {
    await effacer('événements', admin.from('pipeline_events').delete().eq('deal_id', dId));
    await effacer('historique', admin.from('deal_stage_history').delete().eq('deal_id', dId));
    await effacer('tâches', admin.from('automation_scheduled_tasks').delete().eq('entity_id', dId));
    await effacer('deal', admin.from('deals').delete().eq('id', dId));
  }
  for (const qId of trace.quotes) {
    await effacer('outbox', admin.from('domain_events').delete().eq('entity_id', qId));
    await effacer('journal auto', admin.from('automation_execution_logs').delete().eq('entity_id', qId));
    await effacer('tâches devis', admin.from('automation_scheduled_tasks').delete().eq('entity_id', qId));
    await effacer('notifications', admin.from('notifications').delete().eq('entity_id', qId));
    await effacer('ancien pipeline (devis)', admin.from('pipeline_deals').delete().eq('quote_id', qId));
    await effacer('journal devis', admin.from('activity_log').delete().eq('entity_id', qId));
    await effacer('lignes', admin.from('quote_line_items').delete().eq('quote_id', qId));
    await effacer('devis', admin.from('quotes').delete().eq('id', qId));
  }
  if (trace.client) {
    await effacer('ancien pipeline (client)', admin.from('pipeline_deals').delete().eq('client_id', trace.client));
    await effacer('journal client', admin.from('activity_log').delete().eq('related_entity_id', trace.client));
    await effacer('client', admin.from('clients').delete().eq('id', trace.client));
  }
  const reste = (await admin.from('clients').select('id').eq('last_name', 'DevisDeal').eq('first_name', 'ZZSonde')).data.length;
  console.log(`\n${ok} ✅  ${ko} ❌   — nettoyage : ${reste === 0 ? 'rien ne reste' : reste + ' restant(s)'}`);
}
