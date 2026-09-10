-- ═══════════════════════════════════════════════════════════════
-- P3-I — run_retention_job() : une seule ligne d'audit par exécution
-- ───────────────────────────────────────────────────────────────
-- La fonction insérait une ligne d'audit IDENTIQUE par organisation chaque
-- nuit (boucle for v_system_org in select id from orgs). À 5 orgs c'est
-- anodin, mais ça croît linéairement avec les tenants et conservé 1095 jours.
-- On remplace la boucle par UN SEUL insert de niveau plateforme
-- (audit_events.org_id est NOT NULL → on rattache la ligne à une org système
-- stable si elle existe, sinon la 1re org active).
--
-- Reste STRICTEMENT identique par ailleurs (mêmes 6 purges, même jsonb de
-- retour, mêmes attributs). Corps récupéré depuis la prod, seule la boucle
-- change.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.run_retention_job()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_leads bigint; v_clients bigint; v_tokens bigint; v_audit bigint; v_members bigint; v_logins bigint;
  v_org uuid;
begin
  v_leads   := public.anonymize_inactive_leads(24);
  v_clients := public.anonymize_old_soft_deleted_clients(180);
  v_tokens  := public.purge_expired_portal_tokens();
  v_audit   := public.purge_old_audit_events(1095);
  v_members := public.execute_scheduled_member_deletions();
  v_logins  := public.purge_old_failed_logins();

  -- audit_events.org_id est NOT NULL : on rattache l'unique ligne de run à une
  -- org active (au lieu d'une ligne identique par org, cf. P3-I).
  select id into v_org from public.orgs where deleted_at is null order by created_at limit 1;
  if v_org is not null then
    insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
    values (v_org, null, 'retention_run', 'system', null,
      jsonb_build_object(
        'anonymized_leads', v_leads, 'anonymized_clients', v_clients,
        'purged_portal_tokens', v_tokens, 'purged_audit_events', v_audit,
        'hard_deleted_members', v_members, 'purged_failed_logins', v_logins,
        'scope', 'platform', 'at', now()));
  end if;

  return jsonb_build_object(
    'anonymized_leads', v_leads, 'anonymized_clients', v_clients,
    'purged_portal_tokens', v_tokens, 'purged_audit_events', v_audit,
    'hard_deleted_members', v_members, 'purged_failed_logins', v_logins);
end
$function$;

revoke all on function public.run_retention_job() from public, anon, authenticated;
