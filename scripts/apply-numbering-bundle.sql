
-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  20260711140000_settings_sharp_numbering_regional.sql
-- ╚══════════════════════════════════════════════════════════════════╝
-- ============================================================
-- Settings "sharp": configurable invoice numbering + org currency
--
-- 1. company_settings.invoice_prefix — the 'INV-' prefix was hardcoded inside
--    invoice_next_number(). Pros migrating from another system want their own
--    prefix (e.g. FAC-) and to continue their sequence.
-- 2. invoice_next_number() now reads the org's prefix (default 'INV-').
-- 3. set_invoice_next_number(org, n) — admin-gated way to (re)start the
--    sequence, e.g. continue at 0433 after migrating.
-- 4. get_invoice_next_number(org) — member-gated read for the settings UI
--    (invoice_sequences itself stays service/definer-only).
-- 5. company_settings.currency — org display currency (CAD default), consumed
--    by the tax preview now, available for wider use.
-- ============================================================

begin;

alter table public.company_settings
  add column if not exists invoice_prefix text not null default 'INV-',
  add column if not exists currency text not null default 'CAD';

-- ── invoice_next_number: same concurrency-safe counter, org-configurable prefix ──
create or replace function public.invoice_next_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_next integer;
  v_prefix text;
begin
  insert into public.invoice_sequences (org_id, last_value)
  values (p_org, 0)
  on conflict (org_id) do nothing;

  update public.invoice_sequences
  set last_value = last_value + 1,
      updated_at = now()
  where org_id = p_org
  returning last_value into v_next;

  select coalesce(nullif(trim(invoice_prefix), ''), 'INV-')
    into v_prefix
    from public.company_settings
   where org_id = p_org
   limit 1;

  return coalesce(v_prefix, 'INV-') || lpad(v_next::text, 6, '0');
end;
$fn$;

-- ── set the NEXT number (admin/owner only) ──
create or replace function public.set_invoice_next_number(p_org uuid, p_next integer)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is not null and not public.has_org_admin_role(auth.uid(), p_org) then
    raise exception 'Only org owners or admins can change invoice numbering.' using errcode = '42501';
  end if;
  if p_next is null or p_next < 1 or p_next > 99999999 then
    raise exception 'Next invoice number must be between 1 and 99999999.';
  end if;

  insert into public.invoice_sequences (org_id, last_value, updated_at)
  values (p_org, p_next - 1, now())
  on conflict (org_id) do update
    set last_value = excluded.last_value,
        updated_at = now();
end;
$fn$;
revoke all on function public.set_invoice_next_number(uuid, integer) from public, anon;
grant execute on function public.set_invoice_next_number(uuid, integer) to authenticated, service_role;

-- ── read the NEXT number (any org member, for the settings UI) ──
create or replace function public.get_invoice_next_number(p_org uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_last integer;
begin
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), p_org) then
    raise exception 'Not a member of this organization.' using errcode = '42501';
  end if;
  select last_value into v_last from public.invoice_sequences where org_id = p_org;
  return coalesce(v_last, 0) + 1;
end;
$fn$;
revoke all on function public.get_invoice_next_number(uuid) from public, anon;
grant execute on function public.get_invoice_next_number(uuid) to authenticated, service_role;

commit;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  20260708000000_jobs_auto_number_per_org.sql
-- ╚══════════════════════════════════════════════════════════════════╝
-- ════════════════════════════════════════════════════════════════════════
-- Numérotation automatique des jobs — par organisation, atomique
-- ════════════════════════════════════════════════════════════════════════
-- Problème résolu :
--   Avant, le job_number était attribué de façon incohérente selon le chemin :
--     • Modal "Nouveau job"      → suggestion côté client (max+1) → race condition
--     • Conversion devis/lead    → NULL (la RPC insère nullif(p_job_number,''))
--     • Agent IA                 → NULL
--     • Pipeline (deal→job)      → défaut DB lpad(nextval(...)) "0001"
--
-- Solution :
--   Un compteur par org + un trigger BEFORE INSERT qui devient la source unique
--   d'attribution. Tous les jobs reçoivent désormais un numéro unique et
--   séquentiel par organisation, peu importe le chemin de création.
--   L'attribution via le compteur est atomique (verrou de ligne sur upsert),
--   ce qui élimine la race condition de l'ancienne suggestion côté client.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Compteur séquentiel par organisation ────────────────────────────────
create table if not exists public.org_job_counters (
  org_id      uuid primary key,
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- Accès direct interdit aux clients : seule la fonction SECURITY DEFINER y écrit.
alter table public.org_job_counters enable row level security;

-- 2. Supprimer le défaut DB (séquence globale) ────────────────────────────
--    Sinon les INSERT qui omettent la colonne (pipeline) recevraient "0001"
--    via nextval() au lieu de passer par le compteur par org.
alter table public.jobs alter column job_number drop default;

-- 3. Fonction d'attribution (atomique, par org) ───────────────────────────
create or replace function public.assign_job_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := coalesce(new.org_id, public.current_org_id());
  v_next bigint;
begin
  -- Pas d'org résolvable : on laisse les autres contraintes décider.
  if v_org is null then
    return new;
  end if;

  -- Numéro fourni explicitement : on le respecte, mais on garde le compteur
  -- en avance pour qu'un futur numéro auto n'entre jamais en collision.
  if new.job_number is not null and btrim(new.job_number) <> '' then
    if new.job_number ~ '^\s*\d+$' then
      insert into public.org_job_counters (org_id, last_number)
      values (v_org, btrim(new.job_number)::bigint)
      on conflict (org_id) do update
        set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
            updated_at  = now();
    end if;
    return new;
  end if;

  -- Attribution séquentielle atomique : l'upsert verrouille la ligne de l'org.
  insert into public.org_job_counters (org_id, last_number)
  values (v_org, 1)
  on conflict (org_id) do update
    set last_number = public.org_job_counters.last_number + 1,
        updated_at  = now()
  returning last_number into v_next;

  new.job_number := v_next::text;
  return new;
end;
$$;

-- 4. Trigger BEFORE INSERT ────────────────────────────────────────────────
--    Nommé "zz" pour s'exécuter APRÈS trg_jobs_enforce_scope (ordre alpha),
--    qui pose new.org_id = current_org_id() pour le contexte authentifié.
drop trigger if exists trg_jobs_zz_assign_number on public.jobs;
create trigger trg_jobs_zz_assign_number
  before insert on public.jobs
  for each row execute function public.assign_job_number();

-- 5. Backfill des jobs existants sans numéro ──────────────────────────────
--    On numérote en continuant à partir du max numérique existant par org,
--    dans l'ordre de création.
with maxes as (
  select org_id,
         coalesce(max(nullif(regexp_replace(job_number, '\D', '', 'g'), '')::bigint), 0) as mx
  from public.jobs
  where job_number is not null and job_number ~ '\d'
  group by org_id
),
to_fill as (
  select j.id, j.org_id,
         row_number() over (partition by j.org_id order by j.created_at nulls first, j.id) as rn
  from public.jobs j
  where j.job_number is null or btrim(j.job_number) = ''
)
update public.jobs j
set job_number = (coalesce(m.mx, 0) + tf.rn)::text
from to_fill tf
left join maxes m on m.org_id = tf.org_id
where j.id = tf.id;

-- 6. (Ré)initialiser le compteur sur le max courant par org ───────────────
insert into public.org_job_counters (org_id, last_number)
select org_id,
       max(nullif(regexp_replace(job_number, '\D', '', 'g'), '')::bigint)
from public.jobs
where job_number is not null and job_number ~ '\d'
group by org_id
on conflict (org_id) do update
  set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
      updated_at  = now();

-- 7. Filet de sécurité : index unique (org_id, job_number) sur les jobs actifs.
--    Tenté en best-effort : si des doublons hérités existent déjà, on log et on
--    continue (le compteur atomique empêche de toute façon les nouveaux doublons).
do $$
begin
  begin
    create unique index if not exists jobs_org_job_number_uniq
      on public.jobs (org_id, job_number)
      where job_number is not null and deleted_at is null;
  exception when others then
    raise notice 'Index jobs_org_job_number_uniq non créé (doublons hérités ?): %', sqlerrm;
  end;
end$$;

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  20260716000000_creation_hub_numbers.sql
-- ╚══════════════════════════════════════════════════════════════════╝
-- ════════════════════════════════════════════════════════════════════════
-- Hub de création — numéros (#) pré-remplis, modifiables et validés
-- ════════════════════════════════════════════════════════════════════════
-- Objectif :
--   Dans la section principale de chaque formulaire de création (job,
--   soumission, facture), le # est pré-rempli avec le prochain numéro de la
--   séquence de l'org. L'utilisateur peut le modifier, mais ne peut pas
--   utiliser un numéro qui n'existe pas encore (au-delà du prochain numéro)
--   ni un numéro déjà pris.
--
--   1. rpc_peek_next_numbers()      → aperçu des prochains numéros SANS
--                                     consommer les séquences (pré-remplissage).
--   2. rpc_create_quote             → nouveau param p_quote_number (validé).
--   3. rpc_create_invoice_draft     → nouveau param p_invoice_number (validé).
--
--   Les jobs gardent leur trigger existant (assign_job_number) : le numéro
--   fourni est respecté et le compteur avancé; la validation « ≤ prochain »
--   se fait côté client comme la vérification de doublon déjà en place.
-- ════════════════════════════════════════════════════════════════════════

-- 0. Compteur des jobs : idempotent au cas où 20260708000000 n'est pas
--    encore appliquée (rpc_peek_next_numbers le référence).
create table if not exists public.org_job_counters (
  org_id      uuid primary key,
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.org_job_counters enable row level security;

-- 1. Aperçu des prochains numéros (job, soumission, facture) ──────────────
--    greatest(séquence, max existant) couvre les orgs dont la séquence n'a
--    pas encore été initialisée ou est en retard sur des numéros manuels.
create or replace function public.rpc_peek_next_numbers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org   uuid := public.current_org_id();
  v_job   bigint;
  v_quote bigint;
  v_inv   bigint;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;

  select greatest(
    coalesce((select c.last_number from public.org_job_counters c where c.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint)
              from public.jobs j
              where j.org_id = v_org and j.job_number ~ '\d'), 0)
  ) + 1 into v_job;

  select greatest(
    coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
              from public.quotes q
              where q.org_id = v_org and q.quote_number ~ '\d'), 0)
  ) + 1 into v_quote;

  select greatest(
    coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
              from public.invoices i
              where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
  ) + 1 into v_inv;

  return jsonb_build_object(
    'job', v_job::text,
    'quote', v_quote::text,
    'invoice_seq', v_inv,
    'invoice', 'INV-' || lpad(v_inv::text, 6, '0')
  );
