-- Fermer (archiver) un bureau, et le rouvrir (plan multi-bureaux, étape 12 ;
-- Q15 par défaut : on ARCHIVE, on ne supprime jamais).
--
-- Fermer un bureau :
--   * le retire du sélecteur (orgs.archived_at) — ses données restent intactes ;
--   * arrête ce qui agit tout seul : automatisations, tâches en attente,
--     récurrences de jobs, factures récurrentes, rappels, rapports programmés ;
--   * suspend l'accès des membres qui ne sont pas propriétaires (depuis
--     20260927180000, une adhésion suspendue ne donne plus aucun accès) ;
--   * note dans orgs.fermeture_details exactement ce qui a été coupé, pour que
--     « Rouvrir » remette CES éléments-là et rien d'autre.
-- Garde-fous : propriétaire actif seulement ; jamais le dernier bureau actif de
-- l'entreprise ; jamais le bureau qui porte l'abonnement (le déplacer d'abord).
-- Le numéro SMS n'est PAS libéré (il se reprend mal) : l'interface le dit.

alter table public.orgs
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid,
  add column if not exists fermeture_details jsonb;
comment on column public.orgs.archived_at is 'Bureau fermé (archivé) : masqué du sélecteur, données conservées. Voir fermer_bureau / rouvrir_bureau.';
comment on column public.orgs.fermeture_details is 'Ce que fermer_bureau a désactivé (pour que rouvrir_bureau le remette exactement).';

create or replace function public.fermer_bureau(p_org uuid, p_raison text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_groupe uuid;
  v_membres uuid[];
  v_regles uuid[];
  v_recurrences uuid[];
  v_factures uuid[];
  v_rapports uuid[];
  v_rappels boolean;
  v_taches int;
  v_details jsonb;
begin
  if v_uid is null or not public.has_org_role(v_uid, p_org, array['owner']) then
    raise exception 'Seul un propriétaire peut fermer un bureau.' using errcode = '42501';
  end if;
  select company_group_id into v_groupe from public.orgs where id = p_org and archived_at is null and deleted_at is null;
  if v_groupe is null then
    raise exception 'Bureau introuvable ou déjà fermé.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.orgs where company_group_id = v_groupe and id <> p_org and archived_at is null and deleted_at is null) then
    raise exception 'C''est le dernier bureau actif de l''entreprise : il ne peut pas être fermé.' using errcode = '22023';
  end if;
  if exists (select 1 from public.subscriptions where org_id = p_org and status in ('active', 'trialing', 'past_due')) then
    raise exception 'Ce bureau porte l''abonnement de l''entreprise : contactez le support Lume pour le déplacer avant de le fermer.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('fermeture:' || p_org::text, 0));

  select coalesce(array_agg(user_id), '{}') into v_membres from public.memberships
   where org_id = p_org and role <> 'owner' and coalesce(status, 'active') = 'active';
  update public.memberships set status = 'suspended' where org_id = p_org and user_id = any(v_membres);

  select coalesce(array_agg(id), '{}') into v_regles from public.automation_rules where org_id = p_org and is_active;
  update public.automation_rules set is_active = false where id = any(v_regles);
  update public.automation_scheduled_tasks set status = 'cancelled' where org_id = p_org and status = 'pending';
  get diagnostics v_taches = row_count;

  select coalesce(array_agg(id), '{}') into v_recurrences from public.job_recurrence_rules where org_id = p_org and is_active;
  update public.job_recurrence_rules set is_active = false where id = any(v_recurrences);
  select coalesce(array_agg(id), '{}') into v_factures from public.recurring_invoice_schedules where org_id = p_org and is_active;
  update public.recurring_invoice_schedules set is_active = false where id = any(v_factures);
  select coalesce(array_agg(id), '{}') into v_rapports from public.scheduled_reports where org_id = p_org and enabled;
  update public.scheduled_reports set enabled = false where id = any(v_rapports);
  select coalesce(bool_or(enabled), false) into v_rappels from public.reminder_settings where org_id = p_org;
  update public.reminder_settings set enabled = false where org_id = p_org and enabled;

  v_details := jsonb_build_object(
    'membres', to_jsonb(v_membres), 'regles', to_jsonb(v_regles), 'recurrences', to_jsonb(v_recurrences),
    'factures_recurrentes', to_jsonb(v_factures), 'rapports', to_jsonb(v_rapports), 'rappels', v_rappels,
    'taches_annulees', v_taches, 'raison', p_raison, 'ferme_le', now());
  update public.orgs set archived_at = now(), archived_by = v_uid, fermeture_details = v_details where id = p_org;

  return jsonb_build_object('membres_suspendus', cardinality(v_membres), 'automatisations', cardinality(v_regles),
    'taches_annulees', v_taches, 'recurrences', cardinality(v_recurrences) + cardinality(v_factures));
end;
$function$;

create or replace function public.rouvrir_bureau(p_org uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  d jsonb;
  v_membres int;
begin
  if v_uid is null or not public.has_org_role(v_uid, p_org, array['owner']) then
    raise exception 'Seul un propriétaire peut rouvrir un bureau.' using errcode = '42501';
  end if;
  select fermeture_details into d from public.orgs where id = p_org and archived_at is not null;
  if not found then
    raise exception 'Ce bureau n''est pas fermé.' using errcode = '22023';
  end if;
  d := coalesce(d, '{}'::jsonb);

  update public.memberships set status = 'active'
   where org_id = p_org and status = 'suspended'
     and user_id in (select (jsonb_array_elements_text(coalesce(d->'membres', '[]')))::uuid);
  get diagnostics v_membres = row_count;
  update public.automation_rules set is_active = true
   where org_id = p_org and id in (select (jsonb_array_elements_text(coalesce(d->'regles', '[]')))::uuid);
  update public.job_recurrence_rules set is_active = true
   where org_id = p_org and id in (select (jsonb_array_elements_text(coalesce(d->'recurrences', '[]')))::uuid);
  update public.recurring_invoice_schedules set is_active = true
   where org_id = p_org and id in (select (jsonb_array_elements_text(coalesce(d->'factures_recurrentes', '[]')))::uuid);
  update public.scheduled_reports set enabled = true
   where org_id = p_org and id in (select (jsonb_array_elements_text(coalesce(d->'rapports', '[]')))::uuid);
  if coalesce((d->>'rappels')::boolean, false) then
    update public.reminder_settings set enabled = true where org_id = p_org;
  end if;

  update public.orgs set archived_at = null, archived_by = null, fermeture_details = null where id = p_org;
  return jsonb_build_object('membres_reactives', v_membres);
end;
$function$;

revoke all on function public.fermer_bureau(uuid, text) from public, anon;
revoke all on function public.rouvrir_bureau(uuid) from public, anon;
grant execute on function public.fermer_bureau(uuid, text) to authenticated;
grant execute on function public.rouvrir_bureau(uuid) to authenticated;
