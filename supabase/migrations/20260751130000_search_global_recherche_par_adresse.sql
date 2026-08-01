-- ============================================================================
-- FIX recherche par adresse — search_global (2026-08-01)
-- ============================================================================
-- La recherche globale ne trouvait plus les clients/leads par ADRESSE.
-- Cause : la fonction search_global en prod avait DERIVE du code source (le
-- corps deploye ne matchait que first_name/last_name/company/email/phone, sans
-- `address`). Cette derive est celle flaggee par l'audit (C2-01) — vecteur
-- probable : l'ancien scripts/deploy-functions.mjs (supprime) qui redeployait
-- des fonctions extraites du complete_schema.sql perime.
--
-- Ce fichier fige en source la definition EXACTE actuellement en prod, corrigee :
-- ajout de `or c.address ilike (select pat from q)` dans les DEUX blocs
-- (client_hits: status <> 'lead', et lead_hits: status = 'lead').
-- search_path='' et qualification public. preserves. Idempotent (CREATE OR REPLACE).
-- Verifie : 5/5 enregistrements retrouves par un mot de leur adresse.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_global(p_org uuid, p_q text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS TABLE(entity_type text, entity_id uuid, title text, subtitle text, extra_status text, extra_amount_cents bigint, extra_currency text, extra_date timestamp with time zone, extra_client_id uuid, extra_client_name text, created_at timestamp with time zone, rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with q as (
    select '%' || p_q || '%' as pat
  ),

  -- Clients (status = 'active' or 'inactive')
  client_hits as (
    select
      'client'::text                                       as entity_type,
      c.id                                                 as entity_id,
      coalesce(c.first_name || ' ' || c.last_name,
               c.company,
               'Unnamed Client')                           as title,
      coalesce(c.email, c.phone, '')                       as subtitle,
      c.status::text                                       as extra_status,
      null::bigint                                         as extra_amount_cents,
      null::text                                           as extra_currency,
      null::timestamptz                                    as extra_date,
      null::uuid                                           as extra_client_id,
      null::text                                           as extra_client_name,
      c.created_at,
      case
        when (c.first_name || ' ' || c.last_name) ilike (select pat from q) then 1
        when c.company ilike (select pat from q) then 2
        when c.email   ilike (select pat from q) then 3
        when c.phone   ilike (select pat from q) then 4
        else 5
      end                                                  as rank
    from public.clients c
    where c.org_id = p_org
      and c.deleted_at is null
      and c.status <> 'lead'
      and (
           (c.first_name || ' ' || c.last_name) ilike (select pat from q)
        or c.company ilike (select pat from q)
        or c.email   ilike (select pat from q)
        or c.phone   ilike (select pat from q)
        or c.address ilike (select pat from q)
      )
  ),

  -- Leads (clients with status = 'lead')
  lead_hits as (
    select
      'lead'::text                                         as entity_type,
      c.id                                                 as entity_id,
      coalesce(c.first_name || ' ' || c.last_name,
               c.company,
               'Unnamed Lead')                             as title,
      coalesce(c.email, c.phone, '')                       as subtitle,
      c.status::text                                       as extra_status,
      null::bigint                                         as extra_amount_cents,
      null::text                                           as extra_currency,
      null::timestamptz                                    as extra_date,
      null::uuid                                           as extra_client_id,
      null::text                                           as extra_client_name,
      c.created_at,
      case
        when (c.first_name || ' ' || c.last_name) ilike (select pat from q) then 1
        when c.company ilike (select pat from q) then 2
        when c.email   ilike (select pat from q) then 3
        when c.phone   ilike (select pat from q) then 4
        else 5
      end                                                  as rank
    from public.clients c
    where c.org_id = p_org
      and c.deleted_at is null
      and c.status = 'lead'
      and (
           (c.first_name || ' ' || c.last_name) ilike (select pat from q)
        or c.company ilike (select pat from q)
        or c.email   ilike (select pat from q)
        or c.phone   ilike (select pat from q)
        or c.address ilike (select pat from q)
      )
  ),

  -- Jobs
  job_hits as (
    select
      'job'::text                                          as entity_type,
      j.id                                                 as entity_id,
      j.title                                              as title,
      coalesce(j.job_number, '')                            as subtitle,
      j.status::text                                       as extra_status,
      j.total_cents::bigint                                as extra_amount_cents,
      j.currency                                           as extra_currency,
      j.scheduled_at                                       as extra_date,
      j.client_id                                          as extra_client_id,
      j.client_name                                        as extra_client_name,
      j.created_at,
      case
        when j.title      ilike (select pat from q) then 1
        when j.job_number  ilike (select pat from q) then 2
        when j.client_name ilike (select pat from q) then 3
        when j.description ilike (select pat from q) then 4
        else 5
      end                                                  as rank
    from public.jobs j
    where j.org_id = p_org
      and j.deleted_at is null
      and (
           j.title       ilike (select pat from q)
        or j.job_number   ilike (select pat from q)
        or j.client_name  ilike (select pat from q)
        or j.description  ilike (select pat from q)
      )
  ),

  -- Quotes
  quote_hits as (
    select
      'quote'::text                                        as entity_type,
      qu.id                                                as entity_id,
      qu.title                                             as title,
      coalesce(qu.quote_number, '')                         as subtitle,
      qu.status::text                                      as extra_status,
      qu.total_cents::bigint                               as extra_amount_cents,
      qu.currency                                          as extra_currency,
      qu.valid_until::timestamptz                             as extra_date,
      qu.client_id                                         as extra_client_id,
      null::text                                           as extra_client_name,
      qu.created_at,
      case
        when qu.title        ilike (select pat from q) then 1
        when qu.quote_number ilike (select pat from q) then 2
        when qu.notes        ilike (select pat from q) then 3
        else 5
      end                                                  as rank
    from public.quotes qu
    where qu.org_id = p_org
      and qu.deleted_at is null
      and (
           qu.title        ilike (select pat from q)
        or qu.quote_number ilike (select pat from q)
        or qu.notes        ilike (select pat from q)
      )
  ),

  -- Invoices
  invoice_hits as (
    select
      'invoice'::text                                      as entity_type,
      inv.id                                               as entity_id,
      coalesce(inv.subject, 'Invoice ' || inv.invoice_number) as title,
      coalesce(inv.invoice_number, '')                      as subtitle,
      inv.status::text                                     as extra_status,
      inv.total_cents::bigint                              as extra_amount_cents,
      inv.currency                                         as extra_currency,
      inv.due_date::timestamptz                              as extra_date,
      inv.client_id                                        as extra_client_id,
      null::text                                           as extra_client_name,
      inv.created_at,
      case
        when inv.subject        ilike (select pat from q) then 1
        when inv.invoice_number ilike (select pat from q) then 2
        when inv.notes          ilike (select pat from q) then 3
        else 5
      end                                                  as rank
    from public.invoices inv
    where inv.org_id = p_org
      and inv.deleted_at is null
      and (
           inv.subject        ilike (select pat from q)
        or inv.invoice_number ilike (select pat from q)
        or inv.notes          ilike (select pat from q)
      )
  ),

  -- Union all results
  combined as (
    select * from client_hits
    union all
    select * from lead_hits
    union all
    select * from job_hits
    union all
    select * from quote_hits
    union all
    select * from invoice_hits
  )

  select * from combined
  order by rank asc, created_at desc
  limit p_limit
  offset p_offset;
$function$

