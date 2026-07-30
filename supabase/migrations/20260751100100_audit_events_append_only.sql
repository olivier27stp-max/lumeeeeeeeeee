-- ============================================================================
-- N4.7 — Journal d'audit append-only
-- ============================================================================
-- Constat audit : service_role detient UPDATE et DELETE sur audit_events.
-- Un journal d'audit modifiable ne prouve rien le jour ou il faut prouver
-- quelque chose (Loi 25, notification CAI).
--
-- On revoque UPDATE/DELETE a tout le monde sauf postgres (proprietaire, requis
-- pour les migrations et la purge par retention).
--
-- NOTE : postgres conserve UPDATE/DELETE par necessite operationnelle. Le trigger
-- ci-dessous bloque les modifications quel que soit le role, y compris postgres,
-- SAUF quand le flag de session app.audit_maintenance est explicitement pose.
-- C'est ce qui rend le journal reellement append-only plutot que « append-only
-- pour ceux qui n'ont pas les droits ».
-- ============================================================================

revoke update, delete on public.audit_events from service_role;
revoke update, delete on public.audit_events from authenticated;
revoke update, delete on public.audit_events from anon;

-- ----------------------------------------------------------------------------
-- Verrou structurel : meme le proprietaire ne peut pas modifier l'historique
-- sans poser explicitement le flag de maintenance (purge par retention).
-- ----------------------------------------------------------------------------
create or replace function public.audit_events_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Purge par retention : SET LOCAL app.audit_maintenance = 'on' dans la
  -- transaction. SET LOCAL est obligatoire (N7.3 : en mode pooling
  -- transaction, un SET de session fuit vers la requete suivante).
  if coalesce(current_setting('app.audit_maintenance', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;

  raise exception
    'audit_events est append-only : % interdit.', tg_op
    using errcode = '42501';
end $$;

drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.audit_events_append_only();

drop trigger if exists audit_events_no_delete on public.audit_events;
create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.audit_events_append_only();

comment on function public.audit_events_append_only() is
  'N4.7 : rend audit_events append-only. Purge par retention : '
  'SET LOCAL app.audit_maintenance = ''on'' dans la transaction.';
