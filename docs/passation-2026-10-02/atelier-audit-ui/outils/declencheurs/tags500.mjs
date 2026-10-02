import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
import { session } from '../nav.mjs';
const s = await session('qa-auto-proprio-a+declencheurs@lume-qa.test');
const c = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.access_token}` } } });
for (let i = 0; i < 6; i++) {
  const t = Date.now();
  const { data, error, status } = await c.from('client_tags').select('tag').limit(500);
  console.log(i, status, Date.now() - t, 'ms', error ? JSON.stringify(error) : `${data.length} lignes : ${[...new Set(data.map((x) => x.tag))].join(' | ')}`);
}
