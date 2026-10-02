import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const m = JSON.parse(readFileSync('D:/lume-uiaudit/sorties/e2e-liste/bureau-liste.json', 'utf8'));
for (const [c, v] of Object.entries(m.comptes)) {
  const { data, error } = await admin.auth.admin.getUserById(v.id);
  console.log(c, v.email, JSON.stringify(data?.user?.user_metadata), error?.message ?? '');
}
const { data: ms } = await admin.from('memberships').select('user_id, org_id, role, language, permissions').in('org_id', [m.orgA, m.orgB]);
console.log(JSON.stringify(ms));