end;
$$;

-- 2. rpc_create_quote : accepte un numéro fourni (validé) ─────────────────
--    Nouvelle signature → on supprime l'ancienne pour éviter l'ambiguïté
--    de surcharge côté PostgREST.
drop function if exists public.rpc_create_quote(
  uuid, uuid, text, uuid, text, text, integer, text, text, boolean, boolean);

create or replace function public.rpc_create_quote(
  p_lead_id       uuid default null,
  p_client_id     uuid default null,
  p_title         text default '',
  p_salesperson_id uuid default null,
  p_context_type  text default 'lead',
  p_currency      text default 'CAD',
  p_valid_days    integer default 30,
  p_notes         text default null,
  p_contract      text default null,
  p_deposit_required boolean default false,
  p_require_payment_method boolean default false,
  p_quote_number  text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_quote_number text;
  v_seq integer;
  v_quote_id uuid;
  v_valid_until date;
  v_wanted bigint;
  v_next bigint;
begin
  -- Resolve org
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  if p_quote_number is not null and btrim(p_quote_number) <> '' then
    -- Numéro fourni : valider puis garder la séquence au moins à ce niveau.
    if btrim(p_quote_number) !~ '^\d+$' then
      raise exception 'Invalid quote number "%"', p_quote_number;
    end if;
    v_wanted := btrim(p_quote_number)::bigint;

    select greatest(
      coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org_id), 0),
      coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
                from public.quotes q
                where q.org_id = v_org_id and q.quote_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Quote number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.quotes q
      where q.org_id = v_org_id
        and q.deleted_at is null
        and btrim(q.quote_number) = v_wanted::text
    ) then
      raise exception 'Quote number % is already in use', v_wanted;
    end if;

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org_id, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(quote_sequences.last_value, excluded.last_value),
          updated_at = now();

    v_quote_number := v_wanted::text;
  else
    -- Auto-increment quote number
    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org_id, 1, now())
    on conflict (org_id) do update
      set last_value = quote_sequences.last_value + 1,
          updated_at = now()
    returning last_value into v_seq;

    v_quote_number := v_seq::text;
  end if;

  v_valid_until := current_date + p_valid_days;

  -- Create the quote
  insert into public.quotes (
    org_id, quote_number, title, lead_id, client_id,
    status, context_type, salesperson_id, created_by,
    currency, valid_until, notes, contract_disclaimer,
    deposit_required, require_payment_method
  ) values (
    v_org_id, v_quote_number, p_title, p_lead_id, p_client_id,
    'draft', p_context_type, p_salesperson_id, auth.uid(),
    p_currency, v_valid_until, p_notes, p_contract,
    p_deposit_required, p_require_payment_method
  )
  returning id into v_quote_id;

  -- Log initial status
  insert into public.quote_status_history (quote_id, old_status, new_status, changed_by)
  values (v_quote_id, null, 'draft', auth.uid());

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'quote_number', v_quote_number,
    'valid_until', v_valid_until
  );
end;
$$;

-- 3. rpc_create_invoice_draft : accepte un numéro fourni (validé) ─────────
drop function if exists public.rpc_create_invoice_draft(uuid, text, date);

