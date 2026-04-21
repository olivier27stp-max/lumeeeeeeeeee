-- =====================================================================
-- Data Subject Rights (DSR) + Consents — 2026-04-21
-- Bloc 2 : RGPD art. 15/17/20, Loi 25 art. 27-28.1, LPRPDE 12.1
--
-- Tables :
--   - consents              : journal versionné des consentements
--   - dsar_requests         : registre des demandes d'accès/effacement
-- RPCs :
--   - record_consent        : écrit une entrée de consentement (audit trail)
--   - anonymize_client      : anonymisation d'un client (tombstone pattern)
--   - anonymize_lead        : anonymisation d'un lead
--   - export_user_data      : agrégation complète des PII d'un utilisateur
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table consents — journal versionné (horodatage, version doc, IP, UA)
-- ---------------------------------------------------------------------
create table if not exists public.consents (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references public.orgs(id) on delete cascade,
  subject_type  text not null check (subject_type in ('user','client','lead')),
  subject_id    uuid not null,
  -- Type de consentement : cookies-essential, cookies-analytics, cookies-marketing,
  -- email-marketing, sms-marketing, profiling, tos, privacy-policy, dpa
  purpose       text not null,
  granted       boolean not null,
  doc_version   text,                          -- ex: "privacy-2026-04-21"
  doc_url       text,
  ip_address    inet,
  user_agent    text,
  method        text,                          -- 'web-banner', 'email-link', 'admin', 'api'
  created_at    timestamptz not null default now()
);

create index if not exists idx_consents_subject on public.consents(subject_type, subject_id, purpose, created_at desc);
create index if not exists idx_consents_org on public.consents(org_id, created_at desc);

alter table public.consents enable row level security;

-- Un utilisateur voit son propre historique + l'org voit les consentements de ses clients/leads
drop policy if exists consents_select_own on public.consents;
create policy consents_select_own on public.consents for select
  using (
    (subject_type = 'user' and subject_id = auth.uid())
    or (org_id is not null and public.has_org_membership(auth.uid(), org_id))
  );

-- Seul service_role insère (via RPC record_consent) ou l'utilisateur pour lui-même
drop policy if exists consents_insert_self on public.consents;
create policy consents_insert_self on public.consents for insert
  with check (
    (subject_type = 'user' and subject_id = auth.uid())
    or (org_id is not null and public.has_org_membership(auth.uid(), org_id))
  );

-- Les consentements ne se modifient pas, ils se révoquent par une nouvelle entrée granted=false
-- Pas de DELETE/UPDATE policies → immuabilité du journal

