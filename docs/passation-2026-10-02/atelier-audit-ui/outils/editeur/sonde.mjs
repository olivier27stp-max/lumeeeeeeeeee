// Sonde : latence de staging (REST + auth) et de l'API locale. Lecture seule.
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const mesurer = async (nom, f) => { const t = Date.now(); let r = 'ok'; try { const x = await f(); if (x?.error) r = 'ERR ' + x.error.message; } catch (e) { r = 'EXC ' + e.message; } console.log(nom.padEnd(22), String(Date.now() - t).padStart(6), 'ms', r); };
for (let i = 0; i < 3; i++) {
  await mesurer('rest automation_rules', () => admin.from('automation_rules').select('id').limit(1));
  await mesurer('rest memberships', () => admin.from('memberships').select('user_id').limit(1));
  await mesurer('auth settings', () => fetch(process.env.VITE_SUPABASE_URL + '/auth/v1/settings', { headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY } }));
  await mesurer('api health', () => fetch('http://127.0.0.1:3112/api/health'));
}
