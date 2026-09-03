#!/usr/bin/env node
/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   VÃ‰RIFICATION â€” inscription classique courriel + mot de passe (API, staging)

   /register : mot de passe faible refusÃ©, compte crÃ©Ã© non confirmÃ©, connexion
   refusÃ©e avant confirmation, rÃ©-inscription = nouveau jeton, lien de
   vÃ©rification (faux, bon, rejouÃ©), connexion aprÃ¨s confirmation, identitÃ©
   = [email] seule, courriel dÃ©jÃ  confirmÃ© â†’ rÃ©ponse identique et mot de passe
   inchangÃ©. /register-checkout : compte confirmÃ© d'office, connexion immÃ©diate,
   courriel existant â†’ existing:true.

   PrÃ©requis : serveur API local (3002) branchÃ© sur STAGING. Sans SMTP local,
   verification_email_sent vaut false : le jeton est lu dans les mÃ©tadonnÃ©es.
   Usage : node --env-file=.env.local scripts/qa/verifier-inscription.mjs
   â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const ref = process.env.SUPABASE_PROJECT_REF;
if (!url.includes(ref)) throw new Error('VITE_SUPABASE_URL ne pointe pas sur staging - abandon');
const API = (process.env.QA_API_URL || 'http://localhost:3002').replace(/\/$/, '') + '/api';
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const post = async (path, body) => {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
};
let ok = true;
const check = (label, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${detail ? ' -- ' + detail : ''}`); if (!cond) ok = false; };
const login = async (email, password) => { const { error } = await anon().auth.signInWithPassword({ email, password }); return error ? `REFUS (${error.message})` : 'OK'; };
const findId = async (email) => { const { data } = await admin.rpc('get_user_id_by_email', { p_email: email }); return typeof data === 'string' ? data : data?.id || data?.user_id || null; };

const email = `qa-signup-${Date.now()}@example.test`;
const MDP = 'Xx-Signup-Mdp-1234!';
let id = null, id2 = null;
try {
  // 1. inscription classique (/register)
  const weak = await post('/auth/register', { email, password: 'faible', fullName: 'QA Signup' });
  check('register mdp faible -> 400 avec message', weak.status === 400 && !!weak.error, JSON.stringify(weak));
  const reg = await post('/auth/register', { email, password: MDP, fullName: 'QA Signup' });
  check('register -> 200 ok', reg.status === 200 && reg.ok === true, JSON.stringify(reg));
  console.log('   verification_email_sent =', reg.verification_email_sent, '(SMTP local non configure attendu â†’ false)');
  id = await findId(email);
  check('compte cree (non confirme)', !!id);
  let u = (await admin.auth.admin.getUserById(id)).data.user;
  check('email_confirmed_at vide + jeton de verification en metadata', !u.email_confirmed_at && /^[a-f0-9]{64}$/.test(u.user_metadata.verification_token || ''));
  check('login AVANT confirmation -> refuse (Supabase exige la confirmation)', (await login(email, MDP)).startsWith('REFUS'), await login(email, MDP));
  // 2. re-inscription du meme courriel non confirme -> renvoie un nouveau jeton, reponse identique
  const reg2 = await post('/auth/register', { email, password: MDP, fullName: 'QA Signup' });
  const u2 = (await admin.auth.admin.getUserById(id)).data.user;
  check('re-register non confirme -> 200 ok + nouveau jeton', reg2.status === 200 && u2.user_metadata.verification_token !== u.user_metadata.verification_token);
  // 3. clic sur le lien (jeton faux, puis bon)
  const bad = await post('/auth/verify-email', { email, token: 'f'.repeat(64) });
  check('verify-email jeton faux -> 400', bad.status === 400, JSON.stringify(bad));
  const good = await post('/auth/verify-email', { email, token: u2.user_metadata.verification_token });
  check('verify-email jeton bon -> 200', good.status === 200 && good.ok === true, JSON.stringify(good));
  u = (await admin.auth.admin.getUserById(id)).data.user;
  check('compte confirme + billing_email_verified + jeton efface', !!u.email_confirmed_at && u.user_metadata.billing_email_verified === true && !u.user_metadata.verification_token);
  check('login APRES confirmation -> OK', (await login(email, MDP)) === 'OK');
  check('identites = [email] (compte classique, sans Google)', (u.identities || []).map((i) => i.provider).join(',') === 'email');
  const again = await post('/auth/verify-email', { email, token: u2.user_metadata.verification_token });
  check('rejouer le lien -> 400', again.status === 400);
  // 4. inscription avec un courriel deja confirme -> reponse identique (courriel Â« compte existant Â» cote serveur)
  const dup = await post('/auth/register', { email, password: 'Xx-Autre-Mdp-5678!', fullName: 'QA Doublon' });
  check('register courriel deja confirme -> 200 ok, mot de passe INCHANGE', dup.status === 200 && dup.ok === true && (await login(email, MDP)) === 'OK' && (await login(email, 'Xx-Autre-Mdp-5678!')).startsWith('REFUS'));

  // 5. parcours /checkout (register-checkout) : compte confirme d'office, connexion immediate
  const email2 = `qa-checkout-${Date.now()}@example.test`;
  const rc = await post('/auth/register-checkout', { email: email2, password: MDP, fullName: 'QA Checkout' });
  check('register-checkout -> 200 + email_verified=false', rc.status === 200 && rc.ok === true && rc.email_verified === false, JSON.stringify(rc));
  id2 = await findId(email2);
  check('login immediat apres register-checkout -> OK', (await login(email2, MDP)) === 'OK');
  const rc2 = await post('/auth/register-checkout', { email: email2, password: 'Xx-Autre-Mdp-5678!', fullName: 'QA Checkout' });
  check('register-checkout courriel existant -> existing:true', rc2.status === 200 && rc2.existing === true, JSON.stringify(rc2));
} finally {
  if (id) await admin.auth.admin.deleteUser(id);
  if (id2) await admin.auth.admin.deleteUser(id2);
  console.log('comptes de test supprimes');
}
console.log(ok ? '\nTOUT PASSE' : '\nDES ECHECS');
process.exit(ok ? 0 : 1);
