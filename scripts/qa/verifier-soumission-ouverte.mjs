// Usage : FRONTEND_URL=http://localhost:5173 node --env-file=.env.local scripts/qa/verifier-soumission-ouverte.mjs [dossier-captures]
//
// Parcours de bout en bout du déclencheur « Soumission ouverte par le client »
// (mission du 2026-09-28), contre STAGING (refuse la prod), dans un VRAI
// navigateur. Le serveur visé doit tourner avec ce code ET sans identifiants
// d'envoi (aucun courriel/SMS réel pendant les tests).
//
// L'« envoi » de la soumission est simulé en posant `status = 'awaiting_response'` et
// `sent_via_email_at` : l'envoi réel partirait chez un client.
//
// Crée ses propres données (préfixe ZZSonde) et les supprime à la fin, et
// remet les automatisations par défaut dans leur état d'origine.
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const BASE = process.env.FRONTEND_URL || 'http://localhost:5173';
const OUT = process.argv[2] || null;
const URL_SB = process.env.VITE_SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.SUPABASE_PROJECT_REF === process.env.SUPABASE_PROJECT_REF_PROD) throw new Error('prod refusée');
const admin = createClient(URL_SB, SR, { auth: { persistSession: false } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Un navigateur de test s'annonce « HeadlessChrome » : le serveur le traite
// (à raison) comme un robot. On se présente comme un Chrome ordinaire, pour
// que chaque exclusion testée le soit pour SA raison (équipe, scanner…).
const UA_HUMAIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
let ok = 0, ko = 0;
const verif = (n, c, d = '') => { c ? ok++ : ko++; console.log(`${c ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`); };

const COMPTE = 'qa-pipeline@lume.test', MDP = 'QaPipeline1234!';
const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
const uidProprio = lien.user.id;
const { data: mb } = await admin.from('memberships').select('org_id').eq('user_id', uidProprio).eq('status', 'active').limit(1).single();
const ORG = mb.org_id;

const { data: regles } = await admin.from('automation_rules').select('id, preset_key, conditions, is_active')
  .eq('org_id', ORG).in('preset_key', ['quote_opened_notify', 'quote_opened_move_deal']);
const notif = regles.find((r) => r.preset_key === 'quote_opened_notify');
const deplacer = regles.find((r) => r.preset_key === 'quote_opened_move_deal');
verif('les deux automatisations par défaut existent et sont actives', !!notif?.is_active && !!deplacer?.is_active);
const etatRegles = regles.map((r) => ({ id: r.id, conditions: r.conditions, is_active: r.is_active }));

const { data: pip } = await admin.from('pipelines_ventes').select('id').eq('org_id', ORG).eq('is_default', true).single();
const { data: etapes } = await admin.from('pipeline_stages').select('id, name_fr, role_systeme, position')
  .eq('pipeline_id', pip.id).is('archived_at', null).order('position');
const envoyee = etapes.find((e) => e.role_systeme === 'soumission_envoyee');
const ouverte = etapes.find((e) => e.role_systeme === 'soumission_ouverte');
verif('le pipeline par défaut a « Soumission ouverte » juste après « Soumission envoyée »',
  !!envoyee && !!ouverte && ouverte.position === envoyee.position + 1, etapes.map((e) => e.name_fr).join(' › '));

const trace = { client: null, quote: null, deal: null };
let langueARemettre = null;
async function remettreLangue() {
  if (!langueARemettre) return;
  const { data: u } = await admin.auth.admin.getUserById(uidProprio);
  await admin.auth.admin.updateUserById(uidProprio, { user_metadata: { ...(u.user.user_metadata ?? {}), language: langueARemettre } });
  langueARemettre = null;
}
const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const nbNotifs = async () => (await admin.from('notifications').select('id', { count: 'exact', head: true })
  .eq('org_id', ORG).eq('entity_type', 'quote').eq('entity_id', trace.quote).eq('user_id', uidProprio)).count;
const prevenus = async () => new Set(((await admin.from('notifications').select('user_id')
  .eq('entity_id', trace.quote)).data ?? []).map((n) => n.user_id));
const { data: equipe } = await admin.from('memberships').select('user_id, role').eq('org_id', ORG).eq('status', 'active');
const proprios = equipe.filter((m) => m.role === 'owner').map((m) => m.user_id);
const admins = equipe.filter((m) => m.role === 'admin').map((m) => m.user_id);
const repVendeur = equipe.find((m) => m.role === 'sales_rep')?.user_id;
const memeEnsemble = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
let accesPoses = false;
const etatQuote = async () => (await admin.from('quotes').select('view_count, is_viewed, viewed_at').eq('id', trace.quote).single()).data;
/** Ouvre la page publique dans un navigateur NEUF (nouvelle session), anonyme. */
async function ouvrirAnonyme(url, opts = {}) {
  const ctx = await nav.createBrowserContext();
  const page = await ctx.newPage();
  await page.setUserAgent(opts.ua ?? UA_HUMAIN);
  // Attendre que la soumission soit RÉELLEMENT affichée (en développement,
  // Vite compile la page au premier passage : 8 s mesurées).
  const affichee = () => page.waitForFunction(() => /ZZSONDE-OUV/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await affichee();
  await pause(1500);
  if (opts.recharger) { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await affichee(); await pause(1500); }
  const texte = await page.evaluate(() => document.body.innerText);
  await ctx.close();
  return texte;
}
const attendre = async (cond, ms = 8000) => { const fin = Date.now() + ms; while (Date.now() < fin) { if (await cond()) return true; await pause(400); } return false; };

try {
  // ── Mise en place : client → opportunité → soumission « envoyée » ──
  const { data: c, error: eC } = await admin.from('clients').insert({
    org_id: ORG, first_name: 'ZZSonde', last_name: 'Ouverture', status: 'lead',
    email: 'zzsonde.ouverture@example.invalid', created_by: uidProprio, tags: ['vip'],
  }).select('id').single();
  if (eC) throw eC; trace.client = c.id;
  const { data: q, error: eQ } = await admin.from('quotes').insert({
    org_id: ORG, client_id: c.id, quote_number: 'ZZSONDE-OUV', status: 'awaiting_response', title: 'Lavage extérieur',
    subtotal_cents: 125000, tax_cents: 0, total_cents: 125000, salesperson_id: uidProprio, created_by: uidProprio,
    sent_via_email_at: new Date(Date.now() - 60_000).toISOString(),
  }).select('id, view_token').single();
  if (eQ) throw eQ; trace.quote = q.id;
  const { data: d, error: eD } = await admin.from('deals').insert({
    org_id: ORG, pipeline_id: pip.id, stage_id: envoyee.id, client_id: c.id, quote_id: q.id,
    source: 'manual', created_by: uidProprio, assigned_user_id: repVendeur,
  }).select('id').single();
  if (eD) throw eD; trace.deal = d.id;
  const URLQ = `${BASE}/quote/${q.view_token}`;

  // ── 1. Première ouverture, navigateur anonyme ──
  const texte1 = await ouvrirAnonyme(URLQ);
  verif('la page publique s’affiche', /ZZSONDE-OUV|Lavage extérieur/i.test(texte1));
  await attendre(async () => (await nbNotifs()) >= 1);
  const q1 = await etatQuote();
  verif('1re ouverture : 1 vue enregistrée', q1.view_count === 1 && q1.is_viewed && !!q1.viewed_at, `vues=${q1.view_count}`);
  const { data: vues } = await admin.from('quote_views').select('org_id, is_first_view, session_hash, user_agent_hash, ip_address, user_agent').eq('quote_id', q.id);
  verif('journal Loi 25 : empreintes seulement, ni IP ni navigateur en clair',
    vues.length === 1 && vues[0].org_id === ORG && vues[0].is_first_view === true && !!vues[0].session_hash
    && !!vues[0].user_agent_hash && vues[0].ip_address === null && vues[0].user_agent === null);
  const { data: n1 } = await admin.from('notifications').select('user_id, title, link').eq('entity_id', q.id);
  const attendus1 = new Set([...proprios, ...admins, repVendeur]);
  verif('prévenus : le rep assigné + tous les propriétaires + les admins (pipeline ouvert)',
    memeEnsemble(new Set(n1.map((n) => n.user_id)), attendus1) && n1.every((n) => n.user_id),
    `${n1.length} personne(s), attendu ${attendus1.size}`);
  verif('le texte porte le client, le numéro et le total', /ZZSonde Ouverture/.test(n1[0]?.title ?? '') && /ZZSONDE-OUV/.test(n1[0]?.title ?? '') && /1\s?250/.test(n1[0]?.title ?? ''));
  verif('le bouton mène à la soumission dans l’app', n1[0]?.link === `/quotes/${q.id}`);
  await attendre(async () => (await admin.from('deals').select('stage_id').eq('id', d.id).single()).data.stage_id === ouverte.id);
  const dealApres = (await admin.from('deals').select('stage_id').eq('id', d.id).single()).data;
  verif('l’opportunité passe à « Soumission ouverte »', dealApres.stage_id === ouverte.id);
  const { data: hist } = await admin.from('deal_stage_history').select('actor_type, motif').eq('deal_id', d.id).eq('to_stage_id', ouverte.id);
  verif('historique : « Déplacée automatiquement — le client a ouvert la soumission »',
    hist?.[0]?.actor_type === 'automation' && hist?.[0]?.motif === 'Déplacée automatiquement — le client a ouvert la soumission');

  // ── 2. Rechargement dans la même session : pas une nouvelle vue ──
  await ouvrirAnonyme(URLQ, { recharger: true }); // nouvelle session : +1 ; son rechargement : +0
  await pause(1500);
  const q2 = await etatQuote();
  verif('nouvelle session → +1 vue ; son rechargement → rien', q2.view_count === 2, `vues=${q2.view_count}`);
  verif('mode « première ouverture » : pas de 2e notification', (await nbNotifs()) === 1);
  const { data: dealStable } = await admin.from('deals').select('stage_id').eq('id', d.id).single();
  verif('l’opportunité ne bouge pas une 2e fois', dealStable.stage_id === ouverte.id);

  // ── 3. « Chaque ouverture » : une 2e notification arrive ──
  await admin.from('automation_rules').update({ conditions: { ouverture: 'chaque' } }).eq('id', notif.id);
  // Le pipeline est réservé au seul vendeur : l'admin n'y a plus accès.
  const { error: eAcc } = await admin.from('pipeline_acces').insert({ org_id: ORG, pipeline_id: pip.id, user_id: repVendeur });
  if (eAcc) throw eAcc;
  accesPoses = true;
  const avantRestreint = new Set(((await admin.from('notifications').select('id').eq('entity_id', q.id)).data ?? []).map((n) => n.id));
  // Le moteur ignore une 2e exécution de la même règle sur le même devis à
  // moins de 2 minutes (anti-double envoi, #698 : double clic, reprise
  // réseau). Une vraie réouverture arrive plus tard : on attend la fenêtre.
  console.log('   (attente de la fenêtre anti-doublon du moteur : 2 min 5 s)');
  await pause(125_000);
  await ouvrirAnonyme(URLQ);
  await attendre(async () => (await nbNotifs()) >= 2);
  verif('mode « chaque ouverture » : 2e notification reçue', (await nbNotifs()) === 2);
  const { data: n3 } = await admin.from('notifications').select('id, user_id').eq('entity_id', q.id);
  const nouveaux = new Set(n3.filter((n) => !avantRestreint.has(n.id)).map((n) => n.user_id));
  verif('pipeline réservé au vendeur : propriétaires + vendeur prévenus, admin exclu NON',
    memeEnsemble(nouveaux, new Set([...proprios, repVendeur])) && admins.every((a) => !nouveaux.has(a)),
    `${nouveaux.size} prévenu(s)`);
  await admin.from('pipeline_acces').delete().eq('pipeline_id', pip.id).eq('user_id', repVendeur);
  accesPoses = false;

  // ── 4. Robot / scanner de liens : rien ──
  const avantRobot = (await etatQuote()).view_count;
  await ouvrirAnonyme(URLQ, { ua: 'Mozilla/5.0 (compatible; Microsoft Office/16.0; Microsoft Outlook 16.0 SafeLinks)' });
  await pause(1500);
  verif('un scanner de liens ne compte pas', (await etatQuote()).view_count === avantRobot);

  // ── 5. Membre de l'équipe CONNECTÉ : rien ──
  const ctxConnecte = await nav.createBrowserContext();
  const page = await ctxConnecte.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setUserAgent(UA_HUMAIN);
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
  const avantInterne = (await etatQuote()).view_count;
  const nAvantInterne = await nbNotifs();
  await page.goto(URLQ, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForFunction(() => /ZZSONDE-OUV/.test(document.body.innerText), { timeout: 45000 }).catch(() => {});
  await pause(2500);
  verif('ouverte par un membre connecté : aucune vue', (await etatQuote()).view_count === avantInterne);
  verif('… et aucune notification', (await nbNotifs()) === nAvantInterne);

  // Fiche soumission : « Ouverte par le client · il y a … · N vues »
  await page.goto(`${BASE}/quotes/${q.id}`, { waitUntil: 'networkidle2' }).catch(() => {});
  await pause(3000);
  const vuesTexte = await page.evaluate(() => document.querySelector('[data-testid="soumission-vues"]')?.textContent ?? '');
  verif('fiche : « Ouverte par le client · il y a … · N vues »', /il y a|à l’instant|moins d/i.test(vuesTexte) && /\d+\s+vues/.test(vuesTexte), vuesTexte.trim());
  if (OUT) await page.screenshot({ path: `${OUT}/fiche-soumission-vues.png` });

  // Pipeline : la nouvelle étape, avec l'opportunité dedans
  await page.goto(`${BASE}/ventes`, { waitUntil: 'networkidle2' }).catch(() => {});
  await pause(3500);
  const board = await page.evaluate(() => document.body.innerText);
  verif('pipeline : la colonne « Soumission ouverte » existe', /Soumission ouverte/.test(board));
  if (OUT) await page.screenshot({ path: `${OUT}/pipeline-soumission-ouverte.png` });

  // Sélecteur de déclencheur (automatisation par défaut ouverte dans l'éditeur)
  await page.goto(`${BASE}/automations/${notif.id}`, { waitUntil: 'networkidle2' }).catch(() => {});
  await pause(3500);
  const editeur = await page.evaluate(() => document.body.innerText);
  verif('éditeur : déclencheur « Devis ouvert par le client »', /Devis ouvert par le client/.test(editeur));
  if (OUT) await page.screenshot({ path: `${OUT}/declencheur-soumission-ouverte.png` });

  // EN : les libellés anglais existent (même écran, langue anglaise). La
  // langue suit la préférence DU COMPTE (elle l'emporte sur le navigateur) :
  // on la bascule le temps de la vérification, puis on la remet.
  const { data: compte } = await admin.auth.admin.getUserById(uidProprio);
  const metaAvant = compte.user.user_metadata ?? {};
  await admin.auth.admin.updateUserById(uidProprio, { user_metadata: { ...metaAvant, language: 'en' } });
  await page.evaluate(() => localStorage.setItem('lume-language', 'en'));
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForFunction(() => /Quote opened by client/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  await pause(1000);
  langueARemettre = metaAvant.language ?? 'fr';
  const editeurEn = await page.evaluate(() => document.body.innerText);
  verif('EN : « Quote opened by client »', /Quote opened by client/.test(editeurEn));
  if (OUT) await page.screenshot({ path: `${OUT}/declencheur-soumission-ouverte-en.png` });
  await ctxConnecte.close();
  // Remise APRÈS fermeture : tant que la page connectée vit, l'app
  // resynchronise la langue choisie sur le compte et écraserait la remise.
  await remettreLangue();

  // ── 6. Automatisation par défaut désactivée : plus de notification, le suivi continue ──
  await admin.from('automation_rules').update({ is_active: false }).eq('id', notif.id);
  const vAvant = (await etatQuote()).view_count;
  const nAvant = await nbNotifs();
  await ouvrirAnonyme(URLQ);
  await pause(2500);
  verif('désactivée : aucune notification…', (await nbNotifs()) === nAvant);
  verif('… mais la vue est bien comptée', (await etatQuote()).view_count === vAvant + 1);

  // ── 7. Isolation : un autre bureau ne voit rien de ces vues ──
  const { data: autre } = await admin.from('memberships').select('user_id, org_id').neq('org_id', ORG).eq('status', 'active').limit(1).single();
  const { data: uAutre } = await admin.auth.admin.getUserById(autre.user_id);
  const { data: l2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: uAutre.user.email });
  const { data: s2 } = await createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
    .auth.verifyOtp({ type: 'magiclink', token_hash: l2.properties.hashed_token });
  const etranger = createClient(URL_SB, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s2.session.access_token}`, 'x-lume-org': autre.org_id } },
  });
  const { data: vuesEtr } = await etranger.from('quote_views').select('id').eq('quote_id', q.id);
  verif('isolation : un autre bureau ne voit aucune vue', (vuesEtr ?? []).length === 0);
  const { data: reglesEtr } = await etranger.from('automation_rules').select('id').in('id', [notif.id, deplacer.id]);
  verif('isolation : ni ses automatisations', (reglesEtr ?? []).length === 0);
  const pub = await fetch(`${BASE.replace(/:\d+$/, ':' + (process.env.API_PORT || '3099'))}/api/quotes/public/${q.view_token}`).then((r) => r.json()).catch(() => ({}));
  verif('page publique : aucune donnée interne exposée (vues, responsable, notes internes)',
    !JSON.stringify(pub).match(/view_count|is_viewed|salesperson_id|session_hash|user_agent_hash/));
} catch (e) {
  ko++; console.log('💥', e.message ?? e);
} finally {
  await nav.close();
  await remettreLangue();
  if (accesPoses) await admin.from('pipeline_acces').delete().eq('pipeline_id', pip.id).eq('user_id', repVendeur);
  for (const r of etatRegles) await admin.from('automation_rules').update({ conditions: r.conditions, is_active: r.is_active }).eq('id', r.id);
  if (trace.quote) {
    // L'outbox (#695) garde une trace durable de chaque événement émis.
    await admin.from('domain_events').delete().eq('entity_id', trace.quote);
    await admin.from('notifications').delete().eq('entity_id', trace.quote);
    await admin.from('quote_views').delete().eq('quote_id', trace.quote);
  }
  const effacer = async (etiquette, req) => { const { error } = await req; if (error) console.log(`⚠ nettoyage ${etiquette} :`, error.message); };
  if (trace.deal) {
    await effacer('événements', admin.from('pipeline_events').delete().eq('deal_id', trace.deal));
    await effacer('historique', admin.from('deal_stage_history').delete().eq('deal_id', trace.deal));
    await effacer('deal', admin.from('deals').delete().eq('id', trace.deal));
  }
  // Un déclencheur HISTORIQUE crée une ligne dans l'ancien pipeline
  // porte-à-porte (`pipeline_deals`) quand une soumission est insérée : elle
  // bloque la suppression du devis et du client si on ne l'enlève pas d'abord.
  if (trace.quote) await effacer('ancien pipeline (devis)', admin.from('pipeline_deals').delete().eq('quote_id', trace.quote));
  if (trace.client) await effacer('ancien pipeline (client)', admin.from('pipeline_deals').delete().eq('client_id', trace.client));
  if (trace.quote) {
    await effacer('journal devis', admin.from('activity_log').delete().eq('entity_id', trace.quote));
    await effacer('devis', admin.from('quotes').delete().eq('id', trace.quote));
  }
  if (trace.client) {
    await effacer('journal client', admin.from('activity_log').delete().eq('related_entity_id', trace.client));
    await effacer('client', admin.from('clients').delete().eq('id', trace.client));
  }
  const reste = (await admin.from('clients').select('id').eq('last_name', 'Ouverture').eq('first_name', 'ZZSonde')).data.length;
  console.log(`\n${ok} ✅  ${ko} ❌   — nettoyage : ${reste === 0 ? 'rien ne reste' : reste + ' restant(s)'} ; automatisations remises dans leur état d’origine`);
}
