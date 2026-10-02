// Liste (et, avec --retirer, retire) les brouillons « Nouvelle automatisation » laissés par mes scripts dans le bureau de test prod.
import { admin, ORG } from '../nav-prod.mjs';
const { data } = await admin.from('automation_rules').select('id, name, created_at, is_active, deleted_at').eq('org_id', ORG)
  .or('name.ilike.Nouvelle automatisation%,name.ilike.%[QA-UI%').order('created_at', { ascending: false });
for (const r of data ?? []) console.log(r.created_at, r.is_active ? 'PUBLIÉE' : 'brouillon', r.deleted_at ? 'corbeille' : '', r.name, r.id);
if (process.argv.includes('--retirer')) {
  const ids = (data ?? []).filter((r) => !r.is_active).map((r) => r.id);
  if (ids.length) {
    await admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids).eq('org_id', ORG);
    const { error } = await admin.from('automation_rules').delete().in('id', ids).eq('org_id', ORG);
    console.log(error ? `échec : ${error.message}` : `${ids.length} brouillon(s) de test retiré(s)`);
  }
}
console.log('total :', (data ?? []).length);
