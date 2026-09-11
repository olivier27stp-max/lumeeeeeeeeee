// Essai réel des raccourcis contre l'API locale (staging) : node --env-file=.env.local scripts/qa/raccourcis-live.mjs
import { createClient } from '@supabase/supabase-js';
const API = process.env.QA_API_URL || 'http://localhost:3019';
const url = process.env.VITE_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = () => createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const email = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
if (error) throw error;
const { data: s, error: e2 } = await anon().auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
if (e2) throw e2;
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', s.user.id).eq('status', 'active').limit(1).maybeSingle();
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session.access_token}`, 'x-org-id': m.org_id };
const questions = ['Combien de clients j’ai ?', 'Qu’est-ce que j’ai demain ?', 'cb jai de job dmain pis c ou', 'Combien j’ai encaissé ce mois-ci ?', 'Qui me doit de l’argent ?', 'mon briefing', 'Combien de clients à Saint-Bruno ?'];
for (const q of questions) {
  const t0 = Date.now();
  const r = await fetch(`${API}/api/lumi/chat`, { method: 'POST', headers: H, body: JSON.stringify({ message: q, language: 'fr' }) });
  const brut = await r.text();
  const evts = [...brut.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map((x) => [x[1], JSON.parse(x[2])]);
  const done = evts.find((e) => e[0] === 'done')?.[1];
  const texte = evts.filter((e) => e[0] === 'text').map((e) => e[1].delta).join('');
  const fiches = evts.find((e) => e[0] === 'fiches')?.[1]?.fiches?.length ?? 0;
  console.log(`\n▶ ${q}  [${r.status}, ${Date.now() - t0} ms, ${done?.raccourci ? 'RACCOURCI ' + done.raccourci : 'modèle'}, ${done?.cost_cents ?? '?'} ¢, ${fiches} fiches]\n${texte.slice(0, 400)}`);
}