-- ---------------------------------------------------------------------
-- 2. Table dsar_requests — traçabilité des demandes
-- ---------------------------------------------------------------------
create table if not exists public.dsar_requests (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.orgs(id) on delete cascade,
  subject_type    text not null check (subject_type in ('user','client','lead')),
  subject_id      uuid not null,
  request_type    text not null check (request_type in ('access','erasure','rectification','portability','objection','restriction')),
  status          text not null default 'pending' check (status in ('pending','in_progress','completed','rejected')),
  requested_by    uuid references auth.users(id),
  requester_ip    inet,
  justification   text,
  response_url    text,                        -- lien vers export si access/portability
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_dsar_org_status on public.dsar_requests(org_id, status, created_at desc);
create index if not exists idx_dsar_subject on public.dsar_requests(subject_type, subject_id);

alter table public.dsar_requests enable row level security;

drop policy if exists dsar_select_org on public.dsar_requests;
create policy dsar_select_org on public.dsar_requests for select
  using (public.has_org_membership(auth.uid(), org_id));

drop policy if exists dsar_insert_self on public.dsar_requests;
create policy dsar_insert_self on public.dsar_requests for insert
  with check (
    requested_by = auth.uid()
    or public.has_org_membership(auth.uid(), org_id)
  );

drop policy if exists dsar_update_admin on public.dsar_requests;
create policy dsar_update_admin on public.dsar_requests for update
  using (public.has_org_membership(auth.uid(), org_id))
  with check (public.has_org_membership(auth.uid(), org_id));

-- ---------------------------------------------------------------------
-- 3. RPC record_consent — insertion uniforme
-- ---------------------------------------------------------------------
create or replace function public.record_consent(
  p_subject_type text,
  p_subject_id   uuid,
  p_purpose      text,
  p_granted      boolean,
  p_doc_version  text default null,
  p_doc_url      text default null,
  p_ip           inet default null,
  p_user_agent   text default null,
  p_method       text default 'api',
  p_org_id       uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.consents(org_id, subject_type, subject_id, purpose, granted, doc_version, doc_url, ip_address, user_agent, method)
  values (p_org_id, p_subject_type, p_subject_id, p_purpose, p_granted, p_doc_version, p_doc_url, p_ip, p_user_agent, p_method)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.record_consent(text,uuid,text,boolean,text,text,inet,text,text,uuid) from public;
grant execute on function public.record_consent(text,uuid,text,boolean,text,text,inet,text,text,uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. RPC anonymize_client — tombstone pattern (RGPD art. 17, Loi 25 art. 28.1)
--    Conserve l'intégrité relationnelle (FK jobs/invoices) mais efface les PII.
-- ---------------------------------------------------------------------
create or replace function public.anonymize_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_caller_has_access boolean;
begin
  select org_id into v_org from public.clients where id = p_client_id;
  if v_org is null then
    raise exception 'Client not found';
  end if;

  v_caller_has_access := public.has_org_admin_role(auth.uid(), v_org);
  if not v_caller_has_access then
    raise exception 'Only org admin/owner can anonymize clients';
  end if;

  update public.clients
     set first_name       = 'ANONYMIZED',
         last_name        = '',
         company          = null,
         email            = null,
         phone            = null,
         address          = null,
         address_line1    = null,
         address_line2    = null,
         city             = null,
         province         = null,
         postal_code      = null,
         country          = null,
         sms_consent_at   = null,
         deleted_at       = coalesce(deleted_at, now()),
         updated_at       = now()
   where id = p_client_id;

  -- Tombstone sur contacts lié (si 1:1)
  update public.contacts
     set full_name = 'ANONYMIZED',
         email     = null,
         phone     = null,
         address_line1 = null,
         address_line2 = null,
         city = null,
         province = null,
         postal_code = null,
         country = null
   where id = (select contact_id from public.clients where id = p_client_id);

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'anonymize', 'client', p_client_id, jsonb_build_object('method','dsr_erasure'));
end $$;

revoke all on function public.anonymize_client(uuid) from public;
grant execute on function public.anonymize_client(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. RPC anonymize_lead — idem pour leads
-- ---------------------------------------------------------------------
create or replace function public.anonymize_lead(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.leads where id = p_lead_id;
  if v_org is null then
    raise exception 'Lead not found';
  end if;

  if not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can anonymize leads';
  end if;

  update public.leads
     set first_name = 'ANONYMIZED',
         last_name  = '',
         title      = null,
         company    = null,
         email      = null,
         phone      = null,
         address    = null,
         notes      = null,
         tags       = array[]::text[],
         deleted_at = coalesce(deleted_at, now()),
         updated_at = now()
   where id = p_lead_id;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'anonymize', 'lead', p_lead_id, jsonb_build_object('method','dsr_erasure'));
end $$;

revoke all on function public.anonymize_lead(uuid) from public;
grant execute on function public.anonymize_lead(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. RPC export_user_data — agrégation complète pour DSR access/portability
--    Retourne un JSONB structuré avec toutes les données liées à un user.
-- ---------------------------------------------------------------------
create or replace function public.export_user_data(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_result jsonb;
begin
  -- Un user exporte ses propres données, ou un admin org l'exporte pour un membre
  if v_caller is null then
    raise exception 'Authentication required';
  end if;

  if v_caller != p_user_id then
    -- Vérifier que le caller est admin d'une org partagée
    if not exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m1.org_id = m2.org_id
      where m1.user_id = v_caller
        and m2.user_id = p_user_id
        and public.has_org_admin_role(v_caller, m1.org_id)
    ) then
      raise exception 'Not authorized to export this user data';
    end if;
  end if;

  select jsonb_build_object(
    'exported_at',       now(),
    'user_id',           p_user_id,
    'profile',           (select to_jsonb(p) from public.profiles p where p.id = p_user_id),
    'memberships',       (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from public.memberships m where m.user_id = p_user_id),
    'consents',          (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]'::jsonb) from public.consents c where c.subject_type = 'user' and c.subject_id = p_user_id),
    'audit_events_as_actor', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]'::jsonb) from public.audit_events a where a.actor_id = p_user_id),
    'dsar_requests',     (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at), '[]'::jsonb) from public.dsar_requests d where d.requested_by = p_user_id or (d.subject_type='user' and d.subject_id = p_user_id))
  ) into v_result;

  -- Log l'export
  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, v_caller, 'dsr_export', 'user', p_user_id, jsonb_build_object('requested_by', v_caller));

  return v_result;
end $$;

revoke all on function public.export_user_data(uuid) from public;
grant execute on function public.export_user_data(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. RPC export_client_data — pareil mais pour un client final
-- ---------------------------------------------------------------------
create or replace function public.export_client_data(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_result jsonb;
begin
  select org_id into v_org from public.clients where id = p_client_id;
  if v_org is null then
    raise exception 'Client not found';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not authorized';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'client_id',   p_client_id,
    'client',      (select to_jsonb(c) from public.clients c where c.id = p_client_id),
    'contact',     (select to_jsonb(co) from public.contacts co where co.id = (select contact_id from public.clients where id = p_client_id)),
    'jobs',        (select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from public.jobs j where j.client_id = p_client_id),
    'invoices',    (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.invoices i where i.client_id = p_client_id),
    'payments',    (select coalesce(jsonb_agg(to_jsonb(pm)), '[]'::jsonb) from public.payments pm where pm.client_id = p_client_id),
    'consents',    (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.consents c where c.subject_type='client' and c.subject_id = p_client_id)
  ) into v_result;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'dsr_export', 'client', p_client_id, '{}'::jsonb);

  return v_result;
end $$;

revoke all on function public.export_client_data(uuid) from public;
grant execute on function public.export_client_data(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- DOWN (manuel)
-- ---------------------------------------------------------------------
-- drop function if exists public.export_client_data(uuid);
-- drop function if exists public.export_user_data(uuid);
-- drop function if exists public.anonymize_lead(uuid);
-- drop function if exists public.anonymize_client(uuid);
-- drop function if exists public.record_consent(text,uuid,text,boolean,text,text,inet,text,text,uuid);
-- drop table if exists public.dsar_requests;
-- drop table if exists public.consents;
