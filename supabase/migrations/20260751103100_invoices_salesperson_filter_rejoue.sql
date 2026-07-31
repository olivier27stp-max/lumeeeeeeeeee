-- ############################################################################
-- RENOMMEE ET CORRIGEE LE 2026-07-31 — lire ceci avant de la rejouer
-- ############################################################################
--
-- Cette migration s'appelait 20260717000000_invoices_salesperson_filter.sql et
-- N'A JAMAIS ETE APPLIQUEE, pendant deux semaines, sans que personne le sache.
--
-- CAUSE : elle partageait son horodatage 20260717000000 avec
-- 20260717000000_team_members_birth_date.sql. Or ce prefixe a 14 chiffres est
-- la CLE PRIMAIRE du registre supabase_migrations.schema_migrations : des deux,
-- une seule pouvait etre enregistree. birth_date a gagne, le filtre vendeur a
-- ete perdu en silence.
--
-- C'est la preuve concrete que les 25 collisions d'horodatage du dossier ne
-- sont pas un probleme theorique : celle-ci a coute une fonctionnalite
-- utilisateur (filtrer les factures par vendeur) pendant deux semaines.
-- Verifie : le registre ne compte que 250 versions pour 353 fichiers.
--
-- Renommee ici avec un horodatage unique pour qu'elle soit enfin enregistrable.
--
-- ⚠️ ELLE CONTENAIT AUSSI UN DEFAUT, corrige plus bas : ecrite le 17 juillet,
-- elle referencait payments.card_last4 et payments.card_brand, colonnes
-- disparues du schema depuis. L'appliquer telle quelle cassait la liste des
-- factures en ERROR 42703. C'est arrive en production le 2026-07-31 a 14:58,
-- et a ete corrige a 15:02 — la lecon est notee dans docs/operations :
-- rejouer une vieille migration exige de verifier que TOUTES ses references
-- existent encore.
--
-- Verifie apres correction, en simulant un membre authentifie :
--   liste normale (9 arguments)      -> 5 factures
--   filtre vendeur (10 arguments)    -> repond correctement
-- ############################################################################

-- ════════════════════════════════════════════════════════════════
-- Invoices — salesperson assignment + salesperson filter
--
--  1. Add invoices.salesperson_id (backfilled from the linked job).
--  2. Redefine rpc_list_invoices with a new p_salesperson parameter.
--     The filter matches coalesce(invoice.salesperson_id, job.salesperson_id)
--     so invoices inherit their job's salesperson when not set directly.
--
--  NOTE: the parameter list changes (9 → 10 args), so the old signature
--  must be dropped first — otherwise PostgREST sees two overloads and
--  rejects every call with PGRST203.
--
--  Apply with: npx tsx scripts/apply-sql.ts supabase/migrations/20260717000000_invoices_salesperson_filter.sql
-- ════════════════════════════════════════════════════════════════

begin;

-- ─── 1. Salesperson column on invoices ─────────────────────────
alter table public.invoices add column if not exists salesperson_id uuid;
create index if not exists invoices_salesperson_id_idx on public.invoices (salesperson_id);

comment on column public.invoices.salesperson_id is
  'Directly assigned salesperson; when null the linked job''s salesperson applies';

update public.invoices i
set salesperson_id = j.salesperson_id
from public.jobs j
where j.id = i.job_id
  and i.salesperson_id is null
  and j.salesperson_id is not null;

-- ─── 2. rpc_list_invoices with p_salesperson ───────────────────
drop function if exists public.rpc_list_invoices(text, text, text, text, integer, integer, date, date, uuid);

