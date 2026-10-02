// Sonde de latence de la base staging (lecture + une écriture sur une règle du bureau « actions »).
import { createRequire } from 'node:module';
const require = createRequire('D:/lume-uiaudit/wt/package.json');
const { createClient } = require('@supabase/supabase-js');
const url = process.env.VITE_SUPABASE_URL; if (!url || url.includes('bbzcuzqfgsdvjsymfwmr')) throw new Error('staging seulement');
const a = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: org } = await a.from('orgs').select('id').eq('name', '[TEST] QA Automatisations A (actions) — ne pas utiliser').single();
for (let i = 0; i < 4; i++) {
  let t = Date.now();
  const { data, error } = await a.from('automation_rules').select('id, name').eq('org_id', org.id).eq('name', 'QA actions — cible à démarrer (ne pas supprimer)').maybeSingle();
  const lecture = Date.now() - t;
  t = Date.now();
  const maj = await a.from('automation_rules').update({ updated_at: new Date().toISOString() }).eq('id', data.id).select('id');
  console.log(`lecture ${lecture} ms${error ? ' ERR ' + error.message : ''} · écriture ${Date.now() - t} ms${maj.error ? ' ERR ' + maj.error.message : ''}`);
}