create or replace function public.rpc_create_invoice_draft(
  p_client_id uuid,
  p_subject text default null,
  p_due_date date default null,
  p_invoice_number text default null
)
returns table(
  id uuid,
  invoice_number text,
  status text,
  subject text,
  due_date date,
  total_cents integer,
  balance_cents integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org uuid;
  v_number text;
  v_client public.clients%rowtype;
  v_invoice public.invoices%rowtype;
  v_digits text;
  v_wanted bigint;
  v_next bigint;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Unable to resolve org_id for authenticated user';
  end if;

  select *
    into v_client
  from public.clients AS c
  where c.id = p_client_id
    and c.deleted_at is null
  limit 1;

  if v_client.id is null then
    raise exception 'Client not found';
  end if;

  if v_client.org_id <> v_org then
    raise exception 'Client does not belong to your organization';
  end if;

  if lower(coalesce(v_client.status, 'active')) = 'inactive' then
    raise exception 'Client is inactive';
  end if;

  if p_invoice_number is not null and btrim(p_invoice_number) <> '' then
    -- Numéro fourni : accepter « INV-000042 » ou « 42 », valider, puis
    -- garder la séquence au moins à ce niveau.
    v_digits := nullif(regexp_replace(p_invoice_number, '\D', '', 'g'), '');
    if v_digits is null then
      raise exception 'Invalid invoice number "%"', p_invoice_number;
    end if;
    v_wanted := v_digits::bigint;

    select greatest(
      coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
                from public.invoices i
                where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Invoice number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;

    v_number := 'INV-' || lpad(v_wanted::text, 6, '0');

    -- La contrainte unique (org_id, invoice_number) inclut les factures
    -- supprimées (soft delete) : on vérifie donc sans filtrer deleted_at.
    if exists (
      select 1 from public.invoices i
      where i.org_id = v_org and i.invoice_number = v_number
    ) then
      raise exception 'Invoice number % is already in use', v_number;
    end if;

    insert into public.invoice_sequences (org_id, last_value)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_value = greatest(invoice_sequences.last_value, excluded.last_value),
          updated_at = now();
  else
    v_number := public.invoice_next_number(v_org);
  end if;

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    invoice_number,
    status,
    subject,
    issued_at,
    due_date,
    subtotal_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_cents
  )
  values (
    v_org,
    auth.uid(),
    p_client_id,
    v_number,
    'draft',
    nullif(trim(p_subject), ''),
    null,
    p_due_date,
    0,
    0,
    0,
    0,
    0
  )
  returning * into v_invoice;

  return query
  select
    v_invoice.id,
    v_invoice.invoice_number,
    v_invoice.status,
    v_invoice.subject,
    v_invoice.due_date,
    v_invoice.total_cents,
    v_invoice.balance_cents,
    v_invoice.created_at;
end;
$function$;

NOTIFY pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  20260729000000_clients_auto_number.sql
-- ╚══════════════════════════════════════════════════════════════════╝
-- ════════════════════════════════════════════════════════════════════════
-- Numérotation automatique des clients — par organisation, atomique
-- ════════════════════════════════════════════════════════════════════════
-- Les jobs, soumissions et factures ont déjà un # séquentiel par org; les
-- clients n'en avaient aucun. On réplique le pattern des jobs
-- (20260708000000_jobs_auto_number_per_org.sql) :
--   • clients.client_number (text) + compteur org_client_counters
--   • trigger BEFORE INSERT = source unique d'attribution, peu importe le
--     chemin de création (form /clients/new, quick-create, requests, D2D…)
--   • un numéro fourni manuellement est respecté et avance le compteur
--   • backfill des clients existants dans l'ordre de création
--   • rpc_peek_next_numbers expose « client » pour le pré-remplissage du form
--   • create_client_with_duplicate_handling accepte/valide client_number
--
-- Idempotent et sûr à re-exécuter.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Colonne + compteur séquentiel par organisation ───────────────────────
alter table public.clients
  add column if not exists client_number text null;

comment on column public.clients.client_number is
  'Numéro séquentiel par org, attribué par trigger (assign_client_number); modifiable à la création.';

create table if not exists public.org_client_counters (
  org_id      uuid primary key,
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now()
);

-- Accès direct interdit aux clients : seule la fonction SECURITY DEFINER y écrit.
alter table public.org_client_counters enable row level security;

-- 2. Fonction d'attribution (atomique, par org) ───────────────────────────
create or replace function public.assign_client_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := coalesce(new.org_id, public.current_org_id());
  v_next bigint;
begin
  -- Pas d'org résolvable : on laisse les autres contraintes décider.
  if v_org is null then
    return new;
  end if;

  -- Numéro fourni explicitement : on le respecte, mais on garde le compteur
  -- en avance pour qu'un futur numéro auto n'entre jamais en collision.
  if new.client_number is not null and btrim(new.client_number) <> '' then
    if new.client_number ~ '^\s*\d+$' then
      insert into public.org_client_counters (org_id, last_number)
      values (v_org, btrim(new.client_number)::bigint)
      on conflict (org_id) do update
        set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
            updated_at  = now();
    end if;
    return new;
  end if;

  -- Attribution séquentielle atomique : l'upsert verrouille la ligne de l'org.
  insert into public.org_client_counters (org_id, last_number)
  values (v_org, 1)
  on conflict (org_id) do update
    set last_number = public.org_client_counters.last_number + 1,
        updated_at  = now()
  returning last_number into v_next;

  new.client_number := v_next::text;
  return new;
end;
$$;

-- 3. Trigger BEFORE INSERT ────────────────────────────────────────────────
--    Nommé "zz" pour s'exécuter après tout trigger de scope (ordre alpha).
drop trigger if exists trg_clients_zz_assign_number on public.clients;
create trigger trg_clients_zz_assign_number
  before insert on public.clients
  for each row execute function public.assign_client_number();

-- 4. Backfill des clients existants sans numéro ───────────────────────────
--    Dans l'ordre de création, en continuant après le max existant par org.
with maxes as (
  select org_id,
         coalesce(max(nullif(regexp_replace(client_number, '\D', '', 'g'), '')::bigint), 0) as mx
  from public.clients
  where client_number is not null and client_number ~ '\d'
  group by org_id
),
to_fill as (
  select c.id, c.org_id,
         row_number() over (partition by c.org_id order by c.created_at nulls first, c.id) as rn
  from public.clients c
  where c.client_number is null or btrim(c.client_number) = ''
)
update public.clients c
set client_number = (coalesce(m.mx, 0) + tf.rn)::text
from to_fill tf
left join maxes m on m.org_id = tf.org_id
where c.id = tf.id;

-- 5. (Ré)initialiser le compteur sur le max courant par org ───────────────
insert into public.org_client_counters (org_id, last_number)
select org_id,
       max(nullif(regexp_replace(client_number, '\D', '', 'g'), '')::bigint)
from public.clients
where client_number is not null and client_number ~ '\d'
group by org_id
on conflict (org_id) do update
  set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
      updated_at  = now();

-- 6. Filet de sécurité : index unique (org_id, client_number) actifs ──────
do $$
begin
  begin
    create unique index if not exists clients_org_client_number_uniq
      on public.clients (org_id, client_number)
      where client_number is not null and deleted_at is null;
  exception when others then
    raise notice 'Index clients_org_client_number_uniq non créé (doublons hérités ?): %', sqlerrm;
  end;
end$$;

-- 7. clients_active doit exposer la nouvelle colonne ──────────────────────
--    (vue select * figée à la création — on la recrée; security_invoker
--    préservé pour que les lectures respectent la RLS de l'appelant)
create or replace view public.clients_active with (security_invoker = true) as
  select * from public.clients where deleted_at is null;

grant select on public.clients_active to authenticated, anon;

-- 8. rpc_peek_next_numbers : ajoute « client » ────────────────────────────
--    Guards idempotents au cas où 20260708/20260716 ne sont pas appliquées
--    dans un environnement (la fonction référence ces tables).
create table if not exists public.org_job_counters (
  org_id      uuid primary key,
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.org_job_counters enable row level security;

create or replace function public.rpc_peek_next_numbers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        uuid := public.current_org_id();
  v_job        bigint;
  v_quote      bigint;
  v_inv        bigint;
  v_client     bigint;
  v_inv_prefix text;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;

  -- Prefix de facture configurable (20260711140000); défaut 'INV-' si la
  -- colonne/ligne n'existe pas encore.
  begin
    select coalesce(nullif(trim(invoice_prefix), ''), 'INV-') into v_inv_prefix
    from public.company_settings where org_id = v_org;
  exception when others then v_inv_prefix := null; end;
  v_inv_prefix := coalesce(v_inv_prefix, 'INV-');

  select greatest(
    coalesce((select c.last_number from public.org_job_counters c where c.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint)
              from public.jobs j
              where j.org_id = v_org and j.job_number ~ '\d'), 0)
  ) + 1 into v_job;

  select greatest(
    coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
              from public.quotes q
              where q.org_id = v_org and q.quote_number ~ '\d'), 0)
  ) + 1 into v_quote;

  select greatest(
    coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
              from public.invoices i
              where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
  ) + 1 into v_inv;

  select greatest(
    coalesce((select c.last_number from public.org_client_counters c where c.org_id = v_org), 0),
    coalesce((select max(nullif(regexp_replace(cl.client_number, '\D', '', 'g'), '')::bigint)
              from public.clients cl
              where cl.org_id = v_org and cl.client_number ~ '\d'), 0)
  ) + 1 into v_client;

  return jsonb_build_object(
    'job', v_job::text,
    'quote', v_quote::text,
    'invoice_seq', v_inv,
    'invoice', v_inv_prefix || lpad(v_inv::text, 6, '0'),
    'client', v_client::text
  );
