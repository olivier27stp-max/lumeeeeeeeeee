begin;

-- Fix Supabase linter warning: function_search_path_mutable
-- We set a stable search_path for the flagged functions in schema public.
do $$
declare
  fn_name text;
  fn record;
  flagged_names text[] := array[
    'payments_sync_dates_and_update',
    'mark_job_geocode_pending',
    'touch_org_billing_settings_updated_at',
    'set_updated_at',
    'normalize_lead_stage_value',
    'trg_normalize_lead_stage',
    'crm_leads_stage_timestamps',
    'crm_normalize_lead_stage',
    'sync_schedule_event_time_columns',
    'crm_is_org_member',
    'crm_is_org_admin',
    'payments_sync_legacy_dates',
    'job_line_items_set_totals'
  ];
begin
  foreach fn_name in array flagged_names loop
    for fn in
      select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = fn_name
    loop
      execute format(
        'alter function public.%I(%s) set search_path = public',
        fn.proname,
        fn.args
      );
    end loop;
  end loop;
end $$;

commit;
