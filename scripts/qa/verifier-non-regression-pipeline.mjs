/**
 * verifier-non-regression-pipeline.mjs — le plancher du QA, vérifié en base.
 *
 *   node --env-file=.env.local scripts/qa/verifier-non-regression-pipeline.mjs
 *   node --env-file=.env.local scripts/qa/verifier-non-regression-pipeline.mjs --prod
 *
 * La section 2 du rapport QA liste ce qui FONCTIONNE et ne doit pas casser.
 * Une partie se vérifie sans navigateur : les règles qui vivent en base
 * (contraintes, triggers, dérivation des montants) et la présence des
 * fonctions dont dépendent les écrans.
 *
 * Ce script ne remplace pas la validation humaine — il attrape les
 * régressions silencieuses entre deux passages d'humain.
 *
 * AUCUNE ÉCRITURE DURABLE : chaque sonde crée ses données dans une
 * transaction qu'elle annule elle-même.
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

const PROD = process.argv.includes('--prod');
const REF = PROD ? process.env.SUPABASE_PROJECT_REF_PROD : process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!REF || !TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN et SUPABASE_PROJECT_REF requis dans .env.local');
  process.exit(1);
}

const res = [];
const ok = (nom, vrai, detail = '') => {
  res.push({ nom, vrai: !!vrai, detail });
  console.log(`  ${vrai ? '✓' : '✗'} ${nom}${detail ? ' — ' + detail : ''}`);
};

async function sql(requete) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: requete }),
  });
  const texte = await r.text();
  try { return { ok: r.ok, data: JSON.parse(texte) }; }
  catch { return { ok: r.ok, brut: texte }; }
}

/** Une valeur scalaire, sous la clé `r`. */
async function valeur(requete) {
  const { data } = await sql(requete);
  return Array.isArray(data) && data[0] ? data[0].r : null;
}

console.log(`Cible : ${PROD ? 'PRODUCTION' : 'staging'} (${REF})\n`);

// ── Les fonctions dont les écrans dépendent ────────────────────
console.log('── Fonctions du pipeline ──');
const ATTENDUES = [
  'pipeline_previsions', 'pipeline_previsions_groupees', 'pipeline_a_risque',
  'pipeline_chronologie', 'pipeline_kpis', 'pipeline_montants',
  'pipeline_creer_deal', 'creer_pipeline_sur_mesure', 'pipeline_restaurer_lot',
  'pipeline_par_source', 'pipeline_par_vendeur', 'pipeline_entonnoir',
];
const presentes = await valeur(
  `select coalesce(string_agg(p.proname, ','), '') as r
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(array[${ATTENDUES.map((f) => `'${f}'`).join(',')}]);`);
const liste = String(presentes ?? '').split(',').filter(Boolean);
for (const f of ATTENDUES) ok(`${f}()`, liste.includes(f));

// ── Les règles qui protègent les données ───────────────────────
console.log('\n── Garde-fous en base ──');

ok('la position d étape ignore les archivées',
  (await valeur(`select count(*)::text as r from pg_indexes
                 where indexname = 'pipeline_stages_position_unique'
                   and indexdef like '%archived_at IS NULL%';`)) === '1');

ok('le libellé de motif ignore les archivés',
  (await valeur(`select count(*)::text as r from pg_indexes
                 where indexname = 'uq_pipeline_raisons_perte_libelle'
                   and indexdef like '%archived_at IS NULL%';`)) === '1');

ok('une job à 0 $ n écrase pas le devis',
  (await valeur(`select case when pg_get_functiondef(oid) like '%nullif(j.total_cents, 0)%'
                 then 'oui' else 'non' end as r
                 from pg_proc where proname = 'pipeline_montants';`)) === 'oui');

ok('les prévisions ignorent le devis du client',
  (await valeur(`select case when pg_get_functiondef(oid) like '%provenance in (''job'', ''devis'')%'
                 then 'oui' else 'non' end as r
                 from pg_proc where proname = 'pipeline_previsions';`)) === 'oui');

ok('supprimer un client emporte ses deals',
  (await valeur(`select case when pg_get_functiondef(oid) like '%public.deals%'
                 then 'oui' else 'non' end as r
                 from pg_proc where proname = 'pipeline_deals_cascade_client_soft_delete';`)) === 'oui');

// ── Les triggers qui écrivent l'état dérivé ────────────────────
console.log('\n── Triggers sur les deals ──');
const TRIGGERS = [
  ['trg_deals_deduire_statut', 'statut posé automatiquement'],
  ['trg_deals_ecrire_historique', 'historique des étapes écrit'],
  ['trg_deals_emettre_evenements', 'événements pour les automatisations'],
  ['trg_deals_horodater_etape', 'horodatage du changement d étape'],
  ['trg_deals_mesurer_glissement', 'reports de date mesurés'],
];
const actifs = await valeur(
  `select coalesce(string_agg(t.tgname, ','), '') as r
   from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relname = 'deals' and not t.tgisinternal and t.tgenabled = 'O';`);
