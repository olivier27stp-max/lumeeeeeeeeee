-- ════════════════════════════════════════════════════════════════
-- Dépenses par job + catalogue de dépenses réutilisables
--
-- Remplace le montant unique jobs.expenses_cents (saisi à la main dans
-- la carte Rentabilité) par de vraies lignes de dépense :
--   • expense_presets — catalogue org-scoped de dépenses réutilisables
--     (même idée que predefined_services pour les produits/services).
--   • job_expenses    — une ligne = une dépense sur un job (catégorie,
--     montant, date, note, reçu à venir). Soft delete via deleted_at.
--   • trigger sync_job_expenses_total — maintient jobs.expenses_cents =
--     SUM(lignes actives) pour que la carte Rentabilité (fetchJobPnL)
--     continue de fonctionner sans modification. SECURITY DEFINER car
--     jobs_update_org exige un rôle admin alors qu'un technicien doit
--     pouvoir logger une dépense sur le terrain.
--   • backfill — les montants déjà saisis deviennent une ligne « Dépenses
--     (avant détail) » pour ne rien perdre.
--
-- NB : public.job_materials (0 ligne, aucun code) couvrait une idée
-- voisine mais sans catégorie/soft-delete/trigger ; elle est laissée
-- intacte et pourra être droppée dans une migration dédiée.
-- Idempotent : relançable sans danger.
-- ════════════════════════════════════════════════════════════════

-- ── Catalogue ───────────────────────────────────────────────────
create table if not exists public.expense_presets (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  name                 text not null,
  category             text not null default 'autre'
    check (category in ('materiaux','essence','sous_traitance','equipement','autre')),
  default_amount_cents integer check (default_amount_cents is null or default_amount_cents >= 0),
  vendor               text,
  created_by           uuid default auth.uid() references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create index if not exists expense_presets_org_idx
  on public.expense_presets (org_id) where deleted_at is null;

comment on table public.expense_presets is
  'Catalogue org-scoped de dépenses réutilisables (nom, catégorie, montant par défaut) — pickées depuis la carte Dépenses du hub job et le détail Rentabilité.';

-- ── Lignes de dépense ───────────────────────────────────────────
create table if not exists public.job_expenses (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  job_id       uuid not null references public.jobs(id) on delete cascade,
  preset_id    uuid references public.expense_presets(id) on delete set null,
  name         text not null,
  category     text not null default 'autre'
    check (category in ('materiaux','essence','sous_traitance','equipement','autre')),
  amount_cents integer not null check (amount_cents >= 0),
  vendor       text,
  note         text,
  receipt_url  text,
  incurred_on  date not null default current_date,
  created_by   uuid default auth.uid() references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists job_expenses_org_job_idx
  on public.job_expenses (org_id, job_id);

comment on table public.job_expenses is
  'Dépenses détaillées par job. SUM(actives) est répliquée dans jobs.expenses_cents par trg_sync_job_expenses_total pour la carte Rentabilité.';

-- ── RLS (activée ET forcée — voir 20260830000000) ───────────────
alter table public.expense_presets enable row level security;
alter table public.expense_presets force row level security;
alter table public.job_expenses enable row level security;
alter table public.job_expenses force row level security;

drop policy if exists expense_presets_select_org on public.expense_presets;
create policy expense_presets_select_org on public.expense_presets
  for select using (public.has_org_membership((select auth.uid()), org_id));

drop policy if exists expense_presets_insert_org on public.expense_presets;
create policy expense_presets_insert_org on public.expense_presets
  for insert with check (
    public.has_org_membership((select auth.uid()), org_id)
    and created_by = (select auth.uid())
  );

drop policy if exists expense_presets_update_org on public.expense_presets;
create policy expense_presets_update_org on public.expense_presets
  for update using (public.has_org_membership((select auth.uid()), org_id))
  with check (public.has_org_membership((select auth.uid()), org_id));

drop policy if exists expense_presets_delete_org on public.expense_presets;
create policy expense_presets_delete_org on public.expense_presets
  for delete using (public.has_org_membership((select auth.uid()), org_id));

drop policy if exists job_expenses_select_org on public.job_expenses;
create policy job_expenses_select_org on public.job_expenses
  for select using (public.has_org_membership((select auth.uid()), org_id));

drop policy if exists job_expenses_insert_org on public.job_expenses;
create policy job_expenses_insert_org on public.job_expenses
  for insert with check (
    public.has_org_membership((select auth.uid()), org_id)
    and created_by = (select auth.uid())
  );

drop policy if exists job_expenses_update_org on public.job_expenses;
create policy job_expenses_update_org on public.job_expenses
  for update using (public.has_org_membership((select auth.uid()), org_id))
  with check (public.has_org_membership((select auth.uid()), org_id));

drop policy if exists job_expenses_delete_org on public.job_expenses;
create policy job_expenses_delete_org on public.job_expenses
  for delete using (public.has_org_membership((select auth.uid()), org_id));

-- ── Trigger : jobs.expenses_cents = SUM(lignes actives) ─────────
create or replace function public.sync_job_expenses_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new uuid := case when tg_op = 'DELETE' then null else new.job_id end;
  v_old uuid := case when tg_op = 'INSERT' then null else old.job_id end;
begin
  if v_new is not null then
    update public.jobs j
       set expenses_cents = coalesce((
             select sum(e.amount_cents)::integer
               from public.job_expenses e
              where e.job_id = j.id and e.deleted_at is null), 0)
     where j.id = v_new;
  end if;
  if v_old is not null and v_old is distinct from v_new then
    update public.jobs j
       set expenses_cents = coalesce((
             select sum(e.amount_cents)::integer
               from public.job_expenses e
              where e.job_id = j.id and e.deleted_at is null), 0)
     where j.id = v_old;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_sync_job_expenses_total on public.job_expenses;
create trigger trg_sync_job_expenses_total
  after insert or update or delete on public.job_expenses
  for each row execute function public.sync_job_expenses_total();

-- ── Backfill : montants déjà saisis → une ligne « avant détail » ─
insert into public.job_expenses (org_id, job_id, name, category, amount_cents, created_by)
select j.org_id, j.id, 'Dépenses (avant détail)', 'autre', j.expenses_cents, null
  from public.jobs j
 where j.expenses_cents > 0
   and j.deleted_at is null
   and not exists (select 1 from public.job_expenses e where e.job_id = j.id);
