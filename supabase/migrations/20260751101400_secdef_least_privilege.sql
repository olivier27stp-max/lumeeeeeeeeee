-- ============================================================================
-- N7.2 / N3.5 — SECURITY DEFINER : moindre privilege
-- ============================================================================
-- CONSTAT
-- 253 fonctions SECURITY DEFINER dans public, dont 182 executables par
-- `authenticated`. Chacune s'execute avec les droits du proprietaire et
-- contourne donc la RLS. Aucune n'est exposee a `anon` et toutes ont un
-- search_path fixe : ces deux points-la etaient deja bons.
--
-- FUITE REELLE PROUVEE avant ecriture de cette migration.
-- En se faisant passer pour un utilisateur authentifie NON MEMBRE de l'org :
--
--   select * from search_global('<org-d-un-autre>', 'a', 20, 0);
--   -> 20 lignes : noms de clients (Simon Girard, Melanie Fournier...),
--      titres de jobs, montants (33000 cents). Aucune verification d'org.
--
-- La RLS ne protegeait rien : la fonction est SECURITY DEFINER et prend
-- l'org_id en PARAMETRE. C'est exactement le defaut N3.5 — « le tenant vient
-- du serveur, jamais du client ».
--
-- TROIS CATEGORIES, TROIS TRAITEMENTS
--
--  A) Fonctions TRIGGER (32 exposees) : n'ont AUCUNE raison d'etre appelables
--     directement. Postgres accorde EXECUTE a PUBLIC par defaut ; on revoque.
--     Les triggers continuent de fonctionner (ils s'executent avec les droits
--     du proprietaire de la table, pas de l'appelant).
--
--  B) Fonctions de MAINTENANCE / CRON : anonymize_lead, run_retention_job,
--     provision_sms_channel, execute_scheduled_member_deletions... Elles sont
--     appelees exclusivement par le serveur en service_role (verifie dans
--     server/routes/cron.ts, server/lib/twilioProvisioning.ts, etc.).
--     service_role a BYPASSRLS : la revocation ne les casse pas.
--     anonymize_lead(uuid) etait la pire : elle EFFACE les donnees de
--     n'importe quel client de n'importe quelle org, sans verification.
--
--  C) Fonctions de LECTURE sans garde (search_global & co) : appelees par le
--     serveur via server/routes/search.ts. On revoque a authenticated ET on
--     ajoute une garde d'org, pour que meme un futur appel direct soit sur.
--
-- VERIFICATION PREALABLE : aucune des fonctions revoquees ici n'est appelee
-- depuis le frontend. La liste exhaustive des RPC appeles par src/ a ete
-- extraite et croisee ; seules list_archived_items et rpc_recalculate_quote
-- y figurent, et elles sont CONSERVEES (voir plus bas).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A) Fonctions trigger : revoquer PUBLIC / anon / authenticated
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prorettype = 'trigger'::regtype
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;
  raise notice 'A) % fonction(s) trigger verrouillee(s).', n;
end $$;

