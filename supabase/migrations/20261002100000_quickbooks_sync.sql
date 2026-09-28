-- ═══════════════════════════════════════════════════════════════
-- Synchronisation QuickBooks Online : factures, paiements, clients.
--
-- ADDITIF : trois tables neuves, des fonctions neuves et des triggers
-- neufs. Rien d'existant n'est modifié.
--
-- Principe : les triggers mettent en FILE chaque facture / paiement /
-- client touché (quel que soit le chemin d'écriture : client web, serveur,
-- RPC, webhook Stripe). Le worker serveur (server/lib/quickbooks/sync.ts)
-- vide la file vers l'API Intuit. Rien n'est mis en file tant que le
-- bureau n'a pas de connexion QuickBooks active.
--
-- Tout est réservé au serveur (service_role) : RLS forcée sans politique
-- pour anon ni authenticated.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Réglages par bureau ──────────────────────────────────────
-- Les *_id sont des identifiants QuickBooks (texte) ; null = choix
-- automatique par le worker (produit « Services », fonds non déposés,
-- code de taxe au taux de la facture, moyen de paiement par nom).
create table if not exists public.quickbooks_settings (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  enabled boolean not null default true,
  -- Factures créées avant cette date : pas envoyées d'office (l'historique
  -- s'envoie à la demande). Posée à la première passe du worker.
  sync_from timestamptz,
  item_id text,
  item_name text,
  deposit_account_id text,
  deposit_account_name text,
  deposit_account_online_id text,
  deposit_account_online_name text,
  tax_code_taxable_id text,
  tax_code_exempt_id text,
  -- { "card": {"id": "3", "name": "Carte de crédit"}, "cash": {...}, ... }
  payment_methods jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.quickbooks_settings is
  'Synchro QuickBooks : réglages par bureau (produit, comptes de dépôt, codes de taxe, moyens de paiement).';
alter table public.quickbooks_settings enable row level security;
alter table public.quickbooks_settings force row level security;
revoke all on table public.quickbooks_settings from anon, authenticated;

-- ── 2. Correspondance Lume → QuickBooks ─────────────────────────
-- realm_id : une reconnexion à une AUTRE compagnie QuickBooks repart de
-- zéro au lieu de viser des identifiants d'une autre comptabilité.
create table if not exists public.quickbooks_entity_map (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  realm_id text not null,
  entity_type text not null check (entity_type in ('client', 'invoice', 'payment')),
  lume_id uuid not null,
  qbo_id text not null,
  qbo_doc_number text,
  last_synced_at timestamptz not null default now(),
  -- 'active' | 'voided' | 'deleted' côté QuickBooks
  qbo_state text not null default 'active',
  created_at timestamptz not null default now(),
  unique (org_id, realm_id, entity_type, lume_id)
);
comment on table public.quickbooks_entity_map is
  'Synchro QuickBooks : identifiant QuickBooks de chaque client / facture / paiement Lume déjà envoyé.';
create index if not exists idx_qbo_map_qbo on public.quickbooks_entity_map (org_id, realm_id, entity_type, qbo_id);
alter table public.quickbooks_entity_map enable row level security;
alter table public.quickbooks_entity_map force row level security;
revoke all on table public.quickbooks_entity_map from anon, authenticated;

-- ── 3. File d'envoi ─────────────────────────────────────────────
-- status : pending → processing → done | error | skipped | superseded
create table if not exists public.quickbooks_sync_queue (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity_type text not null check (entity_type in ('client', 'invoice', 'payment')),
  entity_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'error', 'skipped', 'superseded')),
  -- 'history' : envoyée à la demande, passe outre sync_from.
  reason text,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.quickbooks_sync_queue is
  'Synchro QuickBooks : file d''envoi alimentée par triggers, vidée par le worker serveur.';
-- Une seule ligne en attente par entité : dix modifications d'affilée = un envoi.
create unique index if not exists uq_qbo_queue_pending
  on public.quickbooks_sync_queue (org_id, entity_type, entity_id) where status = 'pending';
create index if not exists idx_qbo_queue_ready
  on public.quickbooks_sync_queue (next_attempt_at) where status = 'pending';
create index if not exists idx_qbo_queue_org
  on public.quickbooks_sync_queue (org_id, status, updated_at desc);
