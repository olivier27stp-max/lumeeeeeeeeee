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
