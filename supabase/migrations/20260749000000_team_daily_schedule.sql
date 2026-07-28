/* ═══════════════════════════════════════════════════════════════
   Migration — Team Daily Schedule (horaire par membre et par date)

   Les équipes deviennent des unités permanentes (nom, couleur, ordre)
   dont la COMPOSITION change selon la journée :

   - team_schedule_assignments : un membre ⇄ une équipe pour UNE date,
     avec heures de début/fin. Source de vérité pour « qui est dans
     Team 1 mardi ». Les lignes `removed` masquent une occurrence
     récurrente pour une date précise (exception négative).
   - recurring_team_schedules  : modèle hebdomadaire (jour de semaine
     0=dimanche … 6=samedi, plage effective). Jamais matérialisé :
     résolu dynamiquement côté client. Une modification « à partir de
     cette date » SCINDE la série (effective_end_date sur l'ancienne
     ligne + nouvelle ligne), donc les dates passées restent résolues
     par l'ancienne ligne — l'historique ne bouge jamais.
   - time_off_requests         : congés / absences / indisponibilités.
     Prioritaires sur tout le reste une fois approuvés.
   - team_schedule_audit       : journal des modifications d'horaire.

   Ordre de priorité à la résolution (client) :
     1. congé approuvé  2. exception/assignation manuelle du jour
     3. horaire récurrent  4. rien.

   Backfill : les appartenances permanentes actuelles
   (team_assignments, sinon memberships.team_id des techniciens)
   deviennent un horaire récurrent Lun–Ven 08:00–17:00 — aucune
   donnée existante n'est modifiée ni supprimée.
   ═══════════════════════════════════════════════════════════════ */

-- ─── teams : ordre d'affichage permanent ───────────────────────
alter table public.teams
  add column if not exists display_order integer not null default 0;

-- Backfill : ordre alphabétique initial par org (uniquement les lignes
-- encore à 0 pour rester idempotent).
with ranked as (
  select id, row_number() over (partition by org_id order by name, created_at) as rn
  from public.teams
  where deleted_at is null
)
update public.teams t
set display_order = r.rn
from ranked r
where r.id = t.id
  and t.display_order = 0;

