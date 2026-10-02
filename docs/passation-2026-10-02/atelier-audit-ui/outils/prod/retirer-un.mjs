// Retire UNE règle de test par identifiant, dans le bureau de test prod seulement, et seulement si c'est un brouillon.
import { admin, ORG } from '../nav-prod.mjs';
const id = process.argv[2];
if (!/^[0-9a-f-]{36}$/.test(id ?? '')) throw new Error('identifiant attendu');
const { data: r } = await admin.from('automation_rules').select('id, name, is_active').eq('org_id', ORG).eq('id', id).maybeSingle();
if (!r) { console.log('introuvable dans le bureau de test'); process.exit(0); }
if (r.is_active) throw new Error('REFUS : règle publiée');
await admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', id).eq('org_id', ORG);
const { error } = await admin.from('automation_rules').delete().eq('id', id).eq('org_id', ORG);
console.log(error ? `échec : ${error.message}` : `retirée : ${r.name}`);
