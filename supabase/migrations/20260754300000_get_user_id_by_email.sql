-- get_user_id_by_email : la fonction que server/lib/supabase.ts (findUserByEmail)
-- et les invitations appellent depuis toujours… n'a jamais existé en base.
-- Le code retombait silencieusement sur une requête directe auth.users.
-- Verrouillée service_role : l'exposer aux clients serait un oracle à courriels.

create or replace function public.get_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;

revoke all on function public.get_user_id_by_email(text) from public;
revoke all on function public.get_user_id_by_email(text) from anon;
revoke all on function public.get_user_id_by_email(text) from authenticated;
grant execute on function public.get_user_id_by_email(text) to service_role;
