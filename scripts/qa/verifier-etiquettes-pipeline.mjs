// Usage : FRONTEND_URL=http://localhost:5204 node --env-file=.env.local scripts/qa/verifier-etiquettes-pipeline.mjs [dossier-captures]
//
// Étape 3 du plan « Étiquettes et champs dans la pipeline » (2026-09-28), de
// bout en bout, contre STAGING (refuse la prod), dans un VRAI navigateur :
//   1. les cartes montrent les étiquettes du CLIENT en couleur, 2 puis « +N » ;
//   2. en-tête de la fiche du deal : poser puis retirer une étiquette sur place ;
//   3. filtre « Étiquettes » : resserre le board (au moins une, puis toutes),
//      enregistré dans une vue qui le restaure après rechargement ;
//   4. actions en lot : « Ajouter une étiquette » sur 2 deals → leurs clients ;
//   5. liste Clients : /clients?etiquette=… filtre en base.
//
// Données ZZSonde uniquement (clients, deals, étiquettes, vue), supprimées à
// la fin. Lancer l'API avec les envois coupés (les poses d'étiquette annoncent
// « Étiquette ajoutée » au moteur d'automatisations).
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = process.env.FRONTEND_URL || 'http://localhost:5173';
const OUT = process.argv[2] || null;
if (process.env.SUPABASE_PROJECT_REF === process.env.SUPABASE_PROJECT_REF_PROD) throw new Error('prod refusée');
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const attendre = async (cond, ms = 15000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await cond()) return true; await pause(300); } return false; };
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

const VIP = 'ZZSonde-VIP', ETE = 'ZZSonde-Ete', COM = 'ZZSonde-Com';
const NOM_VUE = 'ZZSonde vue étiquettes';
const trace = { clients: {}, deals: {} };
const tagsDe = async (cle) => ((await admin.from('client_tags').select('tag').eq('client_id', trace.clients[cle])).data ?? []).map((r) => r.tag).sort();
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const capture = async (page, nom) => { if (OUT) await page.screenshot({ path: `${OUT}/${nom}.png` }); };

