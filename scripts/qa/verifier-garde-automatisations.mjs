/**
 * La garde en base de `automation_rules` tient-elle ? (audit du 2026-10-01, roles-05/06/07)
 *
 *   node --env-file=.env.local scripts/qa/verifier-garde-automatisations.mjs          → staging
 *   node --env-file=.env.local scripts/qa/verifier-garde-automatisations.mjs --prod   → prod
 *
 * Joue, AVEC LE RÔLE D'UNE SESSION D'UTILISATEUR (`authenticated`, jeton d'un membre qui a le droit de
 * modifier les automatisations), chaque écriture que le serveur n'autorise jamais — et quelques écritures
 * légitimes, qui doivent passer. Tout se fait sur DEUX règles de test créées pour l'occasion dans un
 * bureau de test ; chaque tentative est annulée aussitôt (sous-transaction), les deux règles sont
 * retirées à la fin. Aucune donnée d'un vrai bureau n'est lue ni touchée.
 *
 * Sort en code 1 si une écriture interdite passe, ou si une écriture légitime est refusée.
 * Avant la migration `20261007300000_automation_rules_garde.sql` : les interdites PASSENT (le défaut).
 */
const prod = process.argv.includes('--prod');
// Une base LOCALE (pile jetable des E2E) : GARDE_DB_URL=postgres://…@127.0.0.1:…/postgres. Jamais une base distante.
const urlLocale = process.env.GARDE_DB_URL ?? '';
if (urlLocale && !['localhost', '127.0.0.1'].includes(new URL(urlLocale).hostname)) {
  console.error('REFUS : GARDE_DB_URL ne vise que la pile locale.'); process.exit(2);
}
const jeton = process.env.SUPABASE_ACCESS_TOKEN;
const ref = prod ? process.env.SUPABASE_PROJECT_REF_PROD : process.env.SUPABASE_PROJECT_REF;
if (!urlLocale && (!jeton || !ref)) { console.error('SUPABASE_ACCESS_TOKEN et la référence du projet sont requis (.env.local).'); process.exit(2); }
const cible = urlLocale ? 'pile locale' : prod ? 'PROD' : 'staging';

// Le bureau de test et un de ses membres qui peut modifier les automatisations (comptes fictifs).
const BUREAU = process.env.GARDE_BUREAU ?? (prod ? 'Grok Audit (TEST)' : '[TEST] QA Automatisations A — ne pas utiliser');
const MEMBRE = process.env.GARDE_MEMBRE ?? (prod ? 'viktor.audit@lume-test.ca' : 'qa-auto-proprio-a@lume-qa.test');

let base = null;
if (urlLocale) {
  const { default: pg } = await import('pg');
  base = new pg.Client({ connectionString: urlLocale });
  await base.connect();
}
async function sql(requete) {
  if (base) {
    // Plusieurs instructions : pg rend un résultat par instruction, le dernier porte les lignes.
    const r = await base.query(requete);
    return (Array.isArray(r) ? r[r.length - 1] : r).rows;
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: requete }),
  });
  const texte = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} : ${texte.slice(0, 400)}`);
  return JSON.parse(texte);
}
const litteral = (t) => `'${String(t).replace(/'/g, "''")}'`;

const [vise] = await sql(`
  select o.id as org, u.id as membre
  from orgs o
  join memberships m on m.org_id = o.id and m.status = 'active'
  join auth.users u on u.id = m.user_id
  where o.name = ${litteral(BUREAU)} and o.deleted_at is null and lower(u.email) = lower(${litteral(MEMBRE)})
  limit 1`);
if (!vise) { console.error(`Bureau de test « ${BUREAU} » ou membre « ${MEMBRE} » introuvable — rien n'a été tenté.`); await base?.end(); process.exit(2); }

// [nom, attendu ('refusé' | 'accepté'), SQL joué en session d'utilisateur ; :libre = règle à soi, :fournie = règle fournie]
const TENTATIVES = [
  ['publier une règle en brouillon (is_active faux → vrai)', 'refusé', `update automation_rules set is_active = true where id = :libre`],
  ['insérer une règle déjà publiée', 'refusé', `insert into automation_rules (org_id, name, trigger_event, conditions, delay_seconds, actions, is_active, is_preset) values (:org, '[garde] née publiée', 'lead.created', '{}', 0, '[]', true, false)`],
  ['se déclarer « automatisation fournie » (is_preset)', 'refusé', `update automation_rules set is_preset = true where id = :libre`],
  ['inventer une clé de préréglage (preset_key)', 'refusé', `update automation_rules set preset_key = 'invente_par_le_navigateur' where id = :libre`],
  ['insérer une règle « fournie »', 'refusé', `insert into automation_rules (org_id, name, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key) values (:org, '[garde] fausse fournie', 'lead.created', '{}', 0, '[]', false, true, 'garde_fausse')`],
  ['changer le déclencheur d’une règle fournie', 'refusé', `update automation_rules set trigger_event = 'quote.sent' where id = :fournie`],
  ['mettre une règle fournie à la corbeille', 'refusé', `update automation_rules set deleted_at = now() where id = :fournie`],
  ['purger une règle qui n’est pas à la corbeille', 'refusé', `update automation_rules set deleted_at = now(), purged_at = now() where id = :libre`],
  ['supprimer pour de bon (DELETE)', 'refusé', `delete from automation_rules where id = :libre`],
  ['renommer sa règle', 'accepté', `update automation_rules set name = '[garde] renommée' where id = :libre`],
  ['réécrire ses étapes', 'accepté', `update automation_rules set steps = '[]'::jsonb, actions = '[]'::jsonb where id = :libre`],
  ['changer le déclencheur de SA règle', 'accepté', `update automation_rules set trigger_event = 'quote.sent' where id = :libre`],
  ['mettre SA règle à la corbeille', 'accepté', `update automation_rules set deleted_at = now(), is_active = false where id = :libre`],
  ['renommer une règle fournie', 'accepté', `update automation_rules set name = '[garde] fournie renommée' where id = :fournie`],
  ['créer un brouillon', 'accepté', `insert into automation_rules (org_id, name, trigger_event, conditions, delay_seconds, actions, is_active, is_preset) values (:org, '[garde] brouillon', 'lead.created', '{}', 0, '[]', false, false)`],
];

