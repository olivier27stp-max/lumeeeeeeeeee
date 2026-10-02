import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const u = process.env.VITE_SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY, a = process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
const m = JSON.parse(readFileSync('D:/lume-uiaudit/sorties/e2e-liste/bureau-liste.json', 'utf8'));
const t = async (f) => { const d = Date.now(); const r = await f(); return [Date.now() - d, r.error?.message ?? (r.count ?? r.data?.length)]; };
const l = await admin.auth.admin.generateLink({ type: 'magiclink', email: m.comptes.proprioA.email });
const pub = createClient(u, a, { auth: { persistSession: false, autoRefreshToken: false } });
const s = await pub.auth.verifyOtp({ token_hash: l.data.properties.hashed_token, type: 'magiclink' });
const cli = createClient(u, a, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${s.data.session.access_token}` } } });
console.log('taille automation_rules', (await admin.from('automation_rules').select('id', { count: 'estimated', head: true })).count);
console.log('taille automation_execution_logs', (await admin.from('automation_execution_logs').select('id', { count: 'estimated', head: true })).count);
console.log('taille automation_scheduled_tasks', (await admin.from('automation_scheduled_tasks').select('id', { count: 'estimated', head: true })).count);
const depuis = new Date(Date.now() - 7 * 86400_000).toISOString();
for (let i = 0; i < 3; i++) {
  console.log('règles  service', await t(() => admin.from('automation_rules').select('*').eq('org_id', m.orgA).is('purged_at', null).order('name')),
    '| RLS', await t(() => cli.from('automation_rules').select('*').eq('org_id', m.orgA).is('purged_at', null).order('name')));
  console.log('échecs  service', await t(() => admin.from('automation_execution_logs').select('id, automation_rule_id').eq('org_id', m.orgA).eq('result_success', false).gte('created_at', depuis).order('created_at', { ascending: false }).limit(200)),
    '| RLS', await t(() => cli.from('automation_execution_logs').select('id, automation_rule_id').eq('org_id', m.orgA).eq('result_success', false).gte('created_at', depuis).order('created_at', { ascending: false }).limit(200)));
}
