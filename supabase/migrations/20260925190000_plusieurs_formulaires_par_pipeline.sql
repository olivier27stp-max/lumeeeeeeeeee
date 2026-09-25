-- ═══════════════════════════════════════════════════════════════
-- Plusieurs formulaires de demande, chacun vers SON pipeline
--
-- LE BESOIN. Un formulaire pour la carte terrain, un pour le site, un pour
-- les publicités — mêmes questions, mais chacun alimente son propre pipeline
-- pour qu'on sache d'où vient une vente sans trier à la main.
--
-- TROIS CHOSES L'EMPÊCHAIENT :
--
--   1. `idx_request_forms_org` était UNIQUE sur `org_id` : littéralement un
--      seul formulaire par entreprise. On le remplace par un index simple —
--      il servait aussi à la recherche, on garde cette utilité.
--
--   2. Aucun lien entre un formulaire et un pipeline.
--
--   3. `ingest_lead` prenait TOUJOURS le pipeline par défaut
--      (`order by is_default … limit 1`), sans jamais regarder d'où venait
--      le lead. Un lead publicitaire et un lead frappé à la porte
--      atterrissaient dans la même colonne.
--
-- CE QUI NE CHANGE PAS. `p_pipeline_id` est facultatif : sans lui,
-- `ingest_lead` se comporte exactement comme avant. Le formulaire existant
-- continue donc de fonctionner à l'identique tant qu'on ne lui choisit pas
-- de pipeline — aucune donnée déplacée, aucun deal touché.
--
-- LE REPLI EST VOLONTAIRE. Si le pipeline visé a été supprimé, ou n'a plus
-- d'étape ouverte, on retombe sur le défaut plutôt que de refuser le lead.
-- Perdre une demande de client pour un réglage périmé serait bien pire que
-- de la classer au mauvais endroit.
--
-- ROLLBACK :
--   alter table public.request_forms drop column if exists pipeline_id;
--   drop index if exists public.idx_request_forms_org;
--   create unique index idx_request_forms_org on public.request_forms (org_id)
--     where deleted_at is null;
--   -- puis restaurer ingest_lead depuis la migration précédente
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Plusieurs formulaires par organisation ──
drop index if exists public.idx_request_forms_org;
create index idx_request_forms_org
  on public.request_forms (org_id)
  where deleted_at is null;

-- ── 2. Le formulaire désigne son pipeline ──
-- `on delete set null` : supprimer un pipeline ne doit pas emporter le
-- formulaire ni bloquer sa suppression. Le formulaire retombe alors sur le
-- pipeline par défaut, ce que le repli d'`ingest_lead` gère déjà.
alter table public.request_forms
  add column if not exists pipeline_id uuid
  references public.pipelines_ventes(id) on delete set null;

comment on column public.request_forms.pipeline_id is
  'Pipeline qui reçoit les leads de ce formulaire. NULL = pipeline par défaut de l''organisation (2026-09-25).';

create index if not exists idx_request_forms_pipeline
  on public.request_forms (pipeline_id)
  where pipeline_id is not null and deleted_at is null;

-- ── 3. `ingest_lead` respecte le pipeline demandé ──
--
-- ON SUPPRIME D'ABORD L'ANCIENNE SIGNATURE. Ajouter un paramètre crée une
-- SURCHARGE, pas un remplacement : les deux versions (18 et 19 arguments)
-- coexisteraient, et un appel qui ne nomme pas `p_pipeline_id` deviendrait
-- ambigu — « function is not unique », erreur 42725. Le formulaire public
-- cesserait de fonctionner. Attrapé en jouant la sonde avant d'appliquer.
drop function if exists public.ingest_lead(
  uuid, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, jsonb, boolean, uuid
);

