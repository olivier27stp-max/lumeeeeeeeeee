-- S-03 (agent S) — PROPOSITION, À RELIRE. NON APPLIQUÉE : ni en local, ni ailleurs.
-- Constat D-08 (Loi 25, droit à l'effacement) : après « Effacer ce client »
-- (POST /api/dsr/erase/client/:id → anonymize_client), la fiche est anonymisée mais les journaux
-- des automatisations gardent, jusqu'à 90 jours, son numéro, son adresse et le texte reçu avec son
-- nom (`result_data.to / subject / body`) ; la file planifiée garde les métadonnées de l'événement ;
-- le bac à sable des envois, sans limite, le destinataire et le corps.
--
-- Ce fichier REDÉFINIT `public.anonymize_client` : le corps actuel (relevé en base locale = prod,
-- 2026-10-01) est repris À L'IDENTIQUE, et un seul bloc est ajouté, entre les champs
-- personnalisés et l'écriture dans `audit_events`. Ce bloc :
--   1. retire des journaux d'exécution des fiches du client (lui-même, ses devis, factures, jobs,
--      opportunités, rendez-vous) ce qui l'identifie : destinataire, objet, corps, et masque les
--      courriels et numéros cités dans le motif d'échec (même masque que `relances_du_deal`) ;
--   2. fait de même dans la file planifiée (métadonnées de l'événement, motif) ;
--   3. supprime du bac à sable les envois simulés vers son numéro ou son adresse.
-- Les LIGNES restent (les statistiques ne bougent pas) : seul leur contenu personnel part.
--
-- Pourquoi une proposition seulement : c'est une fonction de CONFORMITÉ (SECURITY DEFINER), à
-- faire relire avant de la passer staging puis prod. Hors de ce domaine, et NON VÉRIFIÉ : les
-- tables `messages`, `email_deliveries` et `activity_log` (`metadata.to`) portent les mêmes
-- coordonnées — à traiter dans le même geste.
--
-- Test local : S-03_test_local.sql (dans une transaction ANNULÉE : rien ne reste).
--
-- RETOUR ARRIÈRE : réappliquer la définition d'origine (sans le bloc « Journaux des
-- automatisations »).

begin;

create or replace function public.anonymize_client(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_org uuid;
  v_contact_id uuid;
  v_cols text;
  v_sql text;
  -- AJOUT (D-08) : les coordonnées du client, lues AVANT qu'elles soient effacées.
  v_email text;
  v_phone text;
  v_fiches uuid[];
begin
  select org_id, contact_id, email, phone into v_org, v_contact_id, v_email, v_phone
    from public.clients where id = p_client_id;
  if v_org is null then raise exception 'Client not found'; end if;
  -- N3.5 (audit 2026-07-31) : auth.uid() est NULL en service_role, donc
  -- has_org_admin_role(NULL, ...) renvoyait false et l'effacement echouait pour
  -- TOUT LE MONDE. On n'exige le role admin que d'un appelant authentifie ;
  -- le chemin serveur est borne par la verification d'org faite dans la route.
  if auth.uid() is not null and not public.has_org_admin_role(auth.uid(), v_org) then
    raise exception 'Only org admin/owner can anonymize clients';
  end if;

  -- Build SET clause dynamically from columns that actually exist
  select string_agg(
    case column_name
      when 'first_name' then 'first_name=''ANONYMIZED'''
      when 'last_name'  then 'last_name='''''
      else column_name || '=null'
    end, ', ')
    into v_cols
    from information_schema.columns
   where table_schema='public' and table_name='clients'
     and column_name in ('first_name','last_name','company','email','phone',
                         'address','address_line1','address_line2','street_number','street_name',
                         'city','province','postal_code','country',
                         'latitude','longitude','place_id','notes',
                         'sms_consent_at','email_consent_at');

  v_sql := format(
    'update public.clients set %s, deleted_at=coalesce(deleted_at, now()), updated_at=now() where id = %L',
    v_cols, p_client_id);
  execute v_sql;

  if v_contact_id is not null then
    update public.contacts
       set full_name='ANONYMIZED', email=null, phone=null,
           address_line1=null, address_line2=null,
           city=null, province=null, postal_code=null, country=null
     where id = v_contact_id;
  end if;

  -- champs personnalisés (2026-09-26) : valeurs du client, de ses deals et (2026-09-29) de ses propriétés.
  delete from public.custom_field_values
   where client_id = p_client_id
      or deal_id in (select d.id from public.deals d where d.client_id = p_client_id)
      or property_id in (select p.id from public.properties p where p.client_id = p_client_id);

  -- ── AJOUT (D-08) : journaux des automatisations ─────────────────────────────
  -- Les fiches du client : lui-même, et tout ce qui lui est rattaché.
  v_fiches := array(
    select p_client_id
    union select q.id from public.quotes q where q.org_id = v_org and q.client_id = p_client_id
    union select i.id from public.invoices i where i.org_id = v_org and i.client_id = p_client_id
    union select j.id from public.jobs j where j.org_id = v_org and j.client_id = p_client_id
    union select d.id from public.deals d where d.org_id = v_org and d.client_id = p_client_id
    union select e.id from public.schedule_events e
            join public.jobs j on j.id = e.job_id and j.org_id = e.org_id
           where e.org_id = v_org and j.client_id = p_client_id
  );

  -- 1. Le journal : ce qui est parti (destinataire, objet, corps), les métadonnées de
  --    l'événement, et les coordonnées citées dans un motif d'échec.
  update public.automation_execution_logs l
     set result_data = case when l.result_data is null then null
                            else l.result_data - 'to' - 'subject' - 'body' - 'message' - 'html' end,
         action_config = l.action_config - 'event_metadata',
         result_error = regexp_replace(
           regexp_replace(l.result_error, '[^[:space:]<>"'']+@[^[:space:]<>"'']+', '[courriel]', 'g'),
           '\+?1?[ (.-]*[0-9]{3}[ ).-]*[0-9]{3}[ .-]*[0-9]{4}', '[téléphone]', 'g')
   where l.org_id = v_org
     and l.entity_id = any (v_fiches);

  -- 2. La file planifiée : mêmes métadonnées, même masque. Du contexte d'un parcours, seuls les
  --    repères du moteur restent (étapes franchies, passage, chaîne).
  update public.automation_scheduled_tasks t
     set action_config = t.action_config - 'event_metadata',
         sequence_context = (
           select jsonb_object_agg(c.key, c.value)
             from jsonb_each(t.sequence_context) c
            where c.key in ('franchies', 'passage', 'chaine')
         ),
         last_error = regexp_replace(
           regexp_replace(t.last_error, '[^[:space:]<>"'']+@[^[:space:]<>"'']+', '[courriel]', 'g'),
           '\+?1?[ (.-]*[0-9]{3}[ ).-]*[0-9]{3}[ .-]*[0-9]{4}', '[téléphone]', 'g')
   where t.org_id = v_org
     and t.entity_id = any (v_fiches);

  -- 3. Le bac à sable des envois (bureaux de test) : les envois simulés vers ce client.
  delete from public.envois_simules s
   where s.org_id = v_org
     and s.destinataire in (v_email, v_phone);
  -- ── fin de l'ajout ──────────────────────────────────────────────────────────

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'anonymize', 'client', p_client_id, jsonb_build_object('method','dsr_erasure'));
end $function$;

commit;
