-- Moindre privilège sur les 3 fonctions SECURITY DEFINER des Dépenses / champs de base
-- (migrations 20260930120000 et 20260930123000).
--
-- Supabase accorde EXECUTE à anon + authenticated sur chaque nouvelle fonction
-- (DEFAULT PRIVILEGES) : sans ce revoke, cf_depenses_total_job(p_org, p_job)
-- était appelable en RPC et renvoyait le total des dépenses d'une job de
-- N'IMPORTE QUELLE entreprise. Les deux autres sont des triggers : elles n'ont
-- jamais à être appelées directement.
--
-- Aucun appelant client : seul le trigger cf_maj_depenses_job (SECURITY
-- DEFINER, donc exécuté en tant que propriétaire) appelle cf_depenses_total_job.
-- Un trigger se déclenche sans que l'utilisateur ait EXECUTE sur sa fonction.

revoke all on function public.cf_depenses_total_job(uuid, uuid) from public;
revoke execute on function public.cf_depenses_total_job(uuid, uuid) from anon, authenticated;
grant execute on function public.cf_depenses_total_job(uuid, uuid) to service_role;

revoke all on function public.cf_maj_depenses_job() from public;
revoke execute on function public.cf_maj_depenses_job() from anon, authenticated;

revoke all on function public.cf_job_client_lie() from public;
revoke execute on function public.cf_job_client_lie() from anon, authenticated;
