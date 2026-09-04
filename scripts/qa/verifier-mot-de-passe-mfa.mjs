#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   VÉRIFICATION — changement de mot de passe et double authentification (API, staging)

   Un jeton de session AAL1 (mot de passe seul) ne doit PAS suffire à changer
   le mot de passe d'un compte dont la double authentification est active :
   un jeton volé rejoué directement contre /api/auth/set-password doit être
   refusé (403 mfa_required). Le jeton AAL2 (code TOTP vérifié) est accepté.
   Sans MFA, le comportement normal est conservé.

   Enrôle réellement un facteur TOTP sur un compte de test staging (code
   calculé ici, HMAC-SHA1 / 30 s / 6 chiffres), puis supprime le compte.

   Prérequis : serveur API local branché sur STAGING. Refuse de tourner si
   VITE_SUPABASE_URL ne pointe pas sur SUPABASE_PROJECT_REF.
   Variables : QA_API_URL (défaut http://localhost:3002).
   Usage : node --env-file=.env.local scripts/qa/verifier-mot-de-passe-mfa.mjs
   ═══════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import base32 from 'hi-base32';

const url = process.env.VITE_SUPABASE_URL;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!url.includes(ref)) throw new Error('VITE_SUPABASE_URL ne pointe pas sur staging - abandon');
const API = (process.env.QA_API_URL || 'http://localhost:3002').replace(/\/$/, '') + '/api';
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const post = async (path, body, bearer) => {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};
const totp = (secretB32, t = Date.now()) => {
  const key = Buffer.from(base32.decode.asBytes(secretB32.replace(/=+$/, '').toUpperCase()));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / 30)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
};
const aalOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()).aal;
let ok = true;
const check = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ' -- ' + detail : ''}`); if (!cond) ok = false; };

const email = `qa-mfa-${Date.now()}@example.test`;
const MDP = 'Xx-Mfa-Mdp-1234!';
const { data: created, error: e1 } = await admin.auth.admin.createUser({ email, password: MDP, email_confirm: true });
if (e1) throw e1;
const id = created.user.id;
try {
  const { data: s1, error: le } = await anon().auth.signInWithPassword({ email, password: MDP });
  if (le) throw le;
  const jwt1 = s1.session.access_token;
  check('session par mot de passe = aal1', aalOf(jwt1) === 'aal1', aalOf(jwt1));

  // Sans MFA : jeton aal1 accepté (comportement normal)
  const avant = await post('/auth/set-password', { currentPassword: MDP, newPassword: 'Xx-Mfa-Mdp-5678!' }, jwt1);
  check('sans MFA : set-password avec aal1 -> 200', avant.status === 200, JSON.stringify(avant));
  // Les sessions sont révoquées : on se reconnecte
  const { data: s2 } = await anon().auth.signInWithPassword({ email, password: 'Xx-Mfa-Mdp-5678!' });
  const c2 = anon();
  await c2.auth.setSession({ access_token: s2.session.access_token, refresh_token: s2.session.refresh_token });
  const jwtAal1 = s2.session.access_token;

  // Enrôlement TOTP + vérification -> session aal2
  const { data: enr, error: ee } = await c2.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'QA' });
  if (ee) throw ee;
  const { data: ch, error: ce } = await c2.auth.mfa.challenge({ factorId: enr.id });
  if (ce) throw ce;
  const { data: v, error: ve } = await c2.auth.mfa.verify({ factorId: enr.id, challengeId: ch.id, code: totp(enr.totp.secret) });
  if (ve) throw ve;
  const jwtAal2 = v.access_token;
  check('après vérification TOTP : jeton aal2', aalOf(jwtAal2) === 'aal2', aalOf(jwtAal2));
  const { data: lf } = await admin.auth.admin.mfa.listFactors({ userId: id });
  check('facteur TOTP vérifié visible côté admin', (lf?.factors || []).some((f) => f.status === 'verified'));

  const refuse = await post('/auth/set-password', { currentPassword: 'Xx-Mfa-Mdp-5678!', newPassword: 'Xx-Mfa-Mdp-9999!' }, jwtAal1);
  check('MFA active : set-password avec jeton aal1 -> 403 mfa_required', refuse.status === 403 && refuse.code === 'mfa_required', JSON.stringify(refuse));
  const accepte = await post('/auth/set-password', { currentPassword: 'Xx-Mfa-Mdp-5678!', newPassword: 'Xx-Mfa-Mdp-9999!' }, jwtAal2);
  check('MFA active : set-password avec jeton aal2 -> 200', accepte.status === 200, JSON.stringify(accepte));
  const { error: fin } = await anon().auth.signInWithPassword({ email, password: 'Xx-Mfa-Mdp-9999!' });
  check('nouveau mot de passe accepté', !fin);
} finally {
  await admin.auth.admin.deleteUser(id);
  console.log('compte de test supprimé');
}
console.log(ok ? '\nTOUT PASSE' : '\nDES ECHECS');
process.exit(ok ? 0 : 1);