end;
$$;

-- 9. create_client_with_duplicate_handling : accepte client_number ────────
--    Même règle que jobs/soumissions/factures : numérique obligatoire,
--    jamais au-delà du prochain numéro disponible, jamais déjà pris.
--    Signature inchangée (payload jsonb) → pas de drop nécessaire.
create or replace function public.create_client_with_duplicate_handling(
  p_org_id uuid,
  p_mode text,
  p_payload jsonb,
  p_merge_duplicates boolean default true
)
returns public.clients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mode text := lower(coalesce(trim(p_mode), 'add'));
  v_first_name text := nullif(trim(coalesce(p_payload->>'first_name', '')), '');
  v_last_name text := nullif(trim(coalesce(p_payload->>'last_name', '')), '');
  v_company text := nullif(trim(coalesce(p_payload->>'company', '')), '');
  v_email text := nullif(trim(coalesce(p_payload->>'email', '')), '');
  v_phone text := nullif(trim(coalesce(p_payload->>'phone', '')), '');
  v_address text := nullif(trim(coalesce(p_payload->>'address', '')), '');
  v_status text := coalesce(nullif(trim(p_payload->>'status'), ''), 'active');
  v_display_as_company boolean := coalesce((p_payload->>'display_as_company')::boolean, false);
  -- structured address (Google Places)
  v_street_number text := nullif(trim(coalesce(p_payload->>'street_number', '')), '');
  v_street_name text := nullif(trim(coalesce(p_payload->>'street_name', '')), '');
  v_city text := nullif(trim(coalesce(p_payload->>'city', '')), '');
  v_province text := nullif(trim(coalesce(p_payload->>'province', '')), '');
  v_postal_code text := nullif(trim(coalesce(p_payload->>'postal_code', '')), '');
  v_country text := nullif(trim(coalesce(p_payload->>'country', '')), '');
  v_latitude numeric := null;
  v_longitude numeric := null;
  v_place_id text := nullif(trim(coalesce(p_payload->>'place_id', '')), '');
  -- billing address
  v_billing_same boolean := coalesce((p_payload->>'billing_same_as_service')::boolean, true);
  v_billing_address text := nullif(trim(coalesce(p_payload->>'billing_address', '')), '');
  -- new-client-form fields
  v_phones jsonb := case when jsonb_typeof(p_payload->'phones') = 'array' then p_payload->'phones' else '[]'::jsonb end;
  v_email_label text := coalesce(nullif(trim(coalesce(p_payload->>'email_label', '')), ''), 'main');
  v_lead_source text := nullif(trim(coalesce(p_payload->>'lead_source', '')), '');
  v_tax_ids uuid[] := null;
  -- client number (optionnel — le trigger attribue le suivant si absent)
  v_client_number text := nullif(trim(coalesce(p_payload->>'client_number', '')), '');
  v_next_number bigint;
  v_primary public.clients%rowtype;
  v_dup record;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null then
    raise exception 'p_org_id is required' using errcode = '22023';
  end if;

  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this org' using errcode = '42501';
  end if;

  -- numeric/uuid payload fields: ignore malformed values instead of failing
  begin
    v_latitude := (p_payload->>'latitude')::numeric;
  exception when others then v_latitude := null; end;
  begin
    v_longitude := (p_payload->>'longitude')::numeric;
  exception when others then v_longitude := null; end;
  begin
    if jsonb_typeof(p_payload->'tax_ids') = 'array' then
      select array(select value::uuid from jsonb_array_elements_text(p_payload->'tax_ids'))
        into v_tax_ids;
    end if;
  exception when others then v_tax_ids := null; end;

  -- client_number fourni : numérique, ≤ prochain disponible, pas déjà pris
  if v_client_number is not null then
    if v_client_number !~ '^\d+$' then
      raise exception 'Invalid client number "%"', v_client_number using errcode = '22023';
    end if;

    select greatest(
      coalesce((select c.last_number from public.org_client_counters c where c.org_id = p_org_id), 0),
      coalesce((select max(nullif(regexp_replace(cl.client_number, '\D', '', 'g'), '')::bigint)
                from public.clients cl
                where cl.org_id = p_org_id and cl.client_number ~ '\d'), 0)
    ) + 1 into v_next_number;

    if v_client_number::bigint > v_next_number then
      raise exception 'Client number % does not exist yet (next available is %)',
        v_client_number, v_next_number using errcode = '22023';
    end if;

    if exists (
      select 1 from public.clients c
      where c.org_id = p_org_id
        and c.deleted_at is null
        and c.client_number = v_client_number
    ) then
      raise exception 'Client number % is already in use', v_client_number using errcode = '23505';
    end if;
  end if;

  if v_first_name is null then
    v_first_name := 'Unknown';
  end if;
  if v_last_name is null then
    v_last_name := 'Client';
  end if;

  if v_mode not in ('add', 'replace') then
    raise exception 'Invalid mode: %', v_mode using errcode = '22023';
  end if;

  if v_mode = 'add' then
    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, status, display_as_company,
      street_number, street_name, city, province, postal_code, country, latitude, longitude, place_id,
      billing_same_as_service, billing_address, phones, email_label, lead_source, tax_ids, client_number,
      created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_display_as_company,
      v_street_number, v_street_name, v_city, v_province, v_postal_code, v_country, v_latitude, v_longitude, v_place_id,
      v_billing_same, v_billing_address, v_phones, v_email_label, v_lead_source, v_tax_ids, v_client_number,
      v_uid, now()
    )
    returning * into v_primary;

    return v_primary;
  end if;

  if v_email is null then
    raise exception 'replace mode requires email' using errcode = '22023';
  end if;

  select * into v_primary
  from public.clients c
  where c.org_id = p_org_id
    and c.deleted_at is null
    and lower(coalesce(c.email, '')) = lower(v_email)
  order by c.created_at asc, c.id asc
  limit 1
  for update;

  if v_primary.id is null then
    insert into public.clients (
      org_id, first_name, last_name, company, email, phone, address, status, display_as_company,
      street_number, street_name, city, province, postal_code, country, latitude, longitude, place_id,
      billing_same_as_service, billing_address, phones, email_label, lead_source, tax_ids, client_number,
      created_by, updated_at
    )
    values (
      p_org_id, v_first_name, v_last_name, v_company, v_email, v_phone, v_address, v_status, v_display_as_company,
      v_street_number, v_street_name, v_city, v_province, v_postal_code, v_country, v_latitude, v_longitude, v_place_id,
      v_billing_same, v_billing_address, v_phones, v_email_label, v_lead_source, v_tax_ids, v_client_number,
      v_uid, now()
    )
    returning * into v_primary;

    return v_primary;
  end if;

  -- replace : le client existant garde son client_number (jamais réécrit)
  update public.clients
  set
    first_name = v_first_name,
    last_name = v_last_name,
    company = v_company,
    email = v_email,
    phone = v_phone,
    address = v_address,
    status = v_status,
    display_as_company = v_display_as_company,
    street_number = v_street_number,
    street_name = v_street_name,
    city = v_city,
    province = v_province,
    postal_code = v_postal_code,
    country = v_country,
    latitude = v_latitude,
    longitude = v_longitude,
    place_id = v_place_id,
    billing_same_as_service = v_billing_same,
    billing_address = v_billing_address,
    phones = v_phones,
    email_label = v_email_label,
    lead_source = v_lead_source,
    tax_ids = v_tax_ids,
    updated_at = now()
  where id = v_primary.id
  returning * into v_primary;

  if p_merge_duplicates then
    for v_dup in
      select c.id
      from public.clients c
      where c.org_id = p_org_id
        and c.deleted_at is null
        and lower(coalesce(c.email, '')) = lower(v_email)
        and c.id <> v_primary.id
      order by c.created_at asc, c.id asc
    loop
      update public.jobs
      set client_id = v_primary.id, updated_at = now()
      where org_id = p_org_id and client_id = v_dup.id;

      if to_regclass('public.invoices') is not null then
        begin
          execute 'update public.invoices set client_id = $1, updated_at = now() where org_id = $2 and client_id = $3'
          using v_primary.id, p_org_id, v_dup.id;
        exception when others then
          null;
        end;
      end if;

      if to_regclass('public.payments') is not null then
        begin
          execute 'update public.payments set client_id = $1, updated_at = now() where org_id = $2 and client_id = $3'
          using v_primary.id, p_org_id, v_dup.id;
        exception when others then
          null;
        end;
      end if;

      update public.pipeline_deals
      set client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and client_id = v_dup.id;

      update public.leads
      set client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and client_id = v_dup.id;

      update public.leads
      set converted_to_client_id = v_primary.id,
          updated_at = now()
      where org_id = p_org_id
        and converted_to_client_id = v_dup.id;

      delete from public.clients
      where org_id = p_org_id
        and id = v_dup.id;
    end loop;
  end if;

  return v_primary;