const blocs = TENTATIVES.map(([nom, , requete], i) => `
  begin
    ${requete.replace(/:libre/g, 'v_libre').replace(/:fournie/g, 'v_fournie').replace(/:org/g, 'v_org')};
    get diagnostics v_n = row_count;
    -- Passée : on l'annule quand même (sous-transaction), et on note qu'elle a passé.
    raise exception 'annuler' using errcode = 'ZZ001';
  exception
    when sqlstate 'ZZ001' then insert into _garde_resultats values (${i}, ${litteral(nom)}, case when v_n > 0 then 'accepté' else 'aucune ligne' end, null);
    when others then insert into _garde_resultats values (${i}, ${litteral(nom)}, 'refusé', sqlstate || ' ' || sqlerrm);
  end;`).join('\n');

const lignes = await sql(`
  drop table if exists _garde_resultats;
  create temp table _garde_resultats (rang int, nom text, issue text, detail text);
  -- La session d'utilisateur simulée doit pouvoir y noter ses issues.
  grant all on _garde_resultats to public;
  do $garde$
  declare
    v_org uuid := ${litteral(vise.org)};
    v_membre uuid := ${litteral(vise.membre)};
    v_libre uuid;
    v_fournie uuid;
    v_n int;
  begin
    -- Deux règles de test, créées hors session d'utilisateur (comme le fait le serveur de semis).
    insert into automation_rules (org_id, name, trigger_event, conditions, delay_seconds, actions, is_active, is_preset)
      values (v_org, '[garde] règle à soi', 'lead.created', '{}', 0, '[]', false, false) returning id into v_libre;
    insert into automation_rules (org_id, name, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
      values (v_org, '[garde] règle fournie', 'lead.created', '{}', 0, '[]', false, true, 'garde_verification_' || substr(v_libre::text, 1, 8)) returning id into v_fournie;

    -- La session d'un membre : rôle authenticated + son jeton (la RLS s'applique, comme dans le navigateur).
    perform set_config('request.jwt.claims', json_build_object('sub', v_membre, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_membre::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    ${blocs}
    reset role;

    -- Le rôle de service, lui, publie (c'est le chemin du serveur).
    set local role service_role;
    begin
      update automation_rules set is_active = true where id = v_libre;
      get diagnostics v_n = row_count;
      raise exception 'annuler' using errcode = 'ZZ001';
    exception
      when sqlstate 'ZZ001' then insert into _garde_resultats values (900, 'le rôle de service publie', case when v_n > 0 then 'accepté' else 'aucune ligne' end, null);
      when others then insert into _garde_resultats values (900, 'le rôle de service publie', 'refusé', sqlstate || ' ' || sqlerrm);
    end;
    reset role;

    -- Ménage : les deux règles de test disparaissent.
    delete from automation_rules where id in (v_libre, v_fournie);
  end
  $garde$;
  select rang, nom, issue, detail from _garde_resultats order by rang;`);

let fautes = 0;
console.log(`${cible} · bureau « ${BUREAU} » · session de ${MEMBRE}\n`);
for (const l of lignes) {
  const attendu = l.rang === 900 ? 'accepté' : TENTATIVES[l.rang][1];
  const ok = l.issue === attendu;
  if (!ok) fautes += 1;
  console.log(`${ok ? '✓' : '✗'} ${l.nom} — ${l.issue}${ok ? '' : ` (attendu : ${attendu})`}${l.detail && (!ok || l.issue === 'refusé') ? ` · ${String(l.detail).slice(0, 110)}` : ''}`);
}
const reste = await sql(`select count(*)::int as n from automation_rules where org_id = ${litteral(vise.org)} and name like '[garde]%'`);
await base?.end();
console.log(`\nrègles de test restantes : ${reste[0].n}`);
console.log(`BILAN : ${lignes.length - fautes}/${lignes.length}${fautes ? ' — la garde ne tient pas (ou la migration n’est pas appliquée)' : ''}`);
process.exit(fautes || reste[0].n ? 1 : 0);