try {
  // ── Données ──
  await admin.from('tags').insert([
    { org_id: ORG, name: VIP, color_hex: '#dc2626' },
    { org_id: ORG, name: ETE, color_hex: '#f59e0b' },
    { org_id: ORG, name: COM, color_hex: '#2563eb' },
  ]);
  for (const [cle, nom] of [['a', 'Alpha'], ['b', 'Bravo'], ['c', 'Charlie']]) {
    const { data: c, error } = await admin.from('clients').insert({
      org_id: ORG, first_name: 'ZZSonde', last_name: nom, status: 'lead', created_by: uid, email: `zzsonde.etiqpipe.${cle}@example.invalid`,
    }).select('id').single();
    if (error) throw error;
    trace.clients[cle] = c.id;
    const { data: d, error: eD } = await admin.from('deals').insert({
      org_id: ORG, pipeline_id: pip.id, stage_id: ouverte.id, client_id: c.id, source: 'manual', created_by: uid, assigned_user_id: uid,
    }).select('id').single();
    if (eD) throw eD;
    trace.deals[cle] = d.id;
  }
  // Alpha : 3 étiquettes (→ 2 pastilles + « +1 ») ; Bravo : VIP ; Charlie : aucune.
  await admin.from('client_tags').insert([
    { client_id: trace.clients.a, tag: COM }, { client_id: trace.clients.a, tag: ETE }, { client_id: trace.clients.a, tag: VIP },
    { client_id: trace.clients.b, tag: VIP },
  ]);

  const page = await nav.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  if (process.env.QA_DEBUG) page.on('console', (m) => { if (/rror|etiquette/i.test(m.text())) console.log('   [page]', m.text().slice(0, 200)); });
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

  const rechercher = async (texte) => {
    await page.evaluate((t) => {
      const el = document.querySelector('input[type=search][placeholder^="Rechercher un deal"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, t);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, texte);
    await pause(600);
  };
  const cartes = () => page.evaluate(() => [...document.querySelectorAll('[role="button"] p.font-semibold')].map((p) => p.textContent.trim()).filter((t) => t.startsWith('ZZSonde')).sort());
  const cliquerBouton = (re) => page.evaluate((src) => {
    const r = new RegExp(src);
    const b = [...document.querySelectorAll('button')].find((x) => r.test(x.textContent.trim()) || r.test(x.getAttribute('aria-label') ?? ''));
    b?.click(); return !!b;
  }, re.source);
  const choisirFiltre = (legende, nom) => page.evaluate((l, n) => {
    const fs = [...document.querySelectorAll('fieldset')].find((f) => f.querySelector('legend')?.textContent.includes(l));
    const b = [...(fs?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === n);
    b?.click(); return !!b;
  }, legende, nom);

  // ── 1. Pastilles sur les cartes ──
  await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => /ZZSonde Alpha/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  await rechercher('ZZSonde');
  await page.waitForFunction((v) => !!document.querySelector(`[role="group"][aria-label*="${v}"]`), { timeout: 15000 }, VIP).catch(() => {});
  const carteAlpha = await page.evaluate(() => {
    const carte = [...document.querySelectorAll('[role="button"]')].find((c) => c.querySelector('p.font-semibold')?.textContent.trim() === 'ZZSonde Alpha');
    const g = carte?.querySelector('[role="group"][aria-label^="Étiquettes"]');
    return {
      label: g?.getAttribute('aria-label') ?? null,
      pastilles: [...(g?.querySelectorAll('span[style]') ?? [])].map((s) => [s.textContent.trim(), getComputedStyle(s).backgroundColor]),
      plus: [...(g?.querySelectorAll('span') ?? [])].find((s) => /^\+\d+$/.test(s.textContent.trim()))?.getAttribute('title') ?? null,
    };
  });
  verif('carte : 2 pastilles en couleur puis « +1 »', carteAlpha.pastilles.length === 2 && carteAlpha.pastilles[0][1] === 'rgb(37, 99, 235)' && !!carteAlpha.plus, JSON.stringify(carteAlpha));
  await capture(page, '1-cartes-pastilles');

  // ── 2. Fiche du deal : poser puis retirer sur place ──
  await page.goto(`${BASE}/ventes?deal=${trace.deals.c}`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForSelector('[data-testid="etiquettes-client-deal"]', { timeout: 45000 }).catch(() => {});
  await page.evaluate(() => [...document.querySelectorAll('[data-testid="etiquettes-client-deal"] button')].find((b) => b.textContent.trim() === 'Étiquette')?.click());
  await page.waitForSelector('[data-testid="etiquettes-client-deal"] input[aria-label="Ajouter une étiquette"]', { timeout: 10000 }).catch(() => {});
  await page.type('[data-testid="etiquettes-client-deal"] input[aria-label="Ajouter une étiquette"]', 'ZZSonde-V');
  await pause(500);
  await page.keyboard.press('Enter');
  await attendre(async () => (await tagsDe('c')).includes(VIP));
  verif('fiche du deal : l’étiquette est posée sur le CLIENT', (await tagsDe('c')).includes(VIP), (await tagsDe('c')).join(','));
  await page.waitForFunction((v) => !!document.querySelector(`button[aria-label="Retirer l’étiquette ${v}"]`), { timeout: 10000 }, VIP).catch(() => {});
  await capture(page, '2-fiche-deal-entete');
  await page.evaluate((v) => document.querySelector(`button[aria-label="Retirer l’étiquette ${v}"]`)?.click(), VIP);
  await attendre(async () => !(await tagsDe('c')).includes(VIP));
  verif('fiche du deal : × la retire du client', !(await tagsDe('c')).includes(VIP), (await tagsDe('c')).join(',') || '(aucune)');

  // ── 3. Filtre + vue enregistrée ──
  await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => /ZZSonde Alpha/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  await rechercher('ZZSonde');
  verif('sans filtre : les 3 deals ZZSonde', (await cartes()).length === 3, (await cartes()).join(', '));
  await cliquerBouton(/^Filtres/);
  await page.waitForFunction(() => [...document.querySelectorAll('legend')].some((l) => /A l’étiquette/.test(l.textContent)), { timeout: 10000 }).catch(() => {});
  await choisirFiltre('A l’étiquette', VIP);
  await pause(500);
  verif('filtre « a VIP » : Alpha et Bravo seulement', JSON.stringify(await cartes()) === JSON.stringify(['ZZSonde Alpha', 'ZZSonde Bravo']), (await cartes()).join(', '));
  await choisirFiltre('A l’étiquette', ETE);
  await page.evaluate(() => {
    const s = [...document.querySelectorAll('select')].find((x) => [...x.options].some((o) => o.value === 'toutes'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'toutes');
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pause(500);
  verif('« a toutes » VIP + Été : Alpha seul', JSON.stringify(await cartes()) === JSON.stringify(['ZZSonde Alpha']), (await cartes()).join(', '));
  await capture(page, '3-filtre-etiquettes');
  await cliquerBouton(/Enregistrer la vue/);
  await page.waitForFunction(() => !!document.querySelector('input[placeholder^="Ex. : Soumissions"]'), { timeout: 10000 }).catch(() => {});
  await page.type('input[placeholder^="Ex. : Soumissions"]', NOM_VUE);
  await page.evaluate(() => document.querySelector('input[placeholder^="Ex. : Soumissions"]').form.requestSubmit());
  await attendre(async () => !!(await admin.from('pipeline_vues').select('id').eq('pipeline_id', pip.id).eq('nom', NOM_VUE).maybeSingle()).data);
  const vue = (await admin.from('pipeline_vues').select('filtres').eq('pipeline_id', pip.id).eq('nom', NOM_VUE).maybeSingle()).data;
  verif('vue enregistrée avec le filtre d’étiquettes', vue?.filtres?.etiquettes_mode === 'toutes' && JSON.parse(vue?.filtres?.etiquettes ?? '[]').length === 2, JSON.stringify(vue?.filtres));
  await page.reload({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction((n) => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.includes(n)), { timeout: 45000 }, NOM_VUE).catch(() => {});
  await page.evaluate((n) => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes(n))?.click(), NOM_VUE);
  await pause(1200);
  verif('rouvrir la vue restaure le filtre (Alpha seul)', JSON.stringify(await cartes()) === JSON.stringify(['ZZSonde Alpha']), (await cartes()).join(', '));
  await capture(page, '3b-vue-restauree');

  // ── 4. Actions en lot : 2 deals → leurs clients ──
  await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Tous')?.click());
  await pause(500);
  await rechercher('ZZSonde');
  for (const nom of ['ZZSonde Bravo', 'ZZSonde Charlie']) {
    await page.evaluate((n) => document.querySelector(`input[type=checkbox][aria-label="Sélectionner ${n}"]`)?.click(), nom);
  }
  await pause(300);
  await cliquerBouton(/^Ajouter une étiquette$/);
  await page.waitForFunction(() => /2 client\(s\) pour 2 deal\(s\)/.test(document.body.innerText), { timeout: 10000 }).catch(() => {});
  verif('la fenêtre annonce 2 clients pour 2 deals', await page.evaluate(() => /2 client\(s\) pour 2 deal\(s\)/.test(document.body.innerText)));
  await page.evaluate(() => [...document.querySelectorAll('.modal-content button, [role="dialog"] button')].find((b) => b.textContent.trim() === 'Étiquette')?.click());
  await page.waitForSelector('input[aria-label="Ajouter une étiquette"]', { timeout: 10000 }).catch(() => {});
  await page.type('input[aria-label="Ajouter une étiquette"]', 'ZZSonde-Co');
  await pause(500);
  await page.keyboard.press('Enter');
  await pause(300);
  await cliquerBouton(/^Appliquer$/);
  await page.waitForFunction(() => /partiront pour chaque client/.test(document.body.innerText), { timeout: 10000 }).catch(() => {});
  verif('confirmation qui prévient des automatisations', await page.evaluate(() => /« Étiquette ajoutée » partiront pour chaque client/.test(document.body.innerText)));
  await capture(page, '4-lot-confirmation');
  await page.evaluate(() => { const bs = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Ajouter'); bs.pop()?.click(); });
  await attendre(async () => (await tagsDe('b')).includes(COM) && (await tagsDe('c')).includes(COM));
  verif('en lot : Bravo et Charlie reçoivent l’étiquette, pas Alpha',
    (await tagsDe('b')).includes(COM) && (await tagsDe('c')).includes(COM) && (await tagsDe('a')).filter((t) => t === COM).length === 1,
    `b=${await tagsDe('b')} c=${await tagsDe('c')}`);
  await page.waitForFunction((v) => [...document.querySelectorAll('[role="group"][aria-label^="Étiquettes"]')].filter((g) => g.getAttribute('aria-label').includes(v)).length >= 3, { timeout: 15000 }, COM).catch(() => {});
  await capture(page, '4b-lot-applique');
  verif('les cartes suivent sans recharger', await page.evaluate((v) => [...document.querySelectorAll('[role="group"][aria-label^="Étiquettes"]')].filter((g) => g.getAttribute('aria-label').includes(v)).length >= 3, COM));

  // ── 5. Liste Clients filtrée par l'URL ──
  await page.goto(`${BASE}/clients?etiquette=${encodeURIComponent(ETE)}`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => /ZZSonde/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  await pause(1000);
  const liste = await page.evaluate(() => ({
    alpha: /ZZSonde Alpha/.test(document.body.innerText),
    autres: /ZZSonde (Bravo|Charlie)/.test(document.body.innerText),
    pastille: [...document.querySelectorAll('button[aria-controls]')].find((b) => /Étiquettes/.test(b.textContent))?.textContent ?? '',
    total: document.querySelector('h1')?.textContent ?? '',
  }));
  verif('/clients?etiquette= : Alpha seul, filtre affiché', liste.alpha && !liste.autres && liste.pastille.includes(ETE), JSON.stringify(liste));
  await capture(page, '5-clients-filtre-url');
} catch (e) {
  ko++; console.log('💥', e.message ?? e);
} finally {
  await nav.close();
  const effacer = async (etiquette, req) => { const { error } = await req; if (error) console.log(`⚠ nettoyage ${etiquette} :`, error.message); };
  await effacer('vue', admin.from('pipeline_vues').delete().eq('pipeline_id', pip.id).eq('nom', NOM_VUE));
  const clients = Object.values(trace.clients);
  const deals = Object.values(trace.deals);
  if (clients.length) {
    await effacer('journal des lots', admin.from('pipeline_operations_lot').delete().eq('org_id', ORG).like('libelle', `%${COM}%`));
  }
  for (const d of deals) {
    await effacer('événements', admin.from('pipeline_events').delete().eq('deal_id', d));
    await effacer('historique', admin.from('deal_stage_history').delete().eq('deal_id', d));
    await effacer('tâches (deal)', admin.from('automation_scheduled_tasks').delete().eq('entity_id', d));
    await effacer('deal', admin.from('deals').delete().eq('id', d));
  }
  for (const c of clients) {
    await effacer('étiquettes', admin.from('client_tags').delete().eq('client_id', c));
    await effacer('tâches (client)', admin.from('automation_scheduled_tasks').delete().eq('entity_id', c));
    await effacer('événements (client)', admin.from('domain_events').delete().eq('entity_id', c));
    await effacer('ancien pipeline', admin.from('pipeline_deals').delete().eq('client_id', c));
    await effacer('journal client', admin.from('activity_log').delete().eq('related_entity_id', c));
    await effacer('client', admin.from('clients').delete().eq('id', c));
  }
  await effacer('catalogue', admin.from('tags').delete().eq('org_id', ORG).in('name', [VIP, ETE, COM]));
  const reste = (await admin.from('clients').select('id').eq('first_name', 'ZZSonde').in('last_name', ['Alpha', 'Bravo', 'Charlie'])).data.length
    + (await admin.from('tags').select('id').eq('org_id', ORG).like('name', 'ZZSonde-%')).data.length;
  console.log(`\n${ok} ✅  ${ko} ❌   — nettoyage : ${reste === 0 ? 'rien ne reste' : `${reste} ligne(s) restante(s)`}`);
}
