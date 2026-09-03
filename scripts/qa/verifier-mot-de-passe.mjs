#!/usr/bin/env node
/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VÃ‰RIFICATION â€” parcours mot de passe (API, staging)

   Compte Google simulÃ© (identitÃ© google, aucun mot de passe) â†’ lien
   Â« mot de passe oubliÃ© Â», rÃ©initialisation par jeton (faux, faible,
   bon, rejouÃ©, expirÃ©), dÃ©finition / changement en session, connexion
   par courriel + mot de passe, inscription avec un courriel dÃ©jÃ  pris.
   Documente aussi un comportement Supabase : poser le mot de passe par
   l'API admin rÃ©voque TOUTES les sessions du compte.

   PrÃ©requis : serveur API local (3002) branchÃ© sur STAGING. Refuse de
   tourner si VITE_SUPABASE_URL ne pointe pas sur SUPABASE_PROJECT_REF.
   Usage : node --env-file=.env.local scripts/qa/verifier-mot-de-passe.mjs
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const url = process.env.VITE_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!url.includes(ref)) throw new Error('VITE_SUPABASE_URL ne pointe pas sur staging - abandon');
const API = (process.env.QA_API_URL || 'http://localhost:3002').replace(/\/$/, '') + '/api';

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = async (q) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
};
const post = async (path, body, bearer) => {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const anonClient = () => createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const login = async (email, password) => {
  const { error } = await anonClient().auth.signInWithPassword({ email, password });
  return error ? `REFUS (${error.message})` : 'OK';
};
let ok = true;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ' -- ' + detail : ''}`);
  if (!cond) ok = false;
};
const simulerGoogle = async (id, email, sub) => sql(
  `delete from auth.identities where user_id='${id}';
   insert into auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
   values (gen_random_uuid(), '${sub}', '${id}', '{"sub":"${sub}","email":"${email}","email_verified":true}', 'google', now(), now(), now());
   update auth.users set encrypted_password = null where id='${id}';`,
);

const email = `qa-google-only-${Date.now()}@example.test`;
const { data: created, error: e1 } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: 'QA Google' } });
if (e1) throw e1;
const id = created.user.id;
await simulerGoogle(id, email, `g-${Date.now()}`);
console.log('compte Google simule:', email);
let id2 = null;
try {
  // 1. forgot-password ecrit un jeton hache + expiration
  const f = await post('/auth/forgot-password', { email });
  const u1 = (await admin.auth.admin.getUserById(id)).data.user;
  check('forgot-password -> 200 ok', f.status === 200 && f.ok === true, JSON.stringify(f));
  check('jeton hache stocke (64 hex) + expiration future',
    /^[a-f0-9]{64}$/.test(u1.user_metadata.password_reset_token_hash || '') && new Date(u1.user_metadata.password_reset_expires) > new Date());

  // 2. reset-password : jeton faux, mdp faible, jeton bon
  const raw = crypto.randomBytes(32).toString('hex');
  await admin.auth.admin.updateUserById(id, { user_metadata: { ...u1.user_metadata, password_reset_token_hash: sha(raw) } });
  const bad = await post('/auth/reset-password', { email, token: 'f'.repeat(64), password: 'Xx-Test-Mdp-1234!' });
  check('reset-password jeton faux -> invalid_link', bad.status === 400 && bad.code === 'invalid_link', JSON.stringify(bad));
  const weak = await post('/auth/reset-password', { email, token: raw, password: 'abc' });
  check('reset-password mdp faible -> weak_password', weak.status === 400 && weak.code === 'weak_password', JSON.stringify(weak));
  check('login avant reset -> refuse', (await login(email, 'Xx-Test-Mdp-1234!')).startsWith('REFUS'));
  const good = await post('/auth/reset-password', { email, token: raw, password: 'Xx-Test-Mdp-1234!' });
  check('reset-password jeton bon -> 200', good.status === 200 && good.ok === true, JSON.stringify(good));
  check('login apres reset -> OK', (await login(email, 'Xx-Test-Mdp-1234!')) === 'OK');
  const u2 = (await admin.auth.admin.getUserById(id)).data.user;
  check('jeton efface + app_metadata.has_password=true',
    !u2.user_metadata.password_reset_token_hash && u2.app_metadata.has_password === true,
    JSON.stringify({ meta: u2.user_metadata.password_reset_token_hash, app: u2.app_metadata }));
  const replay = await post('/auth/reset-password', { email, token: raw, password: 'Xx-Autre-Mdp-5678!' });
  check('rejouer le meme jeton -> invalid_link', replay.status === 400 && replay.code === 'invalid_link');

  // 3. jeton expire
  const raw2 = crypto.randomBytes(32).toString('hex');
  await admin.auth.admin.updateUserById(id, { user_metadata: { password_reset_token_hash: sha(raw2), password_reset_expires: new Date(Date.now() - 60000).toISOString() } });
  const exp = await post('/auth/reset-password', { email, token: raw2, password: 'Xx-Autre-Mdp-5678!' });
  check('jeton expire -> expired_link', exp.status === 400 && exp.code === 'expired_link', JSON.stringify(exp));

  // 4. set-password en session (compte AVEC mot de passe maintenant)
  const { data: sess } = await anonClient().auth.signInWithPassword({ email, password: 'Xx-Test-Mdp-1234!' });
  const jwt = sess.session.access_token;
  const noCur = await post('/auth/set-password', { newPassword: 'Xx-Nouveau-Mdp-9999!' }, jwt);
  check('set-password sans mdp actuel -> current_required', noCur.status === 400 && noCur.code === 'current_required', JSON.stringify(noCur));
  const wrong = await post('/auth/set-password', { currentPassword: 'mauvais', newPassword: 'Xx-Nouveau-Mdp-9999!' }, jwt);
  check('set-password mauvais mdp actuel -> wrong_current', wrong.status === 400 && wrong.code === 'wrong_current', JSON.stringify(wrong));
  const same = await post('/auth/set-password', { currentPassword: 'Xx-Test-Mdp-1234!', newPassword: 'Xx-Test-Mdp-1234!' }, jwt);
  check('set-password identique -> same_password', same.status === 400 && same.code === 'same_password');
  const chg = await post('/auth/set-password', { currentPassword: 'Xx-Test-Mdp-1234!', newPassword: 'Xx-Nouveau-Mdp-9999!' }, jwt);
  check('set-password bon -> 200', chg.status === 200 && chg.ok === true, JSON.stringify(chg));
  check('ancien mdp refuse, nouveau accepte',
    (await login(email, 'Xx-Test-Mdp-1234!')).startsWith('REFUS') && (await login(email, 'Xx-Nouveau-Mdp-9999!')) === 'OK');
  const sessions = await sql(`select count(*)::int as n from auth.sessions where user_id='${id}'`);
  console.log('   sessions ouvertes pour ce compte (sonde revoquee ?):', sessions[0].n);

  // 5. set-password sur un compte Google SANS mot de passe (pas de mdp actuel exige)
  const email2 = `qa-google-only-b-${Date.now()}@example.test`;
  const { data: c2 } = await admin.auth.admin.createUser({ email: email2, email_confirm: true });
  id2 = c2.user.id;
  await simulerGoogle(id2, email2, `g2-${Date.now()}`);
  // session Â« Google Â» simulee : lien magique admin -> JWT sans mot de passe
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: email2 });
  const { data: v, error: vErr } = await anonClient().auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (vErr) throw vErr;
  const jwt2 = v.session.access_token;
  const setNoCur = await post('/auth/set-password', { newPassword: 'Xx-Google-Mdp-2468!' }, jwt2);
  check('compte Google: set-password sans mdp actuel -> 200', setNoCur.status === 200 && setNoCur.ok === true, JSON.stringify(setNoCur));
  check('compte Google: login par mdp -> OK', (await login(email2, 'Xx-Google-Mdp-2468!')) === 'OK');
  // Comportement Supabase documente : l'API admin revoque TOUTES les sessions
  // du compte quand elle pose un mot de passe. Le front en tient compte.
  const { error: guErr } = await anonClient().auth.getUser(jwt2);
  check('sessions revoquees apres set-password (compte Google)', !!guErr, guErr ? `${guErr.status} ${guErr.message}` : 'session encore valide ?!');
  const { error: gu1Err } = await anonClient().auth.getUser(jwt);
  check('sessions revoquees apres set-password (compte avec mdp)', !!gu1Err, gu1Err ? `${gu1Err.status} ${gu1Err.message}` : 'session encore valide ?!');
  // Nouvelle session par mot de passe -> getUser() frais expose le drapeau + l'identite google
  const { data: relog } = await anonClient().auth.signInWithPassword({ email: email2, password: 'Xx-Google-Mdp-2468!' });
  const { data: gu } = await anonClient().auth.getUser(relog.session.access_token);
  check('getUser() frais expose has_password + identite google',
    gu.user.app_metadata.has_password === true && gu.user.identities.some((i) => i.provider === 'google'),
    JSON.stringify({ app: gu.user.app_metadata, ids: gu.user.identities.map((i) => i.provider) }));

  // 6. inscription avec un courriel deja confirme -> reponse identique (ok)
  const reg = await post('/auth/register', { email: email2, password: 'Xx-Encore-Mdp-1357!', fullName: 'QA Doublon' });
  check('register courriel existant -> 200 ok (aucune enumeration)', reg.status === 200 && reg.ok === true, JSON.stringify(reg));
} finally {
  await admin.auth.admin.deleteUser(id);
  if (id2) await admin.auth.admin.deleteUser(id2);
  console.log('comptes de test supprimes');
}
console.log(ok ? '\nTOUT PASSE' : '\nDES ECHECS');
process.exit(ok ? 0 : 1);
