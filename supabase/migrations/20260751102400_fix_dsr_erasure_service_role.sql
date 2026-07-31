-- ============================================================================
-- Loi 25 — le droit a l'effacement etait CASSE en production
-- ============================================================================
--
-- Symptome : POST /api/dsr/erase/client/:id et /erase/lead/:id echouaient pour
-- TOUT LE MONDE. Le droit a l'effacement, obligatoire sous la Loi 25, etait
-- donc inoperant depuis la mise en place de la fonction.
--
-- Cause racine : anonymize_client() gardait avec
--     if not public.has_org_admin_role(auth.uid(), v_org) then raise ...
-- Or les deux seules routes appelantes l'invoquent en service_role, ou
-- auth.uid() vaut NULL. Verifie en production :
--     select public.has_org_admin_role(null::uuid, <org>);  ->  false
-- La garde refusait donc systematiquement, y compris le serveur legitime.
--
-- C'est EXACTEMENT le meme defaut que 20260751101900 avait corrige pour
-- export_client_data. Le motif « garde interne sur auth.uid() + appel en
-- service_role » a maintenant casse trois fonctions distinctes.
--
-- Correctif : adopter le motif deja retenu par delete_client_cascade —
-- n'exiger le role admin QUE d'un appelant authentifie.
--
-- Pourquoi c'est sur (connexions verifiees une par une) :
--   * appelants SQL : AUCUN (0 fonction ne l'appelle) ;
--   * appelants applicatifs : server/routes/dsr.ts:135 et :173 UNIQUEMENT,
--     tous deux en service_role, et tous deux validant desormais
--     l'appartenance a l'org AVANT l'appel (correctif du 2026-07-31) ;
--   * `authenticated` conserve EXECUTE : un appel direct depuis le navigateur
--     a bien auth.uid() renseigne, la garde admin s'applique donc pleinement.
--
-- Verifie par execution (transactions annulees) :
--   * service_role (chemin serveur)          -> REUSSIT
--   * authentifie inconnu de l'org           -> refuse (RLS : « Client not found »)
--   * membre sales_rep de l'org du client    -> refuse
--                                    « Only org admin/owner can anonymize clients »
--
-- APPLIQUE EN PRODUCTION le 2026-07-31 a 03:12 UTC. Corps ci-dessous lu
-- directement depuis pg_proc.prosrc — aucune transcription manuelle.
-- ROLLBACK : retirer « auth.uid() is not null and » de la condition.
-- ============================================================================

create or replace function public.anonymize_client(p_client_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $LUMED$
declare
  v_org uuid;
  v_contact_id uuid;
  v_cols text;
  v_sql text;
begin
  select org_id, contact_id into v_org, v_contact_id
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

  insert into public.audit_events(org_id, actor_id, action, entity_type, entity_id, metadata)
  values (v_org, auth.uid(), 'anonymize', 'client', p_client_id, jsonb_build_object('method','dsr_erasure'));
end $LUMED$;