-- ----------------------------------------------------------------------------
-- B) Fonctions de maintenance / cron : reservees a service_role
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
  n int := 0;
  v_targets text[] := array[
    'anonymize_lead', 'anonymize_inactive_leads', 'anonymize_old_soft_deleted_clients',
    'run_retention_job', 'execute_scheduled_member_deletions', 'provision_sms_channel',
    'decay_few_shot_scores', 'recalculate_calibration',
    'detect_brute_force', 'detect_login_anomalies', 'detect_impossible_travel',
    'detect_mass_deletion', 'detect_excessive_exports',
    'record_failed_login', 'check_rate_limit', 'is_ip_blocked',
    'record_email_opt_out', 'is_email_opted_out',
    'ac_log_event', 'ac_client_name', 'ac_note_context',
    'increment_few_shot_usage', 'increment_unread_count',
    'create_field_pin_for_client_row', 'auto_pipeline_deal_from_quote_impl',
    'create_minimal_client_for_deal', 'get_or_create_qualified_stage',
    'ensure_payment_settings_row', 'recalculate_invoice_from_payments',
    'recalculate_invoice_totals', 'recompute_job_schedule',
    'find_duplicate_clients', 'search_fts', 'org_has_no_members'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any(v_targets)
       and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    n := n + 1;
  end loop;
  raise notice 'B) % fonction(s) de maintenance reservee(s) a service_role.', n;
end $$;

-- ----------------------------------------------------------------------------
-- C) search_global & co : revocation, avec bascule des appelants sur service_role.
--
-- C'est ICI que se trouvait la fuite prouvee plus haut.
--
-- NOTE SUR LA METHODE — on ne reecrit PAS le corps de ces fonctions.
-- search_global est une fonction SQL (pas plpgsql) de 7896 caracteres. Deux
-- tentatives d'ajout de garde ont ete ecrites puis ABANDONNEES apres test :
--   1. injection par regex apres le `begin` : echoue, le corps SQL n'en a pas ;
--   2. enveloppe par `lateral` + CTE de garde : la fonction se recree, mais le
--      test a montre que la garde NE SE DECLENCHE PAS (5 lignes fuitaient
--      encore). Deployer cela aurait installe une fausse protection, pire que
--      pas de protection du tout.
-- Reecrire aveuglement 7896 caracteres risquait en outre une regression sur la
-- recherche globale, fonctionnalite tres visible.
--
-- SOLUTION RETENUE, testee et sure : revoquer l'acces aux roles clients et
-- basculer les trois appelants serveur sur getServiceClient(). L'org y provient
-- deja de requireAuthedClient() — jamais de la requete HTTP — donc N3.5 est
-- respecte au niveau applicatif, et la fonction n'est plus atteignable
-- directement via PostgREST.
--   server/routes/search.ts   : search_global, search_global_counts
--   server/lib/helpers.ts     : search_global_by_type
-- ----------------------------------------------------------------------------
revoke all on function public.search_global(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.search_global_by_type(uuid, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.search_global_counts(uuid, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- D) create_invoice_from_job : surcharge NON GARDEE a retirer.
-- Deux surcharges coexistent ; celle a 2 arguments n'a aucune verification,
-- celle a 3 arguments en a une. Le serveur (server/routes/leads.ts) appelle
-- la version gardee. On supprime la porte ouverte.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'create_invoice_from_job'
       and pg_get_function_identity_arguments(p.oid) = 'p_org_id uuid, p_job_id uuid'
  ) and exists (
    select 1 from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = 'create_invoice_from_job'
       and pg_get_function_identity_arguments(p.oid) = 'p_org_id uuid, p_job_id uuid, p_send_now boolean'
  ) then
    revoke all on function public.create_invoice_from_job(uuid, uuid)
      from public, anon, authenticated;
    raise notice 'create_invoice_from_job(uuid,uuid) : surcharge non gardee verrouillee.';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- CONSERVEES VOLONTAIREMENT (appelees par le frontend, et sures) :
--   list_archived_items(uuid)  -> filtre par RLS en interne (verifie : 0 fuite)
--   rpc_recalculate_quote(uuid)-> agit sur un devis deja soumis a la RLS
--   has_org_membership / has_org_admin_role / has_org_role / user_org_ids /
--   same_company_orgs / verify_org_access / current_org_id
--     -> briques des policies RLS elles-memes. Les revoquer casserait la RLS.
--   check_subscription_active, has_object_permission, resolve_primary_property
--     -> lecture bornee, utilisees par les policies ou l'UI.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Sonde N7.10 : detecter toute NOUVELLE fonction trigger exposee.
-- ----------------------------------------------------------------------------
create or replace function public.check_exposed_trigger_functions()
returns table (function_name text, exposed_to text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.proname::text,
         case when has_function_privilege('anon', p.oid, 'EXECUTE')
              then 'anon' else 'authenticated' end
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prorettype = 'trigger'::regtype
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
$$;

revoke all on function public.check_exposed_trigger_functions() from public, anon, authenticated;

comment on function public.check_exposed_trigger_functions() is
  'N7.2 — Doit retourner 0 ligne. Une fonction trigger executable par un role '
  'client est une porte ouverte : Postgres accorde EXECUTE a PUBLIC par defaut, '
  'il faut le revoquer a chaque creation.';
