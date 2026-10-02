// Jetable : état du bureau de test « declencheurs » (lecture seule).
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const url = process.env.VITE_SUPABASE_URL;
if (!url || url.includes('bbzcuzqfgsdvjsymfwmr')) throw new Error('STAGING seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: orgs } = await admin.from('orgs').select('id,name').ilike('name', '%(declencheurs)%');
console.log(orgs);
const orgA = orgs.find((o) => o.name.includes('Automatisations A')).id;
for (const [t, sel] of [
  ['org_features', 'feature,enabled,metadata'],
  ['custom_fields', 'id,object_type,key,label,field_type,archived_at,config'],
  ['pipelines_ventes', '*'],
  ['pipeline_stages', '*'],
  ['client_tags', '*'],
  ['predefined_services', 'id,name,is_active'],
  ['memberships', 'user_id,role,status,full_name'],
  ['clients', 'id,first_name,last_name'],
  ['automation_rules', 'id,name,trigger_event,is_preset,is_active,deleted_at'],
]) {
  const { data, error } = await admin.from(t).select(sel).eq('org_id', orgA).limit(60);
  console.log('\n##', t, error?.message ?? `${data.length} ligne(s)`);
  for (const l of (data ?? []).slice(0, 40)) console.log(JSON.stringify(l));
}