-- ─── team_schedule_assignments ─────────────────────────────────
create table if not exists public.team_schedule_assignments (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.orgs(id) on delete cascade,
  team_id               uuid not null references public.teams(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  work_date             date not null,
  start_time            time not null default '08:00',
  end_time              time not null default '17:00',
  -- available : présent aux heures indiquées
  -- unavailable : marqué indisponible ce jour-là (visible, non planifiable)
  -- removed : exception négative — masque l'occurrence récurrente du jour
  availability_status   text not null default 'available'
                        check (availability_status in ('available', 'unavailable', 'removed')),
  note                  text,
  -- manual : posé à la main | exception : dérogation d'une récurrence
  -- copy : issu d'une copie de jour/semaine
  source                text not null default 'manual'
                        check (source in ('manual', 'exception', 'copy')),
  recurring_schedule_id uuid,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint tsa_end_after_start check (end_time > start_time),
  constraint tsa_no_exact_duplicate unique (team_id, user_id, work_date, start_time)
);

create index if not exists idx_tsa_org_date  on public.team_schedule_assignments(org_id, work_date);
create index if not exists idx_tsa_team_date on public.team_schedule_assignments(team_id, work_date);
create index if not exists idx_tsa_user_date on public.team_schedule_assignments(user_id, work_date);

-- ─── recurring_team_schedules ──────────────────────────────────
create table if not exists public.recurring_team_schedules (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.orgs(id) on delete cascade,
  team_id              uuid not null references public.teams(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  day_of_week          smallint not null check (day_of_week between 0 and 6), -- 0=dimanche … 6=samedi (Date.getDay)
  start_time           time not null default '08:00',
  end_time             time not null default '17:00',
  effective_start_date date not null default current_date,
  effective_end_date   date,
  recurrence_rule      text not null default 'weekly',
  is_active            boolean not null default true,
  created_by           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint rts_end_after_start check (end_time > start_time),
  constraint rts_valid_range check (effective_end_date is null or effective_end_date >= effective_start_date)
);

create index if not exists idx_rts_org_team on public.recurring_team_schedules(org_id, team_id);
create index if not exists idx_rts_user     on public.recurring_team_schedules(user_id);

-- FK douce assignation → récurrence (après création des deux tables).
do $$ begin
  alter table public.team_schedule_assignments
    add constraint tsa_recurring_fkey
    foreign key (recurring_schedule_id) references public.recurring_team_schedules(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ─── time_off_requests ─────────────────────────────────────────
create table if not exists public.time_off_requests (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  all_day     boolean not null default true,
  start_time  time,
  end_time    time,
  kind        text not null default 'time_off'
              check (kind in ('time_off', 'vacation', 'sick', 'absence', 'unavailable', 'other')),
  status      text not null default 'approved'
              check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason      text,
  note        text,
  approved_by uuid references auth.users(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tor_valid_range check (end_date >= start_date),
  constraint tor_partial_times check (all_day or (start_time is not null and end_time is not null and end_time > start_time))
);

create index if not exists idx_tor_org_dates on public.time_off_requests(org_id, start_date, end_date);
create index if not exists idx_tor_user      on public.time_off_requests(user_id);

-- ─── team_schedule_audit ───────────────────────────────────────
create table if not exists public.team_schedule_audit (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.orgs(id) on delete cascade,
  actor_id       uuid references auth.users(id) on delete set null,
  action         text not null,
  team_id        uuid,
  target_user_id uuid,
  work_date      date,
  old_value      jsonb,
  new_value      jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists idx_tsaud_org on public.team_schedule_audit(org_id, created_at desc);

-- ─── updated_at trigger partagé ────────────────────────────────
create or replace function public.set_team_schedule_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tsa_updated on public.team_schedule_assignments;
create trigger trg_tsa_updated
  before update on public.team_schedule_assignments
  for each row execute function public.set_team_schedule_updated_at();

drop trigger if exists trg_rts_updated on public.recurring_team_schedules;
create trigger trg_rts_updated
  before update on public.recurring_team_schedules
  for each row execute function public.set_team_schedule_updated_at();

drop trigger if exists trg_tor_updated on public.time_off_requests;
create trigger trg_tor_updated
  before update on public.time_off_requests
  for each row execute function public.set_team_schedule_updated_at();

-- ─── Garde-fous : chevauchement + équipe archivée ──────────────
-- Un même user ne peut pas être « available » dans deux équipes sur des
-- plages qui se chevauchent la même journée (deux équipes le même jour =
-- permis si les plages sont disjointes). On bloque aussi les assignations
-- sur une équipe archivée/supprimée.
create or replace function public.check_team_schedule_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.availability_status = 'available' then
    if exists (
      select 1 from public.teams t
      where t.id = new.team_id
        and (t.deleted_at is not null or t.is_active = false)
    ) then
      raise exception 'TEAM_ARCHIVED: cannot assign to an archived team'
        using errcode = 'P0001';
    end if;

    if exists (
      select 1 from public.team_schedule_assignments a
      where a.user_id = new.user_id
        and a.work_date = new.work_date
        and a.id is distinct from new.id
        and a.availability_status = 'available'
        and a.start_time < new.end_time
        and a.end_time > new.start_time
    ) then
      raise exception 'SCHEDULE_OVERLAP: user is already assigned during these hours'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tsa_validate on public.team_schedule_assignments;
create trigger trg_tsa_validate
  before insert or update on public.team_schedule_assignments
  for each row execute function public.check_team_schedule_assignment();

-- ─── RLS ───────────────────────────────────────────────────────
alter table public.team_schedule_assignments enable row level security;
alter table public.recurring_team_schedules  enable row level security;
alter table public.time_off_requests         enable row level security;
alter table public.team_schedule_audit       enable row level security;

-- Lecture : tout membre de l'org (un technicien voit l'horaire, le sien
-- comme celui des autres équipes de son org).
-- Écriture : owner/admin seulement — les techniciens ne modifient pas
-- l'horaire général. Exception : un membre peut créer sa PROPRE demande
-- de congé en statut pending, et l'annuler tant qu'elle est pending.

do $$ begin
  create policy tsa_select on public.team_schedule_assignments for select using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tsa_insert on public.team_schedule_assignments for insert with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tsa_update on public.team_schedule_assignments for update using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tsa_delete on public.team_schedule_assignments for delete using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy rts_select on public.recurring_team_schedules for select using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy rts_insert on public.recurring_team_schedules for insert with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy rts_update on public.recurring_team_schedules for update using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy rts_delete on public.recurring_team_schedules for delete using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tor_select on public.time_off_requests for select using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tor_insert on public.time_off_requests for insert with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
    or (
      user_id = auth.uid()
      and status = 'pending'
      and org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
    )
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tor_update on public.time_off_requests for update using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
    or (user_id = auth.uid() and status = 'pending')
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tor_delete on public.time_off_requests for delete using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid() and m.role in ('owner', 'admin'))
    or (user_id = auth.uid() and status = 'pending')
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tsaud_select on public.team_schedule_audit for select using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy tsaud_insert on public.team_schedule_audit for insert with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

-- ─── Backfill : membres permanents → horaire récurrent Lun–Ven ─
-- 1) Appartenances N↔N explicites (team_assignments).
insert into public.recurring_team_schedules (org_id, team_id, user_id, day_of_week, start_time, end_time, effective_start_date)
select ta.org_id, ta.team_id, ta.user_id, dow, '08:00'::time, '17:00'::time, current_date
from public.team_assignments ta
cross join generate_series(1, 5) as dow
where exists (
        select 1 from public.teams t
        where t.id = ta.team_id and t.deleted_at is null and t.is_active = true
      )
  and not exists (
        select 1 from public.recurring_team_schedules r
        where r.team_id = ta.team_id and r.user_id = ta.user_id and r.day_of_week = dow
      );

-- 2) Équipe d'attache des techniciens (memberships.team_id) sans ligne N↔N.
insert into public.recurring_team_schedules (org_id, team_id, user_id, day_of_week, start_time, end_time, effective_start_date)
select m.org_id, m.team_id, m.user_id, dow, '08:00'::time, '17:00'::time, current_date
from public.memberships m
cross join generate_series(1, 5) as dow
where m.team_id is not null
  and m.role = 'technician'
  and exists (
        select 1 from public.teams t
        where t.id = m.team_id and t.deleted_at is null and t.is_active = true
      )
  and not exists (
        select 1 from public.team_assignments ta
        where ta.user_id = m.user_id and ta.team_id = m.team_id
      )
  and not exists (
        select 1 from public.recurring_team_schedules r
        where r.team_id = m.team_id and r.user_id = m.user_id and r.day_of_week = dow
      );

-- PostgREST : recharge le cache de schéma (nouvelles tables).
notify pgrst, 'reload schema';
