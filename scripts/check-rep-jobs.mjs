// Diagnostic ponctuel (sans PII) : compte les jobs rattachables au rep connecté
// par salesperson_id / assigned_user_id / created_by, pour expliquer pourquoi
// le hub rep n'affiche rien. N'imprime que des comptes agrégés.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = readFileSync('/Users/olivierst-pierre/Downloads/lume-crm/.env.local', 'utf8');
const grab = (name) => env.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '');
const url = grab('VITE_SUPABASE_URL');
const key = grab('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(url, key);

// profiles n'a pas forcément de colonne email — passer par l'API auth admin
const { data: usersPage } = await db.auth.admin.listUsers({ perPage: 1000 });
const authUser = (usersPage?.users || []).find(u => u.email === 'olivier27stp@gmail.com');
if (!authUser) { console.log('user introuvable'); process.exit(0); }
const uid = authUser.id;
console.log('uid trouvé:', uid.slice(0, 8) + '…');

const cnt = async (col) => {
  const { count } = await db.from('jobs').select('id', { count: 'exact', head: true }).eq(col, uid).is('deleted_at', null);
  return count;
};
console.log('jobs salesperson_id =', await cnt('salesperson_id'));
console.log('jobs assigned_user_id =', await cnt('assigned_user_id'));
console.log('jobs created_by =', await cnt('created_by'));

const { count: cbNoSp } = await db.from('jobs').select('id', { count: 'exact', head: true })
  .eq('created_by', uid).is('salesperson_id', null).is('deleted_at', null);
console.log('jobs created_by + salesperson_id NULL =', cbNoSp);

// org du rep (team_members) vs orgs de ses jobs — comptes seulement
const { data: tm } = await db.from('team_members').select('org_id').eq('user_id', uid);
console.log('orgs team_members:', (tm || []).map(t => t.org_id.slice(0, 8) + '…'));
const { data: jobOrgs } = await db.from('jobs').select('org_id')
  .or(`salesperson_id.eq.${uid},assigned_user_id.eq.${uid},created_by.eq.${uid}`).is('deleted_at', null);
const counts = {};
for (const j of jobOrgs || []) counts[j.org_id.slice(0, 8) + '…'] = (counts[j.org_id.slice(0, 8) + '…'] || 0) + 1;
console.log('jobs par org:', counts);

const { data: mem } = await db.from('memberships').select('org_id').eq('user_id', uid);
console.log('orgs memberships:', (mem || []).map(m => m.org_id.slice(0, 8) + '…'));

// Simule la requête exacte du hub (même filtre OR + période) — comptes seulement
const orgFull = (jobOrgs || []).length ? await db.from('jobs').select('org_id').or(`salesperson_id.eq.${uid},assigned_user_id.eq.${uid},created_by.eq.${uid}`).is('deleted_at', null).limit(1).then(r => r.data?.[0]?.org_id) : null;
if (orgFull) {
  const credit = `salesperson_id.eq.${uid},assigned_user_id.eq.${uid},and(salesperson_id.is.null,created_by.eq.${uid})`;
  const year = await db.from('jobs').select('id', { count: 'exact', head: true })
    .eq('org_id', orgFull).or(credit).is('deleted_at', null)
    .gte('created_at', new Date('2026-01-01T00:00:00').toISOString())
    .lte('created_at', new Date('2026-12-31T23:59:59.999').toISOString());
  console.log('requête hub (filtre OR, année 2026):', year.count, year.error?.message || '');
  const { data: dates } = await db.from('jobs').select('created_at').eq('org_id', orgFull).or(credit).is('deleted_at', null);
  console.log('dates de création des jobs:', (dates || []).map(d => d.created_at.slice(0, 10)));
}