create or replace function public.rpc_list_invoices(
  p_status text default 'all',
  p_range text default 'all',
  p_q text default null,
  p_sort text default 'due_date_desc',
  p_limit integer default 25,
  p_offset integer default 0,
  p_from date default null,
  p_to date default null,
  p_org uuid default null,
  p_salesperson uuid default null
)
returns table (
  id uuid,
  client_id uuid,
  client_name text,
  invoice_number text,
  status text,
  subject text,
  issued_at timestamptz,
  due_date date,
  total_cents integer,
  balance_cents integer,
  paid_cents integer,
  created_at timestamptz,
  updated_at timestamptz,
  property_id uuid,
  job_id uuid,
  site text,
  quote_number text,
  payer_name text,
  payment_method text,
  provider text,
  card_last4 text,
  card_brand text,
  payment_id uuid,
  total_count bigint
)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_org uuid;
  v_status text := lower(coalesce(p_status, 'all'));
  v_range text := lower(coalesce(p_range, 'all'));
  v_sort text := lower(coalesce(p_sort, 'due_date_desc'));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  v_org := coalesce(p_org, public.current_org_id());
  if v_org is null then
    raise exception 'Unable to resolve org_id';
  end if;

  if not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not allowed for this organization';
  end if;

  return query
  with base as (
    select
      i.id,
      i.client_id,
      coalesce(
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), ''),
        'Unknown client'
      ) as client_name,
      i.invoice_number,
      i.status,
      i.subject,
      i.issued_at,
      i.due_date,
      i.total_cents,
      i.balance_cents,
      i.paid_cents,
      i.created_at,
      i.updated_at,
      i.property_id,
      i.job_id,
      coalesce(nullif(trim(prop.address), ''), prop.name) as site,
      lq.quote_number,
      coalesce(
        nullif(trim(concat_ws(' ', pc.first_name, pc.last_name)), ''),
        nullif(trim(pc.company), ''),
        nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
        nullif(trim(c.company), '')
      ) as payer_name,
      lp.method as payment_method,
      lp.provider,
      lp.card_last4,
      lp.card_brand,
      lp.id as payment_id,
      coalesce(i.issued_at::date, i.created_at::date) as reference_date,
      coalesce(i.salesperson_id, ij.salesperson_id) as effective_salesperson_id
    from public.invoices i
    left join public.clients c on c.id = i.client_id
    left join public.jobs ij on ij.id = i.job_id
    -- latest succeeded payment for this invoice (limit 1 → no row fan-out)
    left join lateral (
      -- CORRIGE 2026-07-31 : cette migration, ecrite le 17 juillet, referencait
      -- payments.card_last4 et payments.card_brand. Ces deux colonnes n'existent
      -- plus (seul `method` subsiste). Appliquee telle quelle, elle produisait
      -- ERROR 42703 sur CHAQUE appel — la liste des factures ne repondait plus.
      -- On garde les colonnes dans la sortie, toujours nulles, pour ne pas
      -- changer la forme du resultat attendue par le client.
      select p.id, p.method, p.provider,
             null::text as card_last4, null::text as card_brand,
             p.client_id
      from public.payments p
      where p.invoice_id = i.id
        and p.org_id = v_org
        and p.status = 'succeeded'
        and p.deleted_at is null
      order by coalesce(p.paid_at, p.payment_date, p.created_at) desc
      limit 1
    ) lp on true
    left join public.clients pc on pc.id = lp.client_id and pc.org_id = v_org
    left join public.properties prop on prop.id = i.property_id and prop.org_id = v_org
    -- quote number via quotes.job_id → invoices.job_id
    left join lateral (
      select q.quote_number
      from public.quotes q
      where q.job_id = i.job_id
        and q.org_id = v_org
        and q.deleted_at is null
      order by q.created_at desc
      limit 1
    ) lq on true
    where i.org_id = v_org
      and i.deleted_at is null
      and (c.id is null or c.org_id = v_org)
  ),
  filtered as (
    select *
    from base b
    where
      (
        v_status = 'all'
        or (v_status = 'draft' and b.status = 'draft')
        or (v_status = 'paid' and b.status = 'paid')
        or (
          v_status = 'past_due'
          and b.status in ('sent', 'partial')
          and b.balance_cents > 0
          and b.due_date < current_date
        )
        or (
          v_status = 'sent_not_due'
          and b.status in ('sent', 'partial')
          and b.balance_cents > 0
          and b.due_date >= current_date
        )
      )
      and (p_salesperson is null or b.effective_salesperson_id = p_salesperson)
      and (
        v_range = 'all'
        or (v_range = '30d' and b.reference_date >= (current_date - interval '30 days')::date)
        or (v_range = 'this_month' and date_trunc('month', b.reference_date) = date_trunc('month', current_date))
        or (
          v_range = 'custom'
          and (p_from is null or b.reference_date >= p_from)
          and (p_to is null or b.reference_date <= p_to)
        )
      )
      and (
        v_q is null
        or b.client_name ilike ('%' || v_q || '%')
        or b.invoice_number ilike ('%' || v_q || '%')
        or coalesce(b.subject, '') ilike ('%' || v_q || '%')
      )
  )
  select
    f.id,
    f.client_id,
    f.client_name,
    f.invoice_number,
    f.status,
    f.subject,
    f.issued_at,
    f.due_date,
    f.total_cents,
    f.balance_cents,
    f.paid_cents,
    f.created_at,
    f.updated_at,
    f.property_id,
    f.job_id,
    f.site,
    f.quote_number,
    f.payer_name,
    f.payment_method,
    f.provider,
    f.card_last4,
    f.card_brand,
    f.payment_id,
    count(*) over() as total_count
  from filtered f
  order by
    case when v_sort = 'client_asc' then lower(f.client_name) end asc nulls last,
    case when v_sort = 'client_desc' then lower(f.client_name) end desc nulls last,
    case when v_sort = 'invoice_number_asc' then f.invoice_number end asc nulls last,
    case when v_sort = 'invoice_number_desc' then f.invoice_number end desc nulls last,
    case when v_sort = 'due_date_asc' then f.due_date end asc nulls last,
    case when v_sort = 'due_date_desc' then f.due_date end desc nulls last,
    case when v_sort = 'status_asc' then f.status end asc nulls last,
    case when v_sort = 'status_desc' then f.status end desc nulls last,
    case when v_sort = 'total_asc' then f.total_cents end asc nulls last,
    case when v_sort = 'total_desc' then f.total_cents end desc nulls last,
    case when v_sort = 'balance_asc' then f.balance_cents end asc nulls last,
    case when v_sort = 'balance_desc' then f.balance_cents end desc nulls last,
    f.created_at desc
  limit v_limit
  offset v_offset;
end;
$fn$;

grant execute on function public.rpc_list_invoices(text, text, text, text, integer, integer, date, date, uuid, uuid) to authenticated, service_role;

commit;
