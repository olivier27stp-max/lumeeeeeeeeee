-- ============================================================================
-- Le statut d'un client suit ses jobs — déclencheur manquant, et son verrou
-- ============================================================================
-- CONSTAT (2026-09-01, parcours complet du robot de recette)
-- Créer un job pour un client laisse celui-ci au statut « prospect ». Or
-- `src/pages/Clients.tsx:305` affirme le contraire, noir sur blanc :
--
--     « Le trigger DB jobs_sync_client_status fait autorité »
--
-- Ce déclencheur n'existait NI en test NI en production. La migration qui le
-- crée — 20260607010000_client_status_from_jobs.sql — n'a jamais été
-- appliquée : ni la fonction `sync_client_status_from_jobs`, ni le déclencheur
-- `trg_jobs_sync_client_status` n'étaient présents.
--
-- CONSÉQUENCE
-- Aucun client n'est aujourd'hui mal classé en production (les 32 « prospects »
-- n'ont effectivement aucun job). Le défaut est DORMANT : il se manifestera au
-- premier client à qui l'on ouvre un job. Le classement des clients — donc les
-- listes, les filtres et les automatisations qui s'y appuient — serait faux.
--
-- CE QUE FAIT CETTE MIGRATION
-- Elle rejoue 20260607010000 (idempotente, `create or replace`) et referme un
-- défaut que celle-ci laissait ouvert.
--
-- LE VERROU
-- `check_exposed_trigger_functions()` a signalé, juste après l'application sur
-- staging, que `jobs_sync_client_status` était appelable par `anon` — un
-- visiteur NON CONNECTÉ. Une fonction de déclencheur n'a aucune raison d'être
-- appelable directement : elle s'exécute en `security definer` et modifie des
-- clients. La règle du projet est explicite : toujours révoquer EXECUTE à
-- PUBLIC sur ce type de fonction.
--
-- Idempotent : ré-exécutable sans effet de bord.
-- ============================================================================

-- ── 1. La fonction de calcul ────────────────────────────────────────
create or replace function public.sync_client_status_from_jobs(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text;
begin
  if p_client_id is null then
    return;
  end if;

  -- Un client avec au moins un job vivant est « actif », sinon « prospect ».
  -- Les clients archivés à la main (« inactive ») ne sont jamais réactivés
  -- automatiquement : c'est une décision humaine.
  select case
           when exists (
             select 1 from public.jobs j
              where j.client_id = p_client_id and j.deleted_at is null
           ) then 'active'
           else 'lead'
         end
    into v_target;

  update public.clients
     set status = v_target
   where id = p_client_id
     and status is distinct from v_target
     and status <> 'inactive';
end;
$$;

-- ── 2. Le déclencheur ───────────────────────────────────────────────
create or replace function public.jobs_sync_client_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.sync_client_status_from_jobs(new.client_id);
  elsif tg_op = 'DELETE' then
    perform public.sync_client_status_from_jobs(old.client_id);
  else
    -- UPDATE : couvre la mise de côté, la restauration, et le changement
    -- de client — auquel cas les DEUX clients doivent être recalculés.
    perform public.sync_client_status_from_jobs(new.client_id);
    if old.client_id is distinct from new.client_id then
      perform public.sync_client_status_from_jobs(old.client_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_jobs_sync_client_status on public.jobs;
create trigger trg_jobs_sync_client_status
  after insert or update or delete on public.jobs
  for each row execute function public.jobs_sync_client_status();

-- ── 3. Le verrou — moindre privilège ────────────────────────────────
-- Ces deux fonctions tournent en `security definer` et modifient des clients.
-- Personne ne doit pouvoir les appeler directement : le déclencheur seul les
-- invoque, et il s'exécute avec les droits du propriétaire de la table.
revoke all on function public.jobs_sync_client_status() from public, anon, authenticated;
revoke all on function public.sync_client_status_from_jobs(uuid) from public, anon, authenticated;

-- ── 4. Un client sans job démarre « prospect » ──────────────────────
alter table public.clients alter column status set default 'lead';

-- ── 5. Remise à niveau des clients existants ────────────────────────
-- Ceux qui ont déjà des jobs mais sont restés « prospect » faute de
-- déclencheur. Les « inactive » sont laissés tels quels.
update public.clients c
   set status = 'active'
 where c.deleted_at is null
   and c.status not in ('active', 'inactive')
   and exists (select 1 from public.jobs j where j.client_id = c.id and j.deleted_at is null);

-- ── Vérification ────────────────────────────────────────────────────
do $$
declare
  n_expose int;
  n_incoherents int;
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'jobs' and t.tgname = 'trg_jobs_sync_client_status'
  ) then
    raise exception 'Le déclencheur trg_jobs_sync_client_status est absent.';
  end if;

  select count(*) into n_expose from public.check_exposed_trigger_functions();
  if n_expose > 0 then
    raise exception '% fonction(s) de déclencheur restent exposées.', n_expose;
  end if;

  select count(*) into n_incoherents
    from public.clients c
   where c.deleted_at is null and c.status = 'lead'
     and exists (select 1 from public.jobs j where j.client_id = c.id and j.deleted_at is null);

  raise notice 'Déclencheur en place, aucune fonction exposée, % client(s) encore incohérent(s).', n_incoherents;
end $$;
