-- Deux tâches créées en même temps ne reçoivent plus le même numéro.
--
-- POURQUOI (audit V2, D-09)
-- generate_task_public_id() calcule max()+1 sans verrou : deux insertions
-- simultanées dans le même bureau (deux automatisations « créer une tâche »
-- sur le même événement, une rafale) lisaient le même max et la 2e échouait
-- sur « duplicate key tasks_org_public_id_idx » — tâche perdue. Mesuré sur
-- staging sous charge.
--
-- CE QUI CHANGE
-- Un verrou transactionnel PAR BUREAU avant le calcul : la 2e insertion
-- attend la fin de la 1re et voit son numéro. Aucun effet entre bureaux.
--
-- DOWN : recréer la fonction sans la ligne pg_advisory_xact_lock (corps
-- d'origine dans supabase/baseline/01_schema.sql).

create or replace function public.generate_task_public_id()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  next_num integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('task_public_id:' || NEW.org_id::text, 0));

  select coalesce(max(
    cast(replace(public_id, 'TASK-', '') as integer)
  ), 1000) + 1
  into next_num
  from public.tasks
  where org_id = NEW.org_id
    and public_id like 'TASK-%';

  NEW.public_id := 'TASK-' || next_num;
  return NEW;
end;
$function$;

-- Moindre privilège : les défauts Supabase accordent EXECUTE à anon et
-- authenticated ; une fonction de trigger n'a pas à être appelable.
revoke all on function public.generate_task_public_id() from public;
revoke all on function public.generate_task_public_id() from anon;
revoke all on function public.generate_task_public_id() from authenticated;
grant all on function public.generate_task_public_id() to service_role;
