import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const u = process.env.VITE_SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY, a = process.env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(u, k, { auth: { persistSession: false, autoRefreshToken: false } });
const t = async (nom, f) => { const d = Date.now(); let r; try { r = await f(); } catch (e) { r = { error: e }; } console.log(nom.padEnd(28), String(Date.now() - d).padStart(6), 'ms', r?.error ? 'ERREUR ' + (r.error.message ?? r.error) : ''); return r; };
const email = 'qa-auto-proprio-a+liste@lume-qa.test';
const l = await t('generateLink', () => admin.auth.admin.generateLink({ type: 'magiclink', email }));
const pub = createClient(u, a, { auth: { persistSession: false, autoRefreshToken: false } });
const s = await t('verifyOtp', () => pub.auth.verifyOtp({ token_hash: l.data.properties.hashed_token, type: 'magiclink' }));
const jeton = s.data.session.access_token;
await t('auth getUser', () => pub.auth.getUser(jeton));
await t('rest rules (service)', () => admin.from('automation_rules').select('id').limit(5));
const cli = createClient(u, a, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${jeton}` } } });
await t('rest rules (RLS)', () => cli.from('automation_rules').select('*').is('purged_at', null).order('name'));
await t('rest memberships (RLS)', () => cli.from('memberships').select('org_id', { count: 'exact', head: true }));
await t('rest logs (RLS)', () => cli.from('automation_execution_logs').select('id').eq('result_success', false).limit(200));
const org = (await admin.from('memberships').select('org_id').eq('user_id', s.data.user.id).limit(1)).data[0].org_id;
const h = { Authorization: `Bearer ${jeton}`, 'x-org-id': org };
for (const ch of ['/api/health', '/api/automations/pause', '/api/automations/rules/stats', '/api/automations/folders', '/api/automations/bureaux-cibles', '/api/billing/current', '/api/billing/plans']) {
  await t('api ' + ch, async () => { const r = await fetch('http://127.0.0.1:3112' + ch, { headers: h }); await r.text(); return r.ok ? {} : { error: { message: r.status } }; });
}
