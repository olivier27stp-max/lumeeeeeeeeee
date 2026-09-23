-- ═══════════════════════════════════════════════════════════════
-- Pipeline de ventes — ingestion unique (Phase 4)
--
-- UNE seule porte d'entrée pour tous les canaux : le formulaire public, la
-- création manuelle dans le CRM, et tout futur canal. Aujourd'hui le
-- formulaire (server/routes/request-forms.ts) et /api/leads/create font
-- chacun leur propre enchaînement de onze étapes, avec des rollbacks
-- applicatifs non transactionnels : si la création du deal échoue après
-- celle du client, le rattrapage se fait à la main, en TypeScript.
--
-- Ici tout se passe dans UNE transaction Postgres : ou bien le client, le
-- deal et l'attribution existent tous, ou bien rien n'existe.
--
-- DÉDUPLICATION (décision Q4, Rafba 2026-09-23)
-- ──────────────────────────────────────────────
-- Cette décision INVERSE celle du 2026-07-07 (migration 20260720000000),
-- qui avait retiré les index d'unicité pour que deux personnes partageant un
-- téléphone — couples, propriétaire et locataire — restent deux fiches.
--
-- On rapproche désormais sur téléphone normalisé E.164 OU courriel en
-- minuscules, dans la même organisation. Le compromis assumé : deux
-- personnes d'un même foyer qui remplissent le formulaire avec le même
-- numéro seront fusionnées. C'est un choix produit, pas un effet de bord —
-- et il reste réversible, `p_dedup` permet de le désactiver par appel.
--
-- Si le contact retrouvé a déjà un deal OUVERT, on ne crée pas de doublon :
-- le nouveau lead s'ajoute comme activité sur ce deal (décision 4 du plan).
--
-- UTM et fbclid : capturés ici, stockés sur le deal. Le formulaire public
-- n'a AUCUN champ à ajouter — le handler lit l'URL et les passe en
-- paramètre. C'est ce que la décision 8 demandait.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Normalisation du téléphone, côté base.
--    `normalizeE164()` existe en TypeScript mais n'est câblée que sur les
--    SMS : `clients.phone` stocke aujourd'hui la saisie brute. Pour
--    rapprocher deux fiches, il faut comparer la même chose des deux côtés.
--    Hypothèse Amérique du Nord (+1), comme le helper TypeScript.
-- ───────────────────────────────────────────────────────────────
create or replace function public.normaliser_telephone(p_phone text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select case
    when p_phone is null or btrim(p_phone) = '' then null
    when length(regexp_replace(p_phone, '\D', '', 'g')) = 10
      then '+1' || regexp_replace(p_phone, '\D', '', 'g')
    when length(regexp_replace(p_phone, '\D', '', 'g')) = 11
         and left(regexp_replace(p_phone, '\D', '', 'g'), 1) = '1'
      then '+' || regexp_replace(p_phone, '\D', '', 'g')
    when left(btrim(p_phone), 1) = '+'
      then '+' || regexp_replace(p_phone, '\D', '', 'g')
    else null
  end;
$fn$;

comment on function public.normaliser_telephone(text) is
  'Téléphone en E.164 (hypothèse +1). Miroir exact de normalizeE164() dans server/lib/helpers.ts : les deux doivent rester d''accord, sinon la déduplication compare des choses différentes.';

-- Index de rapprochement. NON UNIQUES : on ne réinterdit pas les doublons en
-- base (ce serait revenir sur 20260720000000 par la bande) ; on rend
-- seulement la recherche rapide, et c'est l'ingestion qui décide.
create index if not exists idx_clients_org_tel_normalise
  on public.clients (org_id, public.normaliser_telephone(phone))
  where deleted_at is null and phone is not null;

create index if not exists idx_clients_org_courriel_minuscule
  on public.clients (org_id, lower(email))
  where deleted_at is null and email is not null;

-- ───────────────────────────────────────────────────────────────
-- 2. La fonction d'ingestion.
--    Retourne ce qui s'est passé, pour que l'appelant puisse le journaliser
--    et le montrer : { deal_id, client_id, cree, fusionne, deal_existant }.
--
--    On supprime d'abord toute signature antérieure : `create or replace` ne
--    remplace PAS une fonction dont la liste d'arguments diffère, il crée une
--    surcharge — et PostgREST refuse alors de choisir (PGRST203), ce qui fait
--    échouer l'appel sans que rien ne soit cassé en base. Piège vérifié sur
--    staging pendant l'écriture de cette migration.
-- ───────────────────────────────────────────────────────────────
drop function if exists public.ingest_lead(
  uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, jsonb, boolean
);

create or replace function public.ingest_lead(
  p_org_id       uuid,
  p_source       text,
  p_external_id  text default null,
  p_first_name   text default null,
  p_last_name    text default null,
  p_company      text default null,
  p_email        text default null,
  p_phone        text default null,
  p_address      text default null,
  p_notes        text default null,
  p_utm_source   text default null,
  p_utm_medium   text default null,
  p_utm_campaign text default null,
  p_utm_content  text default null,
  p_fbclid       text default null,
  p_payload      jsonb default '{}'::jsonb,
  p_dedup        boolean default true,
  -- `crm_enforce_scope` refuse toute écriture sans session ET sans auteur :
  -- une ingestion serveur (formulaire public, import) doit donc dire au nom
  -- de qui elle écrit. Le handler passe le créateur du formulaire, ou le
  -- propriétaire de l'organisation.
  p_created_by   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pipeline    uuid;
  v_etape       uuid;
  v_client      uuid;
  v_deal        uuid;
  v_deal_ouvert uuid;
  v_tel         text := public.normaliser_telephone(p_phone);
  v_courriel    text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_fusionne    boolean := false;
  v_nom         text;
  v_auteur      uuid := coalesce(p_created_by, auth.uid());
begin
  if p_org_id is null then
    raise exception 'org_id requis';
  end if;

  -- Sans session, il faut un auteur explicite : c'est ce qu'exige
  -- `crm_enforce_scope` sur clients et deals.
  if v_auteur is null then
    select user_id into v_auteur
    from public.memberships
    where org_id = p_org_id and role in ('owner', 'admin')
    order by case role when 'owner' then 0 else 1 end, created_at
    limit 1;
  end if;

  if v_auteur is null then
    raise exception 'Aucun auteur : passer p_created_by, ou avoir un propriétaire dans l''organisation';
  end if;

  -- 2a. Idempotence : la même soumission ne crée jamais deux deals.
  --     C'est la première chose vérifiée, avant toute écriture.
  if p_external_id is not null then
    select id into v_deal
    from public.deals
    where org_id = p_org_id and source = p_source
      and external_id = p_external_id and deleted_at is null
    limit 1;

    if v_deal is not null then
      return jsonb_build_object(
        'deal_id', v_deal, 'client_id', (select client_id from public.deals where id = v_deal),
        'cree', false, 'fusionne', false, 'deal_existant', true, 'raison', 'deja_ingere');
    end if;
  end if;

  -- 2b. Le pipeline par défaut de l'organisation, et sa première étape
  --     ouverte PAR POSITION — jamais par nom (décision 5 du plan).
  select id into v_pipeline
  from public.pipelines_ventes
  where org_id = p_org_id and is_default
  limit 1;

  if v_pipeline is null then
    v_pipeline := public.seed_pipeline_ventes(p_org_id, 'generique');
  end if;

  select id into v_etape
  from public.pipeline_stages
  where org_id = p_org_id and pipeline_id = v_pipeline
    and kind = 'open' and archived_at is null
  order by position
  limit 1;

  if v_etape is null then
    raise exception 'Aucune étape ouverte dans le pipeline de cette organisation';
  end if;

  -- 2c. Rapprochement (Q4) : téléphone E.164 OU courriel en minuscules,
  --     dans la même organisation. Le plus récemment actif gagne.
  if p_dedup and (v_tel is not null or v_courriel is not null) then
    select id into v_client
    from public.clients
    where org_id = p_org_id
      and deleted_at is null
      and (
        (v_tel is not null and public.normaliser_telephone(phone) = v_tel)
        or (v_courriel is not null and lower(email) = v_courriel)
      )
    order by coalesce(last_client_activity_at, updated_at, created_at) desc
    limit 1;

    v_fusionne := v_client is not null;
  end if;

  -- 2d. Aucun contact retrouvé : on en crée un.
  if v_client is null then
    v_nom := btrim(coalesce(p_first_name, '') || ' ' || coalesce(p_last_name, ''));

    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, notes,
      status, lead_status, source, title, value, created_by
    )
    values (
      p_org_id,
      nullif(btrim(coalesce(p_first_name, '')), ''),
      nullif(btrim(coalesce(p_last_name, '')), ''),
      nullif(btrim(coalesce(p_company, '')), ''),
      v_courriel,
      nullif(btrim(coalesce(p_phone, '')), ''),
      nullif(btrim(coalesce(p_address, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''),
      'lead', 'new_prospect', p_source,
      nullif(btrim(coalesce(p_company, '')), ''),
      0, v_auteur
    )
    returning id into v_client;
  else
    -- Contact retrouvé : on complète les trous, on n'écrase jamais.
    update public.clients set
      email   = coalesce(email, v_courriel),
      phone   = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), '')),
      address = coalesce(address, nullif(btrim(coalesce(p_address, '')), '')),
      company = coalesce(company, nullif(btrim(coalesce(p_company, '')), '')),
      last_client_activity_at = now(),
      updated_at = now()
    where id = v_client;
  end if;

  -- 2e. Un deal OUVERT existe déjà pour ce contact ? On n'en crée pas un
  --     second : le nouveau lead devient une activité sur celui-là.
  select d.id into v_deal_ouvert
  from public.deals d
  join public.pipeline_stages s on s.id = d.stage_id
  where d.org_id = p_org_id and d.client_id = v_client
    and d.deleted_at is null and s.kind = 'open'
  order by d.created_at desc
  limit 1;

  if v_deal_ouvert is not null then
    update public.deals set
      last_activity_at = now(),
      raw_payload = raw_payload || jsonb_build_object(
        'relances', coalesce(raw_payload -> 'relances', '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object(
            'a', now(), 'source', p_source, 'external_id', p_external_id,
            'utm_campaign', p_utm_campaign, 'payload', p_payload))
      ),
      updated_at = now()
    where id = v_deal_ouvert;

    return jsonb_build_object(
      'deal_id', v_deal_ouvert, 'client_id', v_client,
      'cree', false, 'fusionne', v_fusionne, 'deal_existant', true,
      'raison', 'deal_ouvert_existant');
  end if;

  -- 2f. Nouveau deal. NON ASSIGNÉ, première étape ouverte (décision 5).
  --     Les horodatages, l'historique et l'événement sont posés par les
  --     triggers : ce chemin produit exactement le même résultat qu'un
  --     glisser-déposer dans l'écran.
  insert into public.deals (
    org_id, pipeline_id, stage_id, client_id, source, external_id,
    utm_source, utm_medium, utm_campaign, utm_content, fbclid, raw_payload,
    created_by
  )
  values (
    p_org_id, v_pipeline, v_etape, v_client, p_source, p_external_id,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_content, p_fbclid,
    coalesce(p_payload, '{}'::jsonb), v_auteur
  )
  returning id into v_deal;

  return jsonb_build_object(
    'deal_id', v_deal, 'client_id', v_client,
    'cree', true, 'fusionne', v_fusionne, 'deal_existant', false,
    'raison', case when v_fusionne then 'contact_retrouve' else 'nouveau_contact' end);
end;
$fn$;

-- Le serveur appelle cette fonction avec la clé de service ; aucun client
-- ne doit pouvoir créer un deal dans une organisation arbitraire.
revoke all on function public.ingest_lead(
  uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, jsonb, boolean, uuid
) from public, anon, authenticated;

comment on function public.ingest_lead(
  uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, jsonb, boolean, uuid
) is
  'Porte d''entrée unique des leads (formulaire public, création manuelle, futurs canaux), en UNE transaction. Idempotente sur (org, source, external_id). Rapproche sur téléphone E.164 ou courriel (décision Q4) ; si le contact a un deal ouvert, le lead s''y ajoute au lieu de créer un doublon.';

commit;