end;
$$;

revoke all on function public.create_client_with_duplicate_handling(uuid, text, jsonb, boolean) from public;
grant execute on function public.create_client_with_duplicate_handling(uuid, text, jsonb, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  20260731000000_entity_number_hub_edit.sql
-- ╚══════════════════════════════════════════════════════════════════╝
-- ════════════════════════════════════════════════════════════════════════
-- Numéros (#) modifiables sur les hub pages — jobs, clients, devis, factures
-- ════════════════════════════════════════════════════════════════════════
-- Complément de 20260716000000 (numéros dans les forms de création) et de
-- 20260729000000 (numéros clients) : le # devient modifiable directement sur
-- la page hub de chaque entité, avec les mêmes règles qu'à la création :
--   • numérique obligatoire
--   • jamais au-delà du prochain numéro disponible de l'org
--   • warning si le numéro est déjà pris (doublon)
--
--   1. rpc_update_entity_number(entity, id, number) → validation + update +
--      avance du compteur/séquence de l'org, le tout atomique.
--   2. Les triggers d'attribution jobs/clients écoutent aussi UPDATE de la
--      colonne numéro : tout chemin qui modifie un # garde le compteur en
--      avance (aucune collision possible avec un futur numéro auto).
--
-- Idempotent et sûr à re-exécuter.
-- ════════════════════════════════════════════════════════════════════════

-- 1. RPC de mise à jour d'un numéro d'entité ──────────────────────────────
create or replace function public.rpc_update_entity_number(
  p_entity text,
  p_id uuid,
  p_number text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_digits text;
  v_wanted bigint;
  v_next   bigint;
  v_stored text;
  v_count  int;
  v_prefix text;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;
  if p_id is null then
    raise exception 'p_id is required' using errcode = '22023';
  end if;

  v_digits := nullif(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '');
  if v_digits is null then
    raise exception 'Invalid number "%"', p_number using errcode = '22023';
  end if;
  v_wanted := v_digits::bigint;

  if p_entity = 'job' then
    select greatest(
      coalesce((select c.last_number from public.org_job_counters c where c.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint)
                from public.jobs j
                where j.org_id = v_org and j.job_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Job number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.jobs j
      where j.org_id = v_org and j.deleted_at is null
        and j.job_number = v_wanted::text and j.id <> p_id
    ) then
      raise exception 'Job number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.jobs
    set job_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Job not found';
    end if;

    insert into public.org_job_counters (org_id, last_number)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
          updated_at  = now();

  elsif p_entity = 'quote' then
    select greatest(
      coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
                from public.quotes q
                where q.org_id = v_org and q.quote_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Quote number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.quotes q
      where q.org_id = v_org and q.deleted_at is null
        and btrim(q.quote_number) = v_wanted::text and q.id <> p_id
    ) then
      raise exception 'Quote number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.quotes
    set quote_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Quote not found';
    end if;

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(public.quote_sequences.last_value, excluded.last_value),
          updated_at = now();

  elsif p_entity = 'invoice' then
    select greatest(
      coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
                from public.invoices i
                where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Invoice number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;

    -- Prefix configurable (company_settings.invoice_prefix, 20260711140000);
    -- défaut 'INV-' si la colonne/ligne n'existe pas encore.
    begin
      select coalesce(nullif(trim(invoice_prefix), ''), 'INV-') into v_prefix
      from public.company_settings where org_id = v_org;
    exception when others then v_prefix := null; end;
    v_stored := coalesce(v_prefix, 'INV-') || lpad(v_wanted::text, 6, '0');

    -- Doublon comparé sur la partie numérique (le prefix peut avoir changé
    -- depuis la création des anciennes factures). La contrainte unique
    -- (org_id, invoice_number) inclut les factures supprimées (soft delete) :
    -- on vérifie donc sans filtrer deleted_at.
    if exists (
      select 1 from public.invoices i
      where i.org_id = v_org and i.id <> p_id
        and nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint = v_wanted
    ) then
      raise exception 'Invoice number % is already in use', v_stored;
    end if;

    update public.invoices
    set invoice_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Invoice not found';
    end if;

    insert into public.invoice_sequences (org_id, last_value)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_value = greatest(public.invoice_sequences.last_value, excluded.last_value),
          updated_at = now();

  elsif p_entity = 'client' then
    select greatest(
      coalesce((select c.last_number from public.org_client_counters c where c.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(cl.client_number, '\D', '', 'g'), '')::bigint)
                from public.clients cl
                where cl.org_id = v_org and cl.client_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Client number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.clients c
      where c.org_id = v_org and c.deleted_at is null
        and c.client_number = v_wanted::text and c.id <> p_id
    ) then
      raise exception 'Client number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.clients
    set client_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Client not found';
    end if;

    insert into public.org_client_counters (org_id, last_number)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
          updated_at  = now();

  else
    raise exception 'Unknown entity "%"', p_entity using errcode = '22023';
  end if;

  return v_stored;
end;
$$;

revoke all on function public.rpc_update_entity_number(text, uuid, text) from public;
grant execute on function public.rpc_update_entity_number(text, uuid, text) to authenticated, service_role;

-- 2. Triggers d'attribution : écouter aussi UPDATE de la colonne numéro ────
--    Un # modifié par un autre chemin (ex. formulaire d'édition de job)
--    avance aussi le compteur; un # vidé se voit réattribuer le prochain.
drop trigger if exists trg_jobs_zz_assign_number on public.jobs;
create trigger trg_jobs_zz_assign_number
  before insert or update of job_number on public.jobs
  for each row execute function public.assign_job_number();

drop trigger if exists trg_clients_zz_assign_number on public.clients;
create trigger trg_clients_zz_assign_number
  before insert or update of client_number on public.clients
  for each row execute function public.assign_client_number();

notify pgrst, 'reload schema';

-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  20260732000000_plain_numbers_smallest_gap.sql
-- ╚══════════════════════════════════════════════════════════════════╝
-- ════════════════════════════════════════════════════════════════════════
-- Numéros d'entités : chiffres seulement + plus petit numéro libre
-- ════════════════════════════════════════════════════════════════════════
-- Demande : « je veux le numéro seulement, pas INV-…, pas de lettres, et
-- toujours le plus petit numéro possible pour chaque élément ».
--
--   1. Tous les numéros (jobs, devis, factures, clients) sont stockés en
--      chiffres seulement : « 7 » — plus de préfixe INV- ni de zéros (000007).
--   2. L'attribution automatique donne le PLUS PETIT numéro positif libre de
--      l'org (les trous sont comblés), au lieu de max+1.
--   3. Les numéros existants sont normalisés (INV-000007 → 7) quand c'est
--      sans collision; les lignes soft-deleted comptent comme « pris ».
--   4. company_settings.invoice_prefix est retiré du calcul (défaut '').
--
-- À appliquer APRÈS 20260708 / 20260716 / 20260729 / 20260731 (cette
-- migration redéfinit leurs fonctions).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 0. Plus petit numéro positif libre d'une org pour une entité ─────────────
--    Les lignes supprimées (soft delete) comptent : un numéro déjà porté par
--    une ligne supprimée n'est jamais réutilisé (la contrainte unique des
--    factures couvre aussi les supprimées).
create or replace function public.org_smallest_free_number(p_org uuid, p_entity text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tbl text;
  v_col text;
  v_result bigint;
begin
  -- Garde cross-org (même règle que le fix 20260620 sur invoice_next_number) :
  -- un utilisateur authentifié ne peut lire que les numéros de son org.
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), p_org) then
    raise exception 'Not allowed for this organization';
  end if;

  if p_entity = 'job' then v_tbl := 'jobs'; v_col := 'job_number';
  elsif p_entity = 'quote' then v_tbl := 'quotes'; v_col := 'quote_number';
  elsif p_entity = 'invoice' then v_tbl := 'invoices'; v_col := 'invoice_number';
  elsif p_entity = 'client' then v_tbl := 'clients'; v_col := 'client_number';
  else raise exception 'Unknown entity "%"', p_entity using errcode = '22023';
  end if;

  execute format(
    'with nums as (
       select distinct nullif(regexp_replace(%1$I, ''\D'', '''', ''g''), '''')::bigint as n
       from public.%2$I
       where org_id = $1 and %1$I ~ ''\d''
     )
     select min(s.s)
     from generate_series(1, coalesce((select count(*) from nums), 0) + 1) as s(s)
     where not exists (select 1 from nums where nums.n = s.s)',
    v_col, v_tbl)
  into v_result
  using p_org;

  return coalesce(v_result, 1);
end;
$$;
revoke all on function public.org_smallest_free_number(uuid, text) from public, anon;
grant execute on function public.org_smallest_free_number(uuid, text) to authenticated, service_role;

-- 1. invoice_next_number : chiffres seulement, plus petit numéro libre ─────
create or replace function public.invoice_next_number(p_org uuid)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_next bigint;
begin
  -- Garde cross-org conservée du fix 20260620.
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), p_org) then
    raise exception 'Not allowed for this organization';
  end if;

  -- Sérialise l'attribution par org (deux créations simultanées ne peuvent
  -- pas recevoir le même « plus petit numéro libre »).
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':invoice', 0));

  v_next := public.org_smallest_free_number(p_org, 'invoice');

  -- Compat : la séquence reste ≥ au dernier numéro attribué (lue par
  -- get_invoice_next_number pour l'écran Réglages).
  insert into public.invoice_sequences (org_id, last_value)
  values (p_org, v_next)
  on conflict (org_id) do update
    set last_value = greatest(public.invoice_sequences.last_value, excluded.last_value),
        updated_at = now();

  return v_next::text;
end;
$fn$;

-- 2. rpc_peek_next_numbers : plus petit libre, facture sans préfixe ────────
create or replace function public.rpc_peek_next_numbers()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_org_id();
  v_inv bigint;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;

  v_inv := public.org_smallest_free_number(v_org, 'invoice');

  return jsonb_build_object(
    'job', public.org_smallest_free_number(v_org, 'job')::text,
    'quote', public.org_smallest_free_number(v_org, 'quote')::text,
    'invoice_seq', v_inv,
    'invoice', v_inv::text,
    'client', public.org_smallest_free_number(v_org, 'client')::text
  );
end;
$$;

-- 3. Triggers d'attribution jobs/clients : plus petit numéro libre ─────────
--    Même structure qu'avant (numéro fourni respecté + compteur en avance);
--    seule l'attribution automatique change (trou le plus bas au lieu du
--    compteur+1). Le compteur est conservé : les validations « ≤ prochain »
--    de 20260716/20260731 le lisent.
create or replace function public.assign_job_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := coalesce(new.org_id, public.current_org_id());
  v_next bigint;
