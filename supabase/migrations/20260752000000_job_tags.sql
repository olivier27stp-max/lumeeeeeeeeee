/* ═══════════════════════════════════════════════════════════════
   Migration — Job tags (étiquettes personnalisées par organisation)

   - job_tags : étiquettes nom + couleur, propres à chaque org.
     AUCUN tag par défaut — la liste démarre vide, tout est créé par
     l'utilisateur depuis le menu déroulant du hub job.
   - jobs.tag_ids : uuid[] des tags assignés à la job. Pas de table de
     jointure : le filtre de la liste Jobs utilise `contains` sur un
     index GIN. Un id de tag supprimé peut rester dans le tableau —
     inoffensif, le rendu ne montre que les tags encore existants.
   - jobs_active : DROP + CREATE (pas de OR REPLACE) car `j.*` est
     figé à la création de la vue et la nouvelle colonne apparaît
     AVANT derived_status — l'ordre des colonnes change.
   ═══════════════════════════════════════════════════════════════ */

-- ─── job_tags ──────────────────────────────────────────────────
create table if not exists public.job_tags (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  name       text not null,
  color_hex  text not null default '#b8c4b0',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_job_tags_org
  on public.job_tags (org_id)
  where deleted_at is null;

alter table public.job_tags enable row level security;

do $$ begin
  create policy job_tags_select on public.job_tags for select using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy job_tags_insert on public.job_tags for insert with check (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy job_tags_update on public.job_tags for update using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy job_tags_delete on public.job_tags for delete using (
    org_id in (select m.org_id from public.memberships m where m.user_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

-- ─── jobs.tag_ids ──────────────────────────────────────────────
alter table public.jobs
  add column if not exists tag_ids uuid[] not null default '{}';

create index if not exists idx_jobs_tag_ids
  on public.jobs using gin (tag_ids);

-- UPDATE sur jobs est contrôlé colonne par colonne en prod (voir
-- 20260751103400) : la nouvelle colonne doit recevoir son grant,
-- sinon l'assignation de tags depuis le hub échoue en 42501.
grant update (tag_ids) on public.jobs to authenticated;

-- ─── jobs_active : recréation avec la nouvelle colonne ─────────
-- Définition identique à 20260714000000_jobs_derived_status.sql;
-- seule l'expansion de j.* change (tag_ids inclus).
drop view if exists public.jobs_active;

create view public.jobs_active with (security_invoker = true) as
  select
    j.*,
    case
      when lower(coalesce(j.status, '')) = 'completed' and j.requires_invoicing
        then 'requires_invoicing'
      when lower(coalesce(j.status, '')) in ('completed', 'cancelled', 'canceled', 'archived')
        then 'archived'
      when exists (
        select 1 from public.schedule_events se
        where se.job_id = j.id
          and se.deleted_at is null
          and se.start_at >= now()
          and lower(coalesce(se.status, '')) <> 'cancelled'
      )
        then 'upcoming'
      when exists (
        select 1 from public.schedule_events se
        where se.job_id = j.id
          and se.deleted_at is null
          and se.start_at < now()
          and lower(coalesce(se.status, '')) not in ('completed', 'cancelled')
      )
        then 'late'
      else 'action_required'
    end as derived_status
  from public.jobs j
  where j.deleted_at is null;

-- Le DROP a effacé les privilèges de la vue : on les redonne
-- explicitement (leçon de 20260751103400_regrant_jobs_cents_update).
grant select on public.jobs_active to anon, authenticated, service_role;

-- Refresh PostgREST schema cache so the new column is queryable immediately.
notify pgrst, 'reload schema';
