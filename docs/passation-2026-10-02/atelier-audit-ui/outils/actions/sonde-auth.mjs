// Sonde : combien de temps prend GET /auth/v1/user sur staging (compte de test du lot « actions ») ?
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const url = process.env.VITE_SUPABASE_URL; if (!url || url.includes('bbzcuzqfgsdvjsymfwmr')) throw new Error('staging seulement');
const anon = process.env.VITE_SUPABASE_ANON_KEY;
const a = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: l } = await a.auth.admin.generateLink({ type: 'magiclink', email: 'qa-auto-proprio-a+actions@lume-qa.test' });
const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: s } = await pub.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
for (let i = 0; i < 6; i++) {
  const t = Date.now();
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${s.session.access_token}` } });
  console.log(`auth/v1/user ${r.status} ${Date.now() - t} ms`);
}
