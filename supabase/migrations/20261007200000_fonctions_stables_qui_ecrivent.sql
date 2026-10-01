-- Accord de Rafba le 2026-10-01 (« met les migrations »). Staging d'abord, puis prod.
--
-- Trois fonctions sont déclarées STABLE alors qu'elles écrivent. PostgreSQL refuse un
-- UPDATE dans une fonction non VOLATILE (« UPDATE is not allowed in a non-volatile
-- function ») : l'appel échoue à tout coup.
--
--   restore_client(p_org_id, p_client_id)  — bouton « Restaurer » des Archives (src/lib/archiveApi.ts:40)
--   restore_job(p_org_id, p_job_id)        — bouton « Restaurer » des Archives (src/lib/archiveApi.ts:58)
--   finish_job(p_org_id, p_job_id)         — plus appelée par le code, corrigée par cohérence
--
-- Constaté en prod le 2026-10-01 (lecture seule, pg_proc.provolatile = 's' pour les trois ;
-- restore_lead, recréée plus tard, est bien VOLATILE). Origine : la passe « advisors » du
-- 2026-06-26 (20260626250000_fix_advisors_final.sql) a marqué STABLE des fonctions dont son
-- motif ne reconnaissait pas l'écriture (« update public.clients set … »).
--
-- Effet : rien d'autre que la volatilité. Corps, droits, search_path et SECURITY DEFINER
-- restent tels quels. Idempotente.

alter function public.restore_client(uuid, uuid) volatile;
alter function public.restore_job(uuid, uuid) volatile;
alter function public.finish_job(uuid, uuid) volatile;

-- Garde-fou : plus aucune fonction du schéma public ne doit être STABLE ou IMMUTABLE en écrivant.
do $$
declare
  fautives text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into fautives
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.provolatile in ('s', 'i')
    and l.lanname in ('plpgsql', 'sql')
    and (lower(p.prosrc) ~ '(^|[^a-z_])update\s+(public\.)?[a-z_]+\s+set\s'
      or lower(p.prosrc) ~ '(^|[^a-z_])insert\s+into\s'
      or lower(p.prosrc) ~ '(^|[^a-z_])delete\s+from\s');
  if fautives is not null then
    raise exception 'Fonctions non VOLATILE qui écrivent encore : %', fautives;
  end if;
end $$;
