-- Transfert d'un client, d'une soumission ou d'un job vers un autre bureau de
-- la même entreprise (Q13 du plan multi-bureaux, décision de Rafba : permis).
--
-- Pourquoi « copier puis archiver » plutôt que changer org_id : ~40 clés
-- étrangères composites (org_id, id) lient chaque client / soumission / job à
-- son arborescence ; changer le bureau d'une ligne exigerait de déplacer tout
-- l'arbre, factures émises comprises — or une facture émise ne change JAMAIS
-- de bureau (numéro, taxes et branding sont légaux). Donc :
--   * la cible reçoit une COPIE avec un NOUVEAU numéro (préfixe du bureau
--     cible), les taxes par défaut du bureau cible (s'il en a), et les
--     personnes seulement si elles sont membres actifs du bureau cible ;
--   * l'original est ARCHIVÉ (historique conservé dans son bureau) ;
--   * le lien source → cible est journalisé dans transferts_bureaux.
-- Règles :
--   client     : copié ; ses soumissions ouvertes et ses jobs non facturés le
--                suivent ; la fiche d'origine est archivée seulement si elle
--                n'a aucune facture (sinon elle reste active pour le suivi).
--   soumission : brouillon / en attente / changements demandés seulement ;
--                la copie repart en BROUILLON (à renvoyer depuis le bureau
--                cible, avec son lien public et son branding).
--   job        : brouillon / planifié, sans facture ; lignes et visites FUTURES
--                copiées ; les visites futures d'origine sont retirées du calendrier.
-- Droits : admin ou propriétaire ACTIF des DEUX bureaux, même entreprise.
-- Bureau courant pendant la copie : les triggers crm_enforce_scope forcent
-- org_id := current_org_id() (= l'en-tête x-lume-org, donc le bureau SOURCE
-- affiché) sur clients / lignes de job / visites. Le transfert bascule donc
-- l'en-tête vers le bureau CIBLE le temps de la copie, puis le restaure
-- (l'appelant est admin du bureau cible, vérifié juste avant).

-- 1. Journal des transferts ─────────────────────────────────────────

create table if not exists public.transferts_bureaux (
  id uuid primary key default gen_random_uuid(),
  company_group_id uuid not null references public.company_groups(id),
  entite text not null check (entite in ('client', 'quote', 'job')),
  org_source uuid not null references public.orgs(id),
  id_source uuid not null,
  org_cible uuid not null references public.orgs(id),
  id_cible uuid not null,
  fait_par uuid,
  fait_le timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
create index if not exists transferts_bureaux_source_idx on public.transferts_bureaux (org_source, id_source);
create index if not exists transferts_bureaux_cible_idx on public.transferts_bureaux (org_cible, id_cible);
comment on table public.transferts_bureaux is
  'Journal des transferts entre bureaux : l''original (source, archivé) et sa copie (cible).';

alter table public.transferts_bureaux enable row level security;
alter table public.transferts_bureaux force row level security;
drop policy if exists transferts_bureaux_select on public.transferts_bureaux;
create policy transferts_bureaux_select on public.transferts_bureaux
  for select to authenticated
  using (public.has_org_membership((select auth.uid()), org_source)
      or public.has_org_membership((select auth.uid()), org_cible));
revoke all on public.transferts_bureaux from anon, authenticated;
grant select on public.transferts_bureaux to authenticated;
grant all on public.transferts_bureaux to service_role;

-- 2. Aides internes ─────────────────────────────────────────────────

-- Personne conservée seulement si elle est membre actif du bureau cible.
create or replace function public._membre_actif_ou_nul(p_user uuid, p_org uuid)
 returns uuid
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select case when p_user is not null and public.has_org_membership(p_user, p_org) then p_user end;
$function$;

-- Taux combiné de la taxe par défaut du bureau (en %), ou nul s'il n'en a pas.
create or replace function public._taxe_defaut_bureau(p_org uuid, out taux numeric, out libelle text)
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  v_facteur numeric := 1;
  v_simple numeric := 0;
  v_groupe text;
begin
  select g.id, g.name into r
    from public.tax_groups g
   where g.org_id = p_org and g.is_default and coalesce(g.is_active, true)
   order by g.created_at limit 1;
  if r.id is null then taux := null; libelle := null; return; end if;
  v_groupe := r.name;
  for r in
    select c.rate, coalesce(c.is_compound, false) as compose
      from public.tax_group_items i
      join public.tax_configs c on c.id = i.tax_config_id
     where i.tax_group_id = (select g.id from public.tax_groups g where g.org_id = p_org and g.is_default and coalesce(g.is_active, true) order by g.created_at limit 1)
       and coalesce(c.is_active, true)
     order by i.sort_order
  loop
    if r.compose then v_facteur := v_facteur * (1 + r.rate / 100);
    else v_simple := v_simple + r.rate;
    end if;
  end loop;
  taux := round(((1 + v_simple / 100) * v_facteur - 1) * 100, 4);
  libelle := v_groupe || ' (' || trim(to_char(taux, 'FM990.999')) || '%)';
end;
$function$;

-- Client correspondant dans le bureau cible : déjà transféré/copié → le même ;
-- sinon une copie (identité, coordonnées, consentements, adresse).
create or replace function public._client_dans_bureau(p_client uuid, p_cible uuid, p_uid uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_src uuid;
  v_groupe uuid;
begin
  if p_client is null then return null; end if;

  select t.id_cible into v_id
    from public.transferts_bureaux t
    join public.clients c on c.id = t.id_cible and c.deleted_at is null
   where t.entite = 'client' and t.id_source = p_client and t.org_cible = p_cible
   order by t.fait_le desc limit 1;
  if v_id is not null then return v_id; end if;

  insert into public.clients (
    org_id, first_name, last_name, company, email, phone, address, status, notes,
    city, province, postal_code, country, street_number, street_name, latitude, longitude, place_id,
    display_as_company, billing_same_as_service, billing_address, lead_status, source, lead_source,
    title, value, description, phones, email_label, tags, tax_exempt,
    sms_consent_at, email_consent_at, email_opt_out_at, email_opt_out_reason,
    assigned_to, created_by
  )
  select p_cible, c.first_name, c.last_name, c.company, c.email, c.phone, c.address, c.status, c.notes,
         c.city, c.province, c.postal_code, c.country, c.street_number, c.street_name, c.latitude, c.longitude, c.place_id,
         c.display_as_company, c.billing_same_as_service, c.billing_address, c.lead_status, c.source, c.lead_source,
         c.title, c.value, c.description, c.phones, c.email_label, c.tags, c.tax_exempt,
         c.sms_consent_at, c.email_consent_at, c.email_opt_out_at, c.email_opt_out_reason,
         public._membre_actif_ou_nul(c.assigned_to, p_cible), p_uid
    from public.clients c
   where c.id = p_client
  returning id into v_id;

  select c.org_id into v_src from public.clients c where c.id = p_client;
  select o.company_group_id into v_groupe from public.orgs o where o.id = p_cible;
  insert into public.transferts_bureaux (company_group_id, entite, org_source, id_source, org_cible, id_cible, fait_par, details)
  values (v_groupe, 'client', v_src, p_client, p_cible, v_id, p_uid, jsonb_build_object('copie_liee', true));
  return v_id;
end;
$function$;

create or replace function public._transferer_devis(p_quote uuid, p_cible uuid, p_uid uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  q record;
  v_id uuid;
  v_num bigint;
  v_numero text;
  t record;
  v_tax_rate numeric;
  v_tax_label text;
  v_tax_cents bigint;
  v_taxes text := 'conservees';
  v_groupe uuid;
begin
  select * into q from public.quotes where id = p_quote;
  if q.status not in ('draft', 'awaiting_response', 'changes_requested') then
    raise exception 'Seule une soumission non acceptée (brouillon, en attente, changements demandés) peut être transférée.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_cible::text || ':quote', 0));
  v_num := public.org_smallest_free_number(p_cible, 'quote');
  insert into public.quote_sequences (org_id, last_value, updated_at)
  values (p_cible, v_num, now())
  on conflict (org_id) do update
    set last_value = greatest(public.quote_sequences.last_value, excluded.last_value), updated_at = now();

  v_tax_rate := q.tax_rate; v_tax_label := q.tax_rate_label; v_tax_cents := q.tax_cents;
  select * into t from public._taxe_defaut_bureau(p_cible);
  if t.taux is not null then
    v_tax_rate := t.taux; v_tax_label := t.libelle;
    v_tax_cents := round((coalesce(q.subtotal_cents, 0) - coalesce(q.discount_cents, 0)) * t.taux / 100);
    v_taxes := 'bureau_cible';
  end if;

  insert into public.quotes (
    org_id, quote_number, title, lead_id, client_id, status, context_type, salesperson_id, created_by,
    valid_until, subtotal_cents, discount_type, discount_value, discount_cents,
    tax_rate_label, tax_rate, tax_cents, total_cents, currency, notes, internal_notes, contract_disclaimer,
    deposit_required, deposit_type, deposit_value, deposit_cents, require_payment_method,
    source_template_id, source_template_name, layout_type, quote_type, service_plan, logo_url
  ) values (
    p_cible, v_num::text, q.title,
    public._client_dans_bureau(q.lead_id, p_cible, p_uid),
    public._client_dans_bureau(q.client_id, p_cible, p_uid),
    'draft', q.context_type, public._membre_actif_ou_nul(q.salesperson_id, p_cible), p_uid,
    q.valid_until, q.subtotal_cents, q.discount_type, q.discount_value, q.discount_cents,
    v_tax_label, v_tax_rate, v_tax_cents,
    coalesce(q.subtotal_cents, 0) - coalesce(q.discount_cents, 0) + coalesce(v_tax_cents, 0),
    q.currency, q.notes, q.internal_notes, q.contract_disclaimer,
    q.deposit_required, q.deposit_type, q.deposit_value, q.deposit_cents, q.require_payment_method,
    null, q.source_template_name, q.layout_type, q.quote_type, q.service_plan, null
  )
  returning id, quote_number into v_id, v_numero;

  insert into public.quote_line_items (
    quote_id, org_id, source_service_id, name, description, quantity, unit_price_cents, total_cents,
    sort_order, is_optional, item_type, image_url, discount_type, discount_value
  )
  select v_id, p_cible, l.source_service_id, l.name, l.description, l.quantity, l.unit_price_cents, l.total_cents,
         l.sort_order, l.is_optional, l.item_type, l.image_url, l.discount_type, l.discount_value
    from public.quote_line_items l where l.quote_id = p_quote;

  insert into public.quote_sections (quote_id, section_type, title, content, sort_order, enabled)
  select v_id, s.section_type, s.title, s.content, s.sort_order, s.enabled
    from public.quote_sections s where s.quote_id = p_quote;

  update public.quotes set status = 'archived', archived_at = now(), updated_at = now() where id = p_quote;

  select o.company_group_id into v_groupe from public.orgs o where o.id = p_cible;
  insert into public.transferts_bureaux (company_group_id, entite, org_source, id_source, org_cible, id_cible, fait_par, details)
  values (v_groupe, 'quote', q.org_id, p_quote, p_cible, v_id, p_uid,
          jsonb_build_object('numero_source', q.quote_number, 'numero_cible', v_numero, 'taxes', v_taxes));

  return jsonb_build_object('id_cible', v_id, 'numero', v_numero, 'taxes', v_taxes);
end;
$function$;

create or replace function public._transferer_job(p_job uuid, p_cible uuid, p_uid uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  j record;
  v_id uuid;
  v_numero text;
  v_visites int;
  v_groupe uuid;
begin
  select * into j from public.jobs where id = p_job;
  if j.status not in ('draft', 'scheduled') then
    raise exception 'Seul un job en brouillon ou planifié peut être transféré.' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoices i
              where i.job_id = p_job and i.deleted_at is null and coalesce(i.status, '') <> 'void') then
    raise exception 'Ce job est déjà facturé : une facture ne change jamais de bureau.' using errcode = '22023';
  end if;

  insert into public.jobs (
    org_id, title, client_id, client_name, property_address, scheduled_at, status, currency, job_type,
    notes, description, address, latitude, longitude, start_at, end_at, requires_invoicing,
    deposit_required, deposit_type, deposit_value, deposit_cents, require_payment_method,
    tags, ask_for_review, salesperson_id, assigned_user_id, lead_id, tax_lines, billing_split,
    billing_mode, auto_charge, expenses_cents, created_by
  ) values (
    p_cible, j.title,
    public._client_dans_bureau(j.client_id, p_cible, p_uid),
    j.client_name, j.property_address, j.scheduled_at, j.status, j.currency, j.job_type,
    j.notes, j.description, j.address, j.latitude, j.longitude, j.start_at, j.end_at, j.requires_invoicing,
    j.deposit_required, j.deposit_type, j.deposit_value, j.deposit_cents, j.require_payment_method,
    j.tags, j.ask_for_review,
    public._membre_actif_ou_nul(j.salesperson_id, p_cible),
    public._membre_actif_ou_nul(j.assigned_user_id, p_cible),
    public._client_dans_bureau(j.lead_id, p_cible, p_uid),
    j.tax_lines, j.billing_split, j.billing_mode, j.auto_charge, j.expenses_cents, p_uid
  )
  returning id, job_number into v_id, v_numero;

  insert into public.job_line_items (org_id, job_id, name, qty, unit_price_cents, included, visit_date, description, created_by)
  select p_cible, v_id, l.name, l.qty, l.unit_price_cents, l.included, l.visit_date, l.description, p_uid
    from public.job_line_items l where l.job_id = p_job and l.deleted_at is null;

  insert into public.schedule_events (org_id, job_id, title, start_time, end_time, assigned_user, notes, status, timezone, start_at, end_at, created_by)
  select p_cible, v_id, e.title, e.start_time, e.end_time, public._membre_actif_ou_nul(e.assigned_user, p_cible),
         e.notes, e.status, e.timezone, e.start_at, e.end_at, p_uid
    from public.schedule_events e
   where e.job_id = p_job and e.deleted_at is null and coalesce(e.end_time, e.start_time) >= now();
  get diagnostics v_visites = row_count;

  -- L'original : retiré du calendrier (visites futures) et archivé.
  update public.schedule_events set deleted_at = now()
   where job_id = p_job and deleted_at is null and coalesce(end_time, start_time) >= now();
  update public.jobs set archived_at = now(), updated_at = now() where id = p_job;

  select o.company_group_id into v_groupe from public.orgs o where o.id = p_cible;
  insert into public.transferts_bureaux (company_group_id, entite, org_source, id_source, org_cible, id_cible, fait_par, details)
  values (v_groupe, 'job', j.org_id, p_job, p_cible, v_id, p_uid,
          jsonb_build_object('numero_source', j.job_number, 'numero_cible', v_numero, 'visites', v_visites));

  return jsonb_build_object('id_cible', v_id, 'numero', v_numero, 'visites', v_visites);
end;
$function$;

-- 3. Point d'entrée ─────────────────────────────────────────────────

create or replace function public.transferer_vers_bureau(p_entite text, p_id uuid, p_org_cible uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_src uuid;
  v_archive boolean;
  v_client_cible uuid;
  v_res jsonb;
  v_devis int := 0;
  v_jobs int := 0;
  r record;
  v_entete text;
begin
  if v_uid is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if p_entite not in ('client', 'quote', 'job') then
    raise exception 'Type inconnu : %', p_entite using errcode = '22023';
  end if;

  if p_entite = 'client' then
    select org_id into v_src from public.clients where id = p_id and deleted_at is null and archived_at is null;
  elsif p_entite = 'quote' then
    select org_id into v_src from public.quotes where id = p_id and deleted_at is null and archived_at is null;
  else
    select org_id into v_src from public.jobs where id = p_id and deleted_at is null and archived_at is null;
  end if;
  if v_src is null then
    raise exception 'Introuvable (ou déjà archivé).' using errcode = 'P0002';
  end if;
  if v_src = p_org_cible then
    raise exception 'C''est déjà le bureau de cet élément.' using errcode = '22023';
  end if;
  if (select company_group_id from public.orgs where id = v_src)
     is distinct from (select company_group_id from public.orgs where id = p_org_cible and deleted_at is null) then
    raise exception 'Le bureau cible n''appartient pas à la même entreprise.' using errcode = '42501';
  end if;
  if not (public.has_org_admin_role(v_uid, v_src) and public.has_org_admin_role(v_uid, p_org_cible)) then
    raise exception 'Il faut être administrateur ou propriétaire des deux bureaux.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('transfert:' || p_id::text, 0));

  -- Bureau courant = bureau CIBLE pendant la copie (voir l'en-tête du fichier).
  v_entete := current_setting('request.headers', true);
  perform set_config('request.headers',
    (coalesce(nullif(v_entete, ''), '{}')::jsonb || jsonb_build_object('x-lume-org', p_org_cible::text, 'x-org-id', p_org_cible::text))::text,
    true);

  if p_entite = 'quote' then
    v_res := public._transferer_devis(p_id, p_org_cible, v_uid) || jsonb_build_object('entite', 'quote');
    perform set_config('request.headers', coalesce(v_entete, ''), true);
    return v_res;
  elsif p_entite = 'job' then
    v_res := public._transferer_job(p_id, p_org_cible, v_uid) || jsonb_build_object('entite', 'job');
    perform set_config('request.headers', coalesce(v_entete, ''), true);
    return v_res;
  end if;

  -- Client : copie, puis ses soumissions ouvertes et ses jobs non facturés.
  v_client_cible := public._client_dans_bureau(p_id, p_org_cible, v_uid);
  for r in
    select q.id from public.quotes q
     where q.org_id = v_src and (q.client_id = p_id or q.lead_id = p_id)
       and q.deleted_at is null and q.archived_at is null
       and q.status in ('draft', 'awaiting_response', 'changes_requested')
  loop
    perform public._transferer_devis(r.id, p_org_cible, v_uid);
    v_devis := v_devis + 1;
  end loop;
  for r in
    select jb.id from public.jobs jb
     where jb.org_id = v_src and (jb.client_id = p_id or jb.lead_id = p_id)
       and jb.deleted_at is null and jb.archived_at is null
       and jb.status in ('draft', 'scheduled')
       and not exists (select 1 from public.invoices i
                        where i.job_id = jb.id and i.deleted_at is null and coalesce(i.status, '') <> 'void')
  loop
    perform public._transferer_job(r.id, p_org_cible, v_uid);
    v_jobs := v_jobs + 1;
  end loop;

  -- La fiche d'origine reste active si elle porte des factures (suivi des paiements).
  v_archive := not exists (select 1 from public.invoices i where i.client_id = p_id and i.deleted_at is null);
  if v_archive then
    update public.clients set archived_at = now(), archived_by = v_uid, updated_at = now() where id = p_id;
  end if;
  update public.transferts_bureaux
     set details = details - 'copie_liee' || jsonb_build_object('transfert', true, 'devis', v_devis, 'jobs', v_jobs, 'origine_archivee', v_archive)
   where entite = 'client' and id_source = p_id and id_cible = v_client_cible;

  v_res := jsonb_build_object('entite', 'client', 'id_cible', v_client_cible,
    'numero', (select client_number from public.clients where id = v_client_cible),
    'devis', v_devis, 'jobs', v_jobs, 'origine_archivee', v_archive);
  perform set_config('request.headers', coalesce(v_entete, ''), true);
  return v_res;
end;
$function$;

revoke all on function public._membre_actif_ou_nul(uuid, uuid) from public, anon, authenticated;
revoke all on function public._taxe_defaut_bureau(uuid) from public, anon, authenticated;
revoke all on function public._client_dans_bureau(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._transferer_devis(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._transferer_job(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.transferer_vers_bureau(text, uuid, uuid) from public, anon;
grant execute on function public.transferer_vers_bureau(text, uuid, uuid) to authenticated;
