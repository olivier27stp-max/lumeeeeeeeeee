// Lecture seule : où en est le jeu de bureaux « modeles » ?
import { admin } from '../nav.mjs';
const { data, error } = await admin.from('orgs').select('id,name,created_at,deleted_at').ilike('name', '%(modeles)%');
console.log(error?.message ?? '', JSON.stringify(data, null, 1));
for (const o of data ?? []) {
  const { count } = await admin.from('automation_rules').select('id', { count: 'exact', head: true }).eq('org_id', o.id);
  const { data: bac } = await admin.from('orgs_envois_simules').select('org_id,mode').eq('org_id', o.id);
  console.log(o.name, 'regles', count, 'bac', JSON.stringify(bac));
}