begin
  if v_org is null then
    return new;
  end if;

  if new.job_number is not null and btrim(new.job_number) <> '' then
    if new.job_number ~ '^\s*\d+$' then
      insert into public.org_job_counters (org_id, last_number)
      values (v_org, btrim(new.job_number)::bigint)
      on conflict (org_id) do update
        set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
            updated_at  = now();
    end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':job', 0));
  v_next := public.org_smallest_free_number(v_org, 'job');

  insert into public.org_job_counters (org_id, last_number)
  values (v_org, v_next)
  on conflict (org_id) do update
    set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
        updated_at  = now();

  new.job_number := v_next::text;
  return new;
end;
$$;

create or replace function public.assign_client_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid := coalesce(new.org_id, public.current_org_id());
  v_next bigint;
begin
  if v_org is null then
    return new;
  end if;

  if new.client_number is not null and btrim(new.client_number) <> '' then
    if new.client_number ~ '^\s*\d+$' then
      insert into public.org_client_counters (org_id, last_number)
      values (v_org, btrim(new.client_number)::bigint)
      on conflict (org_id) do update
        set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
            updated_at  = now();
    end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':client', 0));
  v_next := public.org_smallest_free_number(v_org, 'client');

  insert into public.org_client_counters (org_id, last_number)
  values (v_org, v_next)
  on conflict (org_id) do update
    set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
        updated_at  = now();

  new.client_number := v_next::text;
  return new;
