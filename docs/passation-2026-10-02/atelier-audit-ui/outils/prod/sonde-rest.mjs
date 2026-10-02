// Sonde : l'API REST de Supabase (prod) répond-elle à une lecture simple ? Lecture seule.
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const admin = createClient(process.env.SUPABASE_URL_PROD, process.env.SUPABASE_SERVICE_ROLE_KEY_PROD, { auth: { persistSession: false } });
const t = Date.now();
const { data, error, status } = await admin.from('orgs').select('name').eq('id', '0df93da0-dc34-481c-be91-bab69a4989b0').single();
console.log('statut', status, 'en', Date.now() - t, 'ms ·', error ? `erreur : ${error.message} (${error.code ?? ''})` : `nom : ${data?.name}`);