const listeT = String(actifs ?? '').split(',').filter(Boolean);
for (const [nom, quoi] of TRIGGERS) ok(quoi, listeT.includes(nom), nom);

// ── Le parcours complet, en transaction annulée ────────────────
console.log('\n── Parcours créer → déplacer → gagner ──');
const sonde = `
do $qa$
declare
  v_org uuid; v_uid uuid; v_pipe uuid; v_e1 uuid; v_won uuid; v_lost uuid;
  v_client uuid; v_deal uuid; v_statut text; v_hist int; v_evt int;
  v_pb text := '';
begin
  -- Une org qui a VRAIMENT de quoi jouer le parcours : prendre la première
  -- venue tombait sur une organisation vide et faisait échouer la sonde
  -- pour une raison qui n'a rien à voir avec le pipeline.
  select m.org_id, m.user_id, c.id
    into v_org, v_uid, v_client
  from public.memberships m
  join public.clients c on c.org_id = m.org_id and c.deleted_at is null
  where m.user_id is not null and m.status = 'active'
  limit 1;
  if v_uid is null or v_client is null then
    raise exception 'DONNEES_INSUFFISANTES';
  end if;

  insert into public.pipelines_ventes (org_id, name) values (v_org, 'ZZNR') returning id into v_pipe;
  insert into public.pipeline_stages (org_id,pipeline_id,name_fr,name_en,position,kind)
  values (v_org,v_pipe,'Ouvert','Open',1,'open') returning id into v_e1;
  insert into public.pipeline_stages (org_id,pipeline_id,name_fr,name_en,position,kind)
  values (v_org,v_pipe,'Gagné','Won',2,'won') returning id into v_won;
  insert into public.pipeline_stages (org_id,pipeline_id,name_fr,name_en,position,kind)
  values (v_org,v_pipe,'Perdu','Lost',3,'lost') returning id into v_lost;

  insert into public.deals (org_id,pipeline_id,stage_id,client_id,source,created_by)
  values (v_org,v_pipe,v_e1,v_client,'manual',v_uid) returning id into v_deal;

  select statut::text into v_statut from public.deals where id = v_deal;
  if v_statut <> 'ouvert' then v_pb := v_pb || ' statut_initial=' || v_statut; end if;

  update public.deals set stage_id = v_won where id = v_deal;
  select statut::text into v_statut from public.deals where id = v_deal;
  if v_statut <> 'gagne' then v_pb := v_pb || ' gagne=' || v_statut; end if;

  update public.deals set stage_id = v_e1 where id = v_deal;
  select statut::text into v_statut from public.deals where id = v_deal;
  if v_statut <> 'ouvert' then v_pb := v_pb || ' retour=' || v_statut; end if;
  if (select won_at from public.deals where id = v_deal) is not null then
    v_pb := v_pb || ' won_at_fantome';
  end if;

  select count(*) into v_hist from public.deal_stage_history where deal_id = v_deal;
  select count(*) into v_evt  from public.pipeline_events     where deal_id = v_deal;
  if v_hist < 3 then v_pb := v_pb || ' historique=' || v_hist; end if;
  if v_evt  < 3 then v_pb := v_pb || ' evenements=' || v_evt; end if;

  if v_pb <> '' then raise exception 'ECHECS:%', v_pb; end if;
  raise exception 'PARCOURS_OK';
end
$qa$;`;

const { data: r } = await sql(sonde);
const msg = (r && r.message) ? String(r.message) : '';
if (/PARCOURS_OK/.test(msg)) {
  ok('créer → gagner → revenir en arrière', true, 'statut, won_at, historique et événements suivent');
} else if (/DONNEES_INSUFFISANTES/.test(msg)) {
  ok('parcours complet', false, 'cette base n a pas de client ou de membre exploitable');
} else {
  ok('créer → gagner → revenir en arrière', false, msg.slice(0, 120));
}

// ── Bilan ──────────────────────────────────────────────────────
const echecs = res.filter((x) => !x.vrai);
console.log(`\n${'─'.repeat(52)}`);
console.log(`${res.length - echecs.length}/${res.length} vérifications passées`);
if (echecs.length) {
  console.log('\nÉchecs :');
  echecs.forEach((e) => console.log(`   ✗ ${e.nom}${e.detail ? ' — ' + e.detail : ''}`));
}
console.log('\nCe script ne couvre PAS l écran : filtres, tri, vues enregistrées,');
console.log('export/import et glisser-déposer demandent un humain.');
console.log('Voir docs/qa-pipeline-glisser-deposer.md.');
process.exit(echecs.length ? 1 : 0);