alter table public.quickbooks_sync_queue enable row level security;
alter table public.quickbooks_sync_queue force row level security;
revoke all on table public.quickbooks_sync_queue from anon, authenticated;

-- ── 4. Mise en file ─────────────────────────────────────────────
create or replace function public.quickbooks_enqueue(p_org uuid, p_type text, p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_org is null or p_id is null then return; end if;
  if not exists (
    select 1 from public.app_connections c
    where c.org_id = p_org and c.app_id = 'quickbooks'
      and c.status in ('connected', 'token_expired')
  ) then
    return;
  end if;
  if exists (select 1 from public.quickbooks_settings s where s.org_id = p_org and s.enabled = false) then
    return;
  end if;

  insert into public.quickbooks_sync_queue (org_id, entity_type, entity_id, reason)
  values (p_org, p_type, p_id, p_reason)
  on conflict (org_id, entity_type, entity_id) where status = 'pending'
  do update set next_attempt_at = now(), updated_at = now(),
                reason = coalesce(public.quickbooks_sync_queue.reason, excluded.reason);
exception when others then
  -- La synchro comptable ne doit JAMAIS bloquer l'écriture d'une facture
  -- ou d'un paiement : on journalise et on laisse passer.
  raise warning 'quickbooks_enqueue(%, %, %) : %', p_org, p_type, p_id, sqlerrm;
end;
$$;
revoke all on function public.quickbooks_enqueue(uuid, text, uuid, text) from public, anon, authenticated;

-- Factures : tout ce qui change le document comptable. Les seules
-- variations paid_cents / balance_cents viennent des paiements, déjà
-- envoyés pour eux-mêmes.
create or replace function public.quickbooks_trg_invoices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'draft' then
      perform public.quickbooks_enqueue(new.org_id, 'invoice', new.id);
    end if;
    return null;
  end if;

  if new.status = 'draft' and old.status = 'draft' then return null; end if;
  if new.status is distinct from old.status
     or new.deleted_at is distinct from old.deleted_at
     or new.total_cents is distinct from old.total_cents
     or new.subtotal_cents is distinct from old.subtotal_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.client_id is distinct from old.client_id
     or new.invoice_number is distinct from old.invoice_number
     or new.due_date is distinct from old.due_date
     or new.issued_at is distinct from old.issued_at
     or new.subject is distinct from old.subject then
    perform public.quickbooks_enqueue(new.org_id, 'invoice', new.id);
  end if;
  return null;
exception when others then
  raise warning 'quickbooks_trg_invoices : %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_quickbooks_invoices on public.invoices;
create trigger trg_quickbooks_invoices
  after insert or update on public.invoices
  for each row execute function public.quickbooks_trg_invoices();

-- Lignes de facture : la facture parente, si elle n'est plus brouillon.
create or replace function public.quickbooks_trg_invoice_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_org uuid;
begin
  select i.org_id into v_org from public.invoices i
  where i.id = v_invoice and i.status is distinct from 'draft';
  if v_org is not null then
    perform public.quickbooks_enqueue(v_org, 'invoice', v_invoice);
  end if;
  return null;
exception when others then
  raise warning 'quickbooks_trg_invoice_items : %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_quickbooks_invoice_items on public.invoice_items;
create trigger trg_quickbooks_invoice_items
  after insert or update or delete on public.invoice_items
  for each row execute function public.quickbooks_trg_invoice_items();

-- Paiements : ceux rattachés à une facture (création, statut, montant,
-- suppression). Une suppression physique laisse la correspondance :
-- le worker supprime alors le paiement QuickBooks.
create or replace function public.quickbooks_trg_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then
      perform public.quickbooks_enqueue(old.org_id, 'payment', old.id);
    end if;
    return null;
  end if;
  if new.invoice_id is null and (tg_op = 'INSERT' or old.invoice_id is null) then
    return null;
  end if;
  if tg_op = 'INSERT'
     or new.status is distinct from old.status
     or new.amount_cents is distinct from old.amount_cents
     or new.invoice_id is distinct from old.invoice_id
     or new.method is distinct from old.method
     or new.payment_date is distinct from old.payment_date
     or new.deleted_at is distinct from old.deleted_at then
    perform public.quickbooks_enqueue(new.org_id, 'payment', new.id);
  end if;
  return null;
exception when others then
  raise warning 'quickbooks_trg_payments : %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_quickbooks_payments on public.payments;
create trigger trg_quickbooks_payments
  after insert or update or delete on public.payments
  for each row execute function public.quickbooks_trg_payments();

-- Clients : seulement ceux déjà présents dans QuickBooks (un client sans
-- facture envoyée n'a rien à y faire).
create or replace function public.quickbooks_trg_clients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.first_name, new.last_name, new.company, new.email, new.phone, new.address)
     is distinct from (old.first_name, old.last_name, old.company, old.email, old.phone, old.address)
     and exists (
       select 1 from public.quickbooks_entity_map m
       where m.org_id = new.org_id and m.entity_type = 'client' and m.lume_id = new.id
     ) then
    perform public.quickbooks_enqueue(new.org_id, 'client', new.id);
  end if;
  return null;
exception when others then
  raise warning 'quickbooks_trg_clients : %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_quickbooks_clients on public.clients;
create trigger trg_quickbooks_clients
  after update on public.clients
  for each row execute function public.quickbooks_trg_clients();

revoke all on function public.quickbooks_trg_invoices() from public, anon, authenticated;
revoke all on function public.quickbooks_trg_invoice_items() from public, anon, authenticated;
revoke all on function public.quickbooks_trg_payments() from public, anon, authenticated;
revoke all on function public.quickbooks_trg_clients() from public, anon, authenticated;

-- ── 5. Réclamation par le worker ────────────────────────────────
-- SKIP LOCKED : deux instances du serveur ne prennent jamais la même
-- ligne. Une ligne restée « processing » plus de 10 min (serveur tué en
-- plein envoi) redevient disponible. Ordre : clients, factures, puis
-- paiements (un paiement vise une facture déjà envoyée).
create or replace function public.quickbooks_claim_jobs(p_limit integer default 20)
returns setof public.quickbooks_sync_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quickbooks_sync_queue q
     set status = 'pending', locked_at = null, updated_at = now()
   where q.status = 'processing' and q.locked_at < now() - interval '10 minutes'
     and not exists (
       select 1 from public.quickbooks_sync_queue p
       where p.status = 'pending' and p.org_id = q.org_id
         and p.entity_type = q.entity_type and p.entity_id = q.entity_id
     );

  return query
  with claimed as (
    update public.quickbooks_sync_queue q
       set status = 'processing', attempts = q.attempts + 1, locked_at = now(), updated_at = now()
     where q.id in (
       select c.id from public.quickbooks_sync_queue c
        where c.status = 'pending' and c.next_attempt_at <= now()
        order by case c.entity_type when 'client' then 0 when 'invoice' then 1 else 2 end, c.created_at
        limit greatest(1, least(p_limit, 100))
        for update skip locked
     )
    returning q.*
  )
  select * from claimed
  order by case claimed.entity_type when 'client' then 0 when 'invoice' then 1 else 2 end, claimed.created_at;
end;
$$;
revoke all on function public.quickbooks_claim_jobs(integer) from public, anon, authenticated;
grant execute on function public.quickbooks_claim_jobs(integer) to service_role;

-- ── 6. Envoi de l'historique à la demande ───────────────────────
-- Factures non brouillon créées depuis p_from, puis leurs paiements.
create or replace function public.quickbooks_enqueue_history(p_org uuid, p_from timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select i.id from public.invoices i
    where i.org_id = p_org and i.deleted_at is null
      and i.status not in ('draft', 'void')
      and coalesce(i.issued_at, i.created_at) >= p_from
  loop
    perform public.quickbooks_enqueue(p_org, 'invoice', r.id, 'history');
    v_count := v_count + 1;
  end loop;

  for r in
    select p.id from public.payments p
    join public.invoices i on i.id = p.invoice_id
    where p.org_id = p_org and p.deleted_at is null and p.status = 'succeeded'
      and i.deleted_at is null and i.status not in ('draft', 'void')
      and coalesce(i.issued_at, i.created_at) >= p_from
  loop
    perform public.quickbooks_enqueue(p_org, 'payment', r.id, 'history');
  end loop;

  return v_count;
end;
$$;
revoke all on function public.quickbooks_enqueue_history(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.quickbooks_enqueue_history(uuid, timestamptz) to service_role;

commit;