end;
$$;

-- 4. rpc_create_quote : attribution auto = plus petit libre ────────────────
--    Signature identique à 20260716000000; seul le bloc « auto-increment »
--    change (plus petit libre au lieu de séquence+1).
create or replace function public.rpc_create_quote(
  p_lead_id       uuid default null,
  p_client_id     uuid default null,
  p_title         text default '',
  p_salesperson_id uuid default null,
  p_context_type  text default 'lead',
  p_currency      text default 'CAD',
  p_valid_days    integer default 30,
  p_notes         text default null,
  p_contract      text default null,
  p_deposit_required boolean default false,
  p_require_payment_method boolean default false,
  p_quote_number  text default null
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_quote_number text;
  v_quote_id uuid;
  v_valid_until date;
  v_wanted bigint;
  v_next bigint;
begin
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  if p_quote_number is not null and btrim(p_quote_number) <> '' then
    -- Numéro fourni : valider puis garder la séquence au moins à ce niveau.
    if btrim(p_quote_number) !~ '^\d+$' then
      raise exception 'Invalid quote number "%"', p_quote_number;
    end if;
    v_wanted := btrim(p_quote_number)::bigint;

    select greatest(
      coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org_id), 0),
      coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
                from public.quotes q
                where q.org_id = v_org_id and q.quote_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Quote number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.quotes q
      where q.org_id = v_org_id
        and q.deleted_at is null
        and btrim(q.quote_number) = v_wanted::text
    ) then
      raise exception 'Quote number % is already in use', v_wanted;
    end if;

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org_id, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(quote_sequences.last_value, excluded.last_value),
          updated_at = now();

    v_quote_number := v_wanted::text;
  else
    -- Attribution auto : plus petit numéro libre de l'org.
    perform pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':quote', 0));
    v_wanted := public.org_smallest_free_number(v_org_id, 'quote');

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org_id, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(quote_sequences.last_value, excluded.last_value),
          updated_at = now();

    v_quote_number := v_wanted::text;
  end if;

  v_valid_until := current_date + p_valid_days;

  insert into public.quotes (
    org_id, quote_number, title, lead_id, client_id,
    status, context_type, salesperson_id, created_by,
    currency, valid_until, notes, contract_disclaimer,
    deposit_required, require_payment_method
  ) values (
    v_org_id, v_quote_number, p_title, p_lead_id, p_client_id,
    'draft', p_context_type, p_salesperson_id, auth.uid(),
    p_currency, v_valid_until, p_notes, p_contract,
    p_deposit_required, p_require_payment_method
  )
  returning id into v_quote_id;

  insert into public.quote_status_history (quote_id, old_status, new_status, changed_by)
  values (v_quote_id, null, 'draft', auth.uid());

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'quote_number', v_quote_number,
    'valid_until', v_valid_until
  );
end;
$$;

