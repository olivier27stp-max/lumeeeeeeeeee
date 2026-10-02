// Jetable : retire du bureau de test « declencheurs » les règles laissées par mes essais (hors préréglages).
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const url = process.env.VITE_SUPABASE_URL;
if (!url || url.includes('bbzcuzqfgsdvjsymfwmr')) throw new Error('STAGING seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ORGS = ['085a9403-afb6-4f9c-98f6-afa9a5e3d9bd', '98ae9daa-da2f-43b5-bae7-dedf27037bda'];
const { data } = await admin.from('automation_rules').select('id, org_id, name, trigger_event, is_preset').in('org_id', ORGS).eq('is_preset', false);
console.log((data ?? []).map((r) => `${r.name} (${r.trigger_event})`));
const ids = (data ?? []).filter((r) => /^\[E2E |^Nouvelle automatisation$|^New automation$/.test(r.name)).map((r) => r.id);
if (process.argv.includes('--supprimer') && ids.length) {
  await admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids);
  await admin.from('automation_execution_logs').delete().in('automation_rule_id', ids);
  const { error } = await admin.from('automation_rules').delete().in('id', ids).in('org_id', ORGS);
  console.log('supprimées :', ids.length, error?.message ?? 'ok');
}
