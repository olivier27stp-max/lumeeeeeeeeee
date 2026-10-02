// Lecture seule : règles de test laissées dans le bureau de test de prod, et présence du déclencheur de garde.
import { createClient } from '@supabase/supabase-js';
const admin = createClient(process.env.SUPABASE_URL_PROD, process.env.SUPABASE_SERVICE_ROLE_KEY_PROD, { auth: { persistSession: false } });
const ORG = '0df93da0-dc34-481c-be91-bab69a4989b0';
const { data, error } = await admin.from('automation_rules').select('id, name, is_active, deleted_at').eq('org_id', ORG).or('name.ilike.[QA-UI%,name.ilike.[garde]%');
console.log(error ? `erreur : ${error.message}` : `règles de test restantes en prod : ${data.length}`, data?.map((r) => r.name).join(' | ') ?? '');
