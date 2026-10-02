// Bureaux de test de l'audit UI sur STAGING : liste (défaut) ou retrait (--retirer = deleted_at, rien n'est effacé).
// Seuls les jeux créés par cette mission (suffixes ci-dessous) sont visés ; les bureaux permanents (sans suffixe)
// et ceux des autres sessions ne sont jamais touchés.
const ref = process.env.SUPABASE_PROJECT_REF;
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !jeton) throw new Error('SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN manquants');
if (ref === 'bbzcuzqfgsdvjsymfwmr') throw new Error('REFUS : staging seulement');
const SUFFIXES = ['liste', 'modeles', 'editeur', 'declencheurs', 'actions', 'roles', 'uiaudit', 'uiaudit1'];
const noms = SUFFIXES.flatMap((s) => ['A', 'B'].map((l) => `[TEST] QA Automatisations ${l} (${s}) — ne pas utiliser`));
const liste = noms.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} : ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const avant = await sql(`select o.id, o.name, o.deleted_at is not null as retire,
  (select count(*)::int from automation_rules r where r.org_id = o.id and r.is_active and r.deleted_at is null) as publiees,
  (select count(*)::int from orgs_envois_simules b where b.org_id = o.id) as bac
  from orgs o where o.name in (${liste}) order by o.name`);
for (const o of avant) console.log(`${o.retire ? 'retiré ' : 'actif  '} ${o.name} · ${o.publiees} règles publiées · bac à sable ${o.bac ? 'oui' : 'NON'}`);
console.log(`${avant.length} bureaux trouvés, ${avant.filter((o) => !o.retire).length} encore actifs`);
if (process.argv.includes('--retirer')) {
  // Les règles d'abord (plus rien ne peut se déclencher), puis le bureau. Le bac à sable reste en place.
  const r = await sql(`
    update automation_rules set is_active = false where is_active and org_id in (select id from orgs where name in (${liste}));
    update orgs set deleted_at = now() where deleted_at is null and name in (${liste}) returning name;`);
  console.log(`retirés : ${Array.isArray(r) ? r.length : 0}`);
  const apres = await sql(`select count(*)::int as actifs from orgs where deleted_at is null and name in (${liste})`);
  console.log(`encore actifs après : ${apres[0].actifs}`);
}
