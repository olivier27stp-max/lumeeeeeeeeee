// Jetable : latence de staging (auth + REST) — lecture seule.
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
for (let i = 0; i < 5; i++) {
  let t = Date.now();
  const r = await admin.from('orgs').select('id').limit(1);
  const rest = Date.now() - t;
  t = Date.now();
  const h = await fetch(process.env.VITE_SUPABASE_URL + '/auth/v1/health', { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY } }).then((x) => x.status).catch((e) => String(e));
  const auth = Date.now() - t;
  t = Date.now();
  const api = await fetch('http://127.0.0.1:5183/api/health', { signal: AbortSignal.timeout(30000) }).then((x) => x.json()).then((j) => j.db_ms).catch((e) => String(e));
  console.log(new Date().toISOString().slice(11, 19), 'REST', rest, 'ms', r.error?.message ?? 'ok', '| auth', auth, 'ms', h, '| api db_ms', api, 'en', Date.now() - t, 'ms');
  await new Promise((r) => setTimeout(r, 2000));
}
