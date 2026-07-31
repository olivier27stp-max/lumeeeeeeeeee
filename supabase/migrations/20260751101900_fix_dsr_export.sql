-- ============================================================================
-- Loi 25 / RGPD — l'export DSR (portabilité) était cassé en production
-- ============================================================================
-- CONSTAT VÉRIFIÉ EN PROD
--   select public.export_client_data('<un client réel>');
--   -> ERROR: Not authorized
--
-- CAUSE
-- export_client_data() et export_user_data() valident l'appelant avec
-- `auth.uid()`. Or les routes /api/dsr/export/* les invoquent via
-- getServiceClient() — service_role, où auth.uid() vaut NULL.
--   has_org_membership(NULL, org) => false  (vérifié)
-- La garde refusait donc TOUT LE MONDE, y compris les appels légitimes.
--
-- Ce n'était pas une faille d'accès : c'était l'inverse, un droit légal
-- inopérant. Le droit à la portabilité (Loi 25 art. 27, RGPD art. 20) doit
-- répondre sous 30 jours ; il ne répondait jamais.
--
-- CORRECTIF
-- Deux chemins d'appel légitimes, deux traitements :
--   1. Appel UTILISATEUR (auth.uid() non NULL) : la garde d'appartenance
--      s'applique, inchangée.
--   2. Appel SERVEUR (auth.uid() NULL, donc service_role) : l'autorisation a
--      déjà été faite en amont dans server/routes/dsr.ts, qui compare
--      client.org_id à l'orgId issu de requireAuthedClient() — jamais de la
--      requête HTTP (N3.5). On laisse passer.
--
-- C'est le même motif que les autres fonctions du projet
-- (`if auth.uid() is not null and not has_org_membership(...)`), déjà employé
-- par invoice_next_number() et set_invoice_next_number().
--
-- La journalisation dans audit_events est CONSERVÉE, et complétée côté
-- applicatif par data_export_log (N7.7).
-- ============================================================================

create or replace function public.export_client_data(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_result jsonb;
begin
  select org_id into v_org from public.clients where id = p_client_id;
  if v_org is null then
    raise exception 'Client not found';
  end if;

  -- Appel utilisateur : garde d'appartenance. Appel serveur (auth.uid() NULL) :
  -- l'autorisation est faite en amont dans server/routes/dsr.ts.
  if auth.uid() is not null and not public.has_org_membership(auth.uid(), v_org) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'client_id',   p_client_id,
    'client',      (select to_jsonb(c) from public.clients c where c.id = p_client_id),
    'contact',     (select to_jsonb(co) from public.contacts co where co.id = (select contact_id from public.clients where id = p_client_id)),
    'jobs',        (select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from public.jobs j where j.client_id = p_client_id),
    'invoices',    (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from public.invoices i where i.client_id = p_client_id),
    'payments',    (select coalesce(jsonb_agg(to_jsonb(pm)), '[]'::jsonb) from public.payments pm where pm.client_id = p_client_id),
    'consents',    (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.consents c where c.subject_type='client' and c.subject_id = p_client_id)
  ) into v_result;

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'dsr_export', 'client', p_client_id, '{}'::jsonb);

  return v_result;
end $$;

comment on function public.export_client_data(uuid) is
  'Loi 25 art. 27 / RGPD art. 20 — export de portabilite d''un client. '
  'Garde d''appartenance sur appel utilisateur ; sur appel serveur '
  '(auth.uid() NULL) l''autorisation est faite dans server/routes/dsr.ts.';

-- ----------------------------------------------------------------------------
-- Meme correction pour export_user_data().
-- ----------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  select prosrc into v_src
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'export_user_data';

  if v_src is null then
    raise notice 'export_user_data introuvable.';
    return;
  end if;

  if v_src ilike '%v_caller is not null and v_caller != p_user_id%' then
    raise notice 'export_user_data deja corrigee.';
    return;
  end if;

  -- La condition `if v_caller != p_user_id` est vraie quand v_caller est NULL ?
  -- Non : NULL != x vaut NULL, donc le bloc est saute et l'export passe. Le
  -- blocage venait de `if v_caller is null then raise`. On neutralise ce seul
  -- point pour l'appel serveur, en conservant la regle pour l'appel utilisateur.
  execute replace(
    'create or replace function public.export_user_data(p_user_id uuid) '
    'returns jsonb language plpgsql security definer '
    'set search_path = public, pg_temp as $BODY$' || v_src || '$BODY$',
    'if v_caller is null then
    raise exception ''Authentication required'';
  end if;',
    '-- Appel serveur (service_role) : auth.uid() est NULL et l''autorisation
  -- est faite en amont dans server/routes/dsr.ts. Appel utilisateur : la
  -- verification v_caller != p_user_id ci-dessous s''applique normalement.
  if false then
    raise exception ''Authentication required'';
  end if;'
  );

  raise notice 'export_user_data corrigee pour l''appel serveur.';
end $$;

-- ----------------------------------------------------------------------------
-- Verification : l'export doit desormais repondre.
-- ----------------------------------------------------------------------------
do $$
declare
  v_client uuid;
  v_res jsonb;
begin
  select id into v_client from public.clients where deleted_at is null limit 1;
  if v_client is null then
    raise notice 'Aucun client pour tester.';
    return;
  end if;

  v_res := public.export_client_data(v_client);

  if v_res is null or v_res->>'client_id' is null then
    raise exception 'export_client_data ne retourne rien.';
  end if;

  raise notice 'Export DSR fonctionnel (% octets).', length(v_res::text);
end $$;
