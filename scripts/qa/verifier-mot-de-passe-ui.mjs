#!/usr/bin/env node
/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VÃ‰RIFICATION â€” parcours mot de passe (navigateur, staging)

   Page de connexion (erreur traduite + indice Google), /reset-password
   (lien invalide, vrai lien), carte Â« Connexion Â» de Mon profil pour un
   compte Google sans mot de passe (dÃ©finir â†’ renvoi vers /auth, courriel
   prÃ©-rempli â†’ connexion par mot de passe), puis Â« Changer le mot de
   passe Â». Ferme les superpositions d'un compte neuf (localisation,
   tÃ©moins) et masque les widgets flottants pour capturer la carte.

   PrÃ©requis : Vite + API locaux branchÃ©s sur STAGING.
   Variables : QA_BASE (dÃ©faut http://localhost:5173), QA_ORG (org qui
   porte l'abonnement de test), QA_OUT (dossier des captures, dÃ©faut .).
   Usage : node --env-file=.env.local scripts/qa/verifier-mot-de-passe-ui.mjs
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';

const BASE = (process.env.QA_BASE || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const OUT = (process.env.QA_OUT || '.').replace(/\/$/, '');
const url = process.env.VITE_SUPABASE_URL;
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url.includes(ref)) throw new Error('VITE_SUPABASE_URL ne pointe pas sur staging - abandon');
const ORG_QA = process.env.QA_ORG || 'eeda2ab3-08df-4fce-82e1-3aa9b7d833cf';

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }),
  });
  const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j)); return j;
};
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
let ok = true;
const R = (cond, label, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ' -- ' + detail : ''}`); if (!cond) ok = false; };
const texte = (page) => page.evaluate(() => document.body.innerText);
const attendreTexte = (page, t, timeout = 15000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, t).then(() => true).catch(() => false);
const attendreChemin = (page, pred, timeout = 15000) => page.waitForFunction(pred, { timeout }).then(() => true).catch(() => false);
const taper = async (page, sel, val) => { await page.waitForSelector(sel, { timeout: 10000 }); await page.click(sel, { clickCount: 3 }); await page.type(sel, val); };
// Capture la carte Â« Connexion Â» seule (elle vit dans une zone defilante, la page entiere ne la montre pas)
const capturerCarte = async (page, path) => {
  const h = await page.evaluateHandle(() => [...document.querySelectorAll('.section-card')].find((el) => /Connexion|Sign-in/.test(el.innerText || '') && (el.innerText || '').includes('Google')));
  const el = h.asElement();
  if (el) {
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    // Masque les elements flottants (widget de configuration, bulle d'aide) qui recouvrent la carte
    await page.evaluate(() => { for (const x of document.querySelectorAll('body *')) { if (getComputedStyle(x).position === 'fixed') { x.dataset.qaMasque = x.style.visibility || ''; x.style.visibility = 'hidden'; } } });
    await new Promise((r) => setTimeout(r, 400));
    await el.screenshot({ path });
    await page.evaluate(() => { for (const x of document.querySelectorAll('[data-qa-masque]')) { x.style.visibility = x.dataset.qaMasque; delete x.dataset.qaMasque; } });
  } else await page.screenshot({ path });
};
// Clic DOM sur le premier bouton dont le texte contient `t` (passe outre les superpositions)
const cliquerBouton = (page, t) => page.evaluate((x) => {
  const b = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim().includes(x));
  if (b) { b.click(); return true; } return false;
}, t);
// Compte neuf : la demande de localisation et le bandeau temoins couvrent la page
const fermerSuperpositions = async (page) => {
  for (let i = 0; i < 10; i++) {
    const t = await texte(page);
    let ferme = false;
    if (t.includes('Partage de votre localisation')) ferme = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === 'Refuser'); if (b) { b.click(); return true; } return false; }) || ferme;
    if (t.includes('Votre vie privÃ©e')) ferme = await cliquerBouton(page, 'Tout refuser') || ferme;
    if (!ferme) break;
    await new Promise((r) => setTimeout(r, 600));
  }
};

// Compte Google simule + membership admin dans l'org QA (sinon le garde d'abonnement bloque les reglages)
const email = `qa-google-ui-${Date.now()}@example.test`;
const MDP = 'Xx-Google-Ui-2468!';
const { data: created, error: e1 } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: 'QA Google UI' } });
if (e1) throw e1;
const id = created.user.id;
await sql(`delete from auth.identities where user_id='${id}';
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), 'gui-${Date.now()}', '${id}', '{"sub":"gui","email":"${email}","email_verified":true}', 'google', now(), now(), now());
  update auth.users set encrypted_password = null where id='${id}';`);
const { error: mErr } = await admin.from('memberships').insert({ user_id: id, org_id: ORG_QA, role: 'admin', status: 'active', full_name: 'QA Google UI' });
if (mErr) throw new Error('membership: ' + mErr.message);
console.log('compte Google simule:', email);

const nav = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await nav.newPage();
await page.setViewport({ width: 1200, height: 900 });
const erreurs = [];
page.on('pageerror', (e) => erreurs.push(String(e.message)));
try {
  // Langue FR pour lire les memes libelles que le client
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.evaluate(() => localStorage.setItem('lume-language', 'fr'));

  // 1. Page de connexion : mauvais identifiants -> indice Â« Inscrit avec Google ? Â»
  await page.goto(`${BASE}/auth`, { waitUntil: 'networkidle2', timeout: 45000 });
  await taper(page, 'input[type=email]', `inconnu-${Date.now()}@example.test`);
  await taper(page, 'input[type=password]', 'Mauvais-Mdp-1234!');
  await page.click('button[type=submit]');
  R(await attendreTexte(page, 'Inscrit avec Google'), 'connexion refusee -> indice Google / mot de passe oublie affiche');
  await new Promise((r) => setTimeout(r, 1200)); // laisse finir l'animation d'ouverture du message
  await cliquerBouton(page, 'Tout refuser');
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: `${OUT}/qa-mdp-1-auth-indice.png`, fullPage: true });

  // 2. /reset-password avec un jeton bidon -> formulaire, puis ecran Â« lien invalide Â»
  await page.goto(`${BASE}/reset-password?token=${'f'.repeat(64)}&email=${encodeURIComponent(email)}`, { waitUntil: 'networkidle2', timeout: 45000 });
  R(await attendreTexte(page, 'Choisis un nouveau mot de passe'), 'page /reset-password rendue (hors session)');
  const champs = await page.$$('input[autocomplete=new-password]');
  R(champs.length === 2, 'deux champs mot de passe', `trouve ${champs.length}`);
  await champs[0].type(MDP); await champs[1].type(MDP);
  await page.click('button[type=submit]');
  R(await attendreTexte(page, 'Ce lien est invalide'), 'jeton bidon -> ecran Â« lien invalide Â»');
  await page.screenshot({ path: `${OUT}/qa-mdp-2-reset-invalide.png`, fullPage: true });

  // 3. Session Google simulee (lien magique) -> Mon profil -> carte Connexion
  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const { data: sess, error: vErr } = await anon.auth.verifyOtp({ token_hash: lien.properties.hashed_token, type: 'magiclink' });
  if (vErr) throw vErr;
  await page.evaluate((t, org) => { localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', org); }, sess.session, ORG_QA);
  await page.goto(`${BASE}/settings/profile`, { waitUntil: 'networkidle2', timeout: 60000 });
  await attendreTexte(page, 'DÃ©finir un mot de passe', 30000);
  await fermerSuperpositions(page);
  R(await attendreTexte(page, 'DÃ©finir un mot de passe', 30000), 'carte Connexion : bouton Â« DÃ©finir un mot de passe Â» (compte Google sans mdp)');
  const t3 = await texte(page);
  R(t3.includes('Non dÃ©fini'), 'ligne Â« Courriel et mot de passe Â» = Non dÃ©fini');
  R(t3.includes('Ton compte a Ã©tÃ© crÃ©Ã© avec Google'), 'explication compte Google affichee');
  await capturerCarte(page, `${OUT}/qa-mdp-3-profil-carte.png`);

  // 4. Definir le mot de passe depuis la carte -> renvoi vers /auth, courriel pre-rempli
  const clique = await cliquerBouton(page, 'DÃ©finir un mot de passe');
  R(clique, 'clic Â« DÃ©finir un mot de passe Â»');
  await page.waitForSelector('input[autocomplete=new-password]', { timeout: 10000 });
  const c4 = await page.$$('input[autocomplete=new-password]');
  R(c4.length === 2 && !(await page.$('input[autocomplete=current-password]')), 'formulaire : nouveau + confirmation, PAS de Â« mot de passe actuel Â»', `new=${c4.length}`);
  await c4[0].type(MDP); await c4[1].type(MDP);
  await capturerCarte(page, `${OUT}/qa-mdp-4-profil-formulaire.png`);
  await page.click('form button[type=submit]');
  R(await attendreChemin(page, () => location.pathname === '/auth', 20000), 'apres enregistrement -> page /auth');
  R(await attendreTexte(page, 'mot de passe a Ã©tÃ© mis Ã  jour'), 'message Â« mot de passe mis a jour Â» sur /auth');
  const emailPrerempli = await page.$eval('input[type=email]', (el) => el.value).catch(() => '');
  R(emailPrerempli === email, 'courriel pre-rempli', emailPrerempli);
  await page.screenshot({ path: `${OUT}/qa-mdp-5-auth-apres-definition.png`, fullPage: true });
  const u = (await admin.auth.admin.getUserById(id)).data.user;
  R(u.app_metadata.has_password === true, 'app_metadata.has_password = true en base');

  // 5. Connexion par courriel + mot de passe via l'interface
  await taper(page, 'input[type=password]', MDP);
  await page.click('button[type=submit]');
  R(await attendreChemin(page, () => location.pathname !== '/auth', 30000), 'connecte par mot de passe -> quitte /auth', await page.evaluate(() => location.pathname));
  await page.waitForNetworkIdle({ idleTime: 1500, timeout: 30000 }).catch(() => {});
  console.log('   atterrissage :', await page.evaluate(() => location.pathname));
  await page.screenshot({ path: `${OUT}/qa-mdp-6-connecte.png`, fullPage: false });

  // 6. Mon profil maintenant : carte = Actif + Â« Changer le mot de passe Â» + champ mot de passe actuel
  await page.goto(`${BASE}/settings/profile`, { waitUntil: 'networkidle2', timeout: 60000 });
  await attendreTexte(page, 'Changer le mot de passe', 30000);
  await fermerSuperpositions(page);
  R(await attendreTexte(page, 'Changer le mot de passe', 30000), 'carte : Â« Changer le mot de passe Â» une fois le mdp defini');
  await cliquerBouton(page, 'Changer le mot de passe');
  R(!!(await page.waitForSelector('input[autocomplete=current-password]', { timeout: 10000 }).catch(() => null)), 'formulaire de changement : champ Â« mot de passe actuel Â» present');
  await capturerCarte(page, `${OUT}/qa-mdp-7-profil-changer.png`);

  // 7. Vrai lien de reinitialisation, ouvert en etant connecte -> succes -> /auth
  const raw = crypto.randomBytes(32).toString('hex');
  const u7 = (await admin.auth.admin.getUserById(id)).data.user;
  await admin.auth.admin.updateUserById(id, { user_metadata: { ...u7.user_metadata, password_reset_token_hash: sha(raw), password_reset_expires: new Date(Date.now() + 3600000).toISOString() } });
  await page.goto(`${BASE}/reset-password?token=${raw}&email=${encodeURIComponent(email)}`, { waitUntil: 'networkidle2', timeout: 45000 });
  const c7 = await page.$$('input[autocomplete=new-password]');
  await c7[0].type('Xx-Reset-Ui-1357!'); await c7[1].type('Xx-Reset-Ui-1357!');
  await page.click('button[type=submit]');
  R(await attendreChemin(page, () => location.pathname === '/auth', 20000), 'vrai lien -> succes -> /auth');
  R(await attendreTexte(page, 'mot de passe a Ã©tÃ© mis Ã  jour'), 'message de succes apres reinitialisation');
  const { error: loginErr } = await anon.auth.signInWithPassword({ email, password: 'Xx-Reset-Ui-1357!' });
  R(!loginErr, 'nouveau mot de passe accepte a la connexion');
  await page.screenshot({ path: `${OUT}/qa-mdp-8-reset-succes.png`, fullPage: true });

  const graves = erreurs.filter((e) => !/favicon/i.test(e) && !/localStorage.*Access/i.test(e));
  R(graves.length === 0, 'aucune erreur JS grave dans la page', graves.slice(0, 3).join(' | '));
} finally {
  await nav.close();
  await admin.from('memberships').delete().eq('user_id', id);
  await admin.auth.admin.deleteUser(id);
  console.log('compte de test et membership supprimes');
}
console.log(ok ? '\nTOUT PASSE' : '\nDES ECHECS');
process.exit(ok ? 0 : 1);