--
-- Seules DEUX choses changent, tout le reste est repris à l'identique de la
-- version précédente (relue depuis la base, pas de mémoire) :
--
--   · un paramètre `p_pipeline_id` facultatif, en DERNIÈRE position pour ne
--     casser aucun appel existant ;
--
--   · le §2e (« un deal ouvert existe déjà ») se limite au pipeline visé.
--     Sans ça, un lead publicitaire serait absorbé par un deal porte-à-porte
--     ouvert pour le même contact, et n'apparaîtrait jamais dans le pipeline
--     des publicités — précisément ce qu'on cherche à éviter.
create or replace function public.ingest_lead(
  p_org_id uuid,
  p_source text,
  p_external_id text default null,
  p_first_name text default null,
  p_last_name text default null,
  p_company text default null,
  p_email text default null,
  p_phone text default null,
  p_address text default null,
  p_notes text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_utm_content text default null,
  p_fbclid text default null,
  p_payload jsonb default '{}'::jsonb,
  p_dedup boolean default true,
  p_created_by uuid default null,
  p_pipeline_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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

  -- 2b. Le pipeline DEMANDÉ s'il existe encore dans cette organisation,
  --     sinon celui par défaut. Le repli est volontaire : perdre la demande
  --     d'un client parce qu'un pipeline a été supprimé serait pire que de
  --     la classer au mauvais endroit.
  if p_pipeline_id is not null then
    select id into v_pipeline
    from public.pipelines_ventes
    where id = p_pipeline_id and org_id = p_org_id
    limit 1;
  end if;

  if v_pipeline is null then
    select id into v_pipeline
    from public.pipelines_ventes
    where org_id = p_org_id and is_default
    limit 1;
  end if;

  if v_pipeline is null then
    v_pipeline := public.seed_pipeline_ventes(p_org_id, 'generique');
  end if;

  select id into v_etape
  from public.pipeline_stages
  where org_id = p_org_id and pipeline_id = v_pipeline
    and kind = 'open' and archived_at is null
  order by position
  limit 1;

  -- Le pipeline visé n'a aucune étape ouverte : on retombe sur le défaut
  -- plutôt que de refuser le lead.
  if v_etape is null and p_pipeline_id is not null then
    select id into v_pipeline
    from public.pipelines_ventes
    where org_id = p_org_id and is_default
    limit 1;

    select id into v_etape
    from public.pipeline_stages
    where org_id = p_org_id and pipeline_id = v_pipeline
      and kind = 'open' and archived_at is null
    order by position
    limit 1;
  end if;

  if v_etape is null then
    raise exception 'Aucune étape ouverte dans le pipeline de cette organisation';
  end if;

  -- 2c. Rapprochement : téléphone E.164 OU courriel en minuscules.
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
    update public.clients set
      email   = coalesce(email, v_courriel),
      phone   = coalesce(phone, nullif(btrim(coalesce(p_phone, '')), '')),
      address = coalesce(address, nullif(btrim(coalesce(p_address, '')), '')),
      company = coalesce(company, nullif(btrim(coalesce(p_company, '')), '')),
      last_client_activity_at = now(),
      updated_at = now()
    where id = v_client;
  end if;

  -- 2e. Un deal OUVERT existe déjà pour ce contact DANS CE PIPELINE ?
  --     On n'en crée pas un second. La restriction au pipeline est le
  --     changement : un même client peut légitimement avoir un deal en
  --     porte-à-porte ET un deal publicitaire — ce sont deux affaires.
  select d.id into v_deal_ouvert
  from public.deals d
  join public.pipeline_stages s on s.id = d.stage_id
  where d.org_id = p_org_id and d.client_id = v_client
    and d.pipeline_id = v_pipeline
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

  -- 2f. Nouveau deal. NON ASSIGNÉ, première étape ouverte.
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

-- LES DROITS, NOMMÉMENT. `create or replace` RÉINITIALISE l'ACL d'une
-- fonction : les révocations posées par la migration d'origine sont perdues,
-- et les defaults Supabase accordent alors EXECUTE à PUBLIC — donc à `anon`,
-- c'est-à-dire à n'importe qui sur internet. Une fonction `security definer`
-- qui crée des clients et des deals, ouverte sans authentification.
--
-- Constaté sur staging avant d'atteindre la production : `anon=true`.
-- Révoquer à PUBLIC seul ne suffit pas — `anon` et `authenticated` portent
-- leur propre grant et y survivraient.
revoke all on function public.ingest_lead(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean, uuid, uuid) from public;
revoke all on function public.ingest_lead(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean, uuid, uuid) from anon;
revoke all on function public.ingest_lead(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean, uuid, uuid) from authenticated;
grant execute on function public.ingest_lead(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean, uuid, uuid) to service_role;

comment on function public.ingest_lead(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb, boolean, uuid, uuid) is
  'Entree unique des leads. p_pipeline_id dirige le lead vers un pipeline precis (formulaire dedie aux publicites, a la carte terrain...) ; sans lui, le pipeline par defaut, comme avant (2026-09-25).';

commit;