-- 5. rpc_create_invoice_draft : numéro fourni stocké en chiffres seulement ─
create or replace function public.rpc_create_invoice_draft(
  p_client_id uuid,
  p_subject text default null,
  p_due_date date default null,
  p_invoice_number text default null
)
returns table(
  id uuid,
  invoice_number text,
  status text,
  subject text,
  due_date date,
  total_cents integer,
  balance_cents integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_org uuid;
  v_number text;
  v_client public.clients%rowtype;
  v_invoice public.invoices%rowtype;
  v_digits text;
  v_wanted bigint;
  v_next bigint;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Unable to resolve org_id for authenticated user';
  end if;

  select *
    into v_client
  from public.clients AS c
  where c.id = p_client_id
    and c.deleted_at is null
  limit 1;

  if v_client.id is null then
    raise exception 'Client not found';
  end if;

  if v_client.org_id <> v_org then
    raise exception 'Client does not belong to your organization';
  end if;

  if lower(coalesce(v_client.status, 'active')) = 'inactive' then
    raise exception 'Client is inactive';
  end if;

  if p_invoice_number is not null and btrim(p_invoice_number) <> '' then
    -- Numéro fourni : accepter « 42 » (ou un ancien « INV-000042 »), valider,
    -- stocker en chiffres seulement, puis garder la séquence à ce niveau.
    v_digits := nullif(regexp_replace(p_invoice_number, '\D', '', 'g'), '');
    if v_digits is null then
      raise exception 'Invalid invoice number "%"', p_invoice_number;
    end if;
    v_wanted := v_digits::bigint;

    select greatest(
      coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
                from public.invoices i
                where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Invoice number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;

    v_number := v_wanted::text;

    -- Doublon comparé sur la partie numérique (d'anciennes factures peuvent
    -- garder un préfixe si la normalisation a rencontré une collision). La
    -- contrainte unique (org_id, invoice_number) inclut les factures
    -- supprimées : on vérifie donc sans filtrer deleted_at.
    if exists (
      select 1 from public.invoices i
      where i.org_id = v_org
        and i.invoice_number ~ '\d'
        and nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint = v_wanted
    ) then
      raise exception 'Invoice number % is already in use', v_number;
    end if;

    insert into public.invoice_sequences (org_id, last_value)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_value = greatest(invoice_sequences.last_value, excluded.last_value),
          updated_at = now();
  else
    v_number := public.invoice_next_number(v_org);
  end if;

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    invoice_number,
    status,
    subject,
    issued_at,
    due_date,
    subtotal_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_cents
  )
  values (
    v_org,
    auth.uid(),
    p_client_id,
    v_number,
    'draft',
    nullif(trim(p_subject), ''),
    null,
    p_due_date,
    0,
    0,
    0,
    0,
    0
  )
  returning * into v_invoice;

  return query
  select
    v_invoice.id,
    v_invoice.invoice_number,
    v_invoice.status,
    v_invoice.subject,
    v_invoice.due_date,
    v_invoice.total_cents,
    v_invoice.balance_cents,
    v_invoice.created_at;
end;
$function$;

-- 6. rpc_update_entity_number : facture stockée en chiffres seulement ──────
--    Identique à 20260731000000 sauf la branche invoice (plus de préfixe).
create or replace function public.rpc_update_entity_number(
  p_entity text,
  p_id uuid,
  p_number text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org    uuid := public.current_org_id();
  v_digits text;
  v_wanted bigint;
  v_next   bigint;
  v_stored text;
  v_count  int;
begin
  if v_org is null then
    raise exception 'No organization context';
  end if;
  if p_id is null then
    raise exception 'p_id is required' using errcode = '22023';
  end if;

  v_digits := nullif(regexp_replace(coalesce(p_number, ''), '\D', '', 'g'), '');
  if v_digits is null then
    raise exception 'Invalid number "%"', p_number using errcode = '22023';
  end if;
  v_wanted := v_digits::bigint;

  if p_entity = 'job' then
    select greatest(
      coalesce((select c.last_number from public.org_job_counters c where c.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint)
                from public.jobs j
                where j.org_id = v_org and j.job_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Job number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.jobs j
      where j.org_id = v_org and j.deleted_at is null
        and j.job_number = v_wanted::text and j.id <> p_id
    ) then
      raise exception 'Job number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.jobs
    set job_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Job not found';
    end if;

    insert into public.org_job_counters (org_id, last_number)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_number = greatest(public.org_job_counters.last_number, excluded.last_number),
          updated_at  = now();

  elsif p_entity = 'quote' then
    select greatest(
      coalesce((select s.last_value from public.quote_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint)
                from public.quotes q
                where q.org_id = v_org and q.quote_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Quote number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.quotes q
      where q.org_id = v_org and q.deleted_at is null
        and btrim(q.quote_number) = v_wanted::text and q.id <> p_id
    ) then
      raise exception 'Quote number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.quotes
    set quote_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Quote not found';
    end if;

    insert into public.quote_sequences (org_id, last_value, updated_at)
    values (v_org, v_wanted, now())
    on conflict (org_id) do update
      set last_value = greatest(public.quote_sequences.last_value, excluded.last_value),
          updated_at = now();

  elsif p_entity = 'invoice' then
    select greatest(
      coalesce((select s.last_value from public.invoice_sequences s where s.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint)
                from public.invoices i
                where i.org_id = v_org and i.invoice_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Invoice number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;

    v_stored := v_wanted::text;

    -- Doublon comparé sur la partie numérique; la contrainte unique
    -- (org_id, invoice_number) inclut les factures supprimées.
    if exists (
      select 1 from public.invoices i
      where i.org_id = v_org and i.id <> p_id
        and i.invoice_number ~ '\d'
        and nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint = v_wanted
    ) then
      raise exception 'Invoice number % is already in use', v_stored;
    end if;

    update public.invoices
    set invoice_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Invoice not found';
    end if;

    insert into public.invoice_sequences (org_id, last_value)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_value = greatest(public.invoice_sequences.last_value, excluded.last_value),
          updated_at = now();

  elsif p_entity = 'client' then
    select greatest(
      coalesce((select c.last_number from public.org_client_counters c where c.org_id = v_org), 0),
      coalesce((select max(nullif(regexp_replace(cl.client_number, '\D', '', 'g'), '')::bigint)
                from public.clients cl
                where cl.org_id = v_org and cl.client_number ~ '\d'), 0)
    ) + 1 into v_next;

    if v_wanted > v_next then
      raise exception 'Client number % does not exist yet (next available is %)', v_wanted, v_next;
    end if;
    if exists (
      select 1 from public.clients c
      where c.org_id = v_org and c.deleted_at is null
        and c.client_number = v_wanted::text and c.id <> p_id
    ) then
      raise exception 'Client number % is already in use', v_wanted;
    end if;

    v_stored := v_wanted::text;
    update public.clients
    set client_number = v_stored, updated_at = now()
    where id = p_id and org_id = v_org and deleted_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
      raise exception 'Client not found';
    end if;

    insert into public.org_client_counters (org_id, last_number)
    values (v_org, v_wanted)
    on conflict (org_id) do update
      set last_number = greatest(public.org_client_counters.last_number, excluded.last_number),
          updated_at  = now();

  else
    raise exception 'Unknown entity "%"', p_entity using errcode = '22023';
  end if;

  return v_stored;
end;
$$;

revoke all on function public.rpc_update_entity_number(text, uuid, text) from public;
grant execute on function public.rpc_update_entity_number(text, uuid, text) to authenticated, service_role;

-- 7. Normalisation des numéros existants (INV-000007 → 7, 0001 → 1) ────────
--    Best-effort : une ligne n'est convertie que si sa valeur numérique est
--    unique dans l'org (aucune collision possible), sinon elle est laissée
--    telle quelle (les comparaisons numériques ci-dessus la gèrent).
update public.invoices i
set invoice_number = ltrim(regexp_replace(i.invoice_number, '\D', '', 'g'), '0')
where i.invoice_number !~ '^[1-9][0-9]*$'
  and nullif(ltrim(regexp_replace(i.invoice_number, '\D', '', 'g'), '0'), '') is not null
  and not exists (
    select 1 from public.invoices i2
    where i2.org_id = i.org_id and i2.id <> i.id
      and i2.invoice_number ~ '\d'
      and nullif(regexp_replace(i2.invoice_number, '\D', '', 'g'), '')::bigint
          = nullif(regexp_replace(i.invoice_number, '\D', '', 'g'), '')::bigint
  );

update public.quotes q
set quote_number = ltrim(regexp_replace(q.quote_number, '\D', '', 'g'), '0')
where q.quote_number !~ '^[1-9][0-9]*$'
  and nullif(ltrim(regexp_replace(q.quote_number, '\D', '', 'g'), '0'), '') is not null
  and not exists (
    select 1 from public.quotes q2
    where q2.org_id = q.org_id and q2.id <> q.id
      and q2.quote_number ~ '\d'
      and nullif(regexp_replace(q2.quote_number, '\D', '', 'g'), '')::bigint
          = nullif(regexp_replace(q.quote_number, '\D', '', 'g'), '')::bigint
  );

update public.jobs j
set job_number = ltrim(regexp_replace(j.job_number, '\D', '', 'g'), '0')
where j.job_number !~ '^[1-9][0-9]*$'
  and nullif(ltrim(regexp_replace(j.job_number, '\D', '', 'g'), '0'), '') is not null
  and not exists (
    select 1 from public.jobs j2
    where j2.org_id = j.org_id and j2.id <> j.id
      and j2.job_number ~ '\d'
      and nullif(regexp_replace(j2.job_number, '\D', '', 'g'), '')::bigint
          = nullif(regexp_replace(j.job_number, '\D', '', 'g'), '')::bigint
  );

update public.clients c
set client_number = ltrim(regexp_replace(c.client_number, '\D', '', 'g'), '0')
where c.client_number is not null
  and c.client_number !~ '^[1-9][0-9]*$'
  and nullif(ltrim(regexp_replace(c.client_number, '\D', '', 'g'), '0'), '') is not null
  and not exists (
    select 1 from public.clients c2
    where c2.org_id = c.org_id and c2.id <> c.id
      and c2.client_number ~ '\d'
      and nullif(regexp_replace(c2.client_number, '\D', '', 'g'), '')::bigint
          = nullif(regexp_replace(c.client_number, '\D', '', 'g'), '')::bigint
  );

-- 8. Retirer le préfixe de facture (feature abandonnée : chiffres seulement) ─
alter table public.company_settings
  alter column invoice_prefix set default '';
update public.company_settings
  set invoice_prefix = ''
  where invoice_prefix is distinct from '';

commit;

notify pgrst, 'reload schema';
