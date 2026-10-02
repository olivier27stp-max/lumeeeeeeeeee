-- M-03 (agent M, PROPOSÉE — non appliquée hors de la pile locale)
-- Constat B-16 : deux fiches du même client sont fusionnées pendant qu'une relance attend sur
-- la fiche absorbée. La relance était annulée avec « le client a été supprimé », et le client —
-- qui existe toujours — ne recevait pas la suite.
--
-- Cause : `fusionner_clients` repointe toutes les clés étrangères vers la fiche gardée, mais
-- `automation_scheduled_tasks.entity_id` n'est PAS une clé étrangère : la tâche reste sur la
-- fiche absorbée, que le moteur trouve à la corbeille. Et la fusion ne laisse aucune trace sur
-- la fiche absorbée : à l'exécution, le moteur ne peut pas distinguer « fusionnée » de
-- « supprimée ». C'est donc la fusion qui doit s'occuper de ses relances, dans sa transaction.
--
-- Comportement (décision de la mission : « la relance suit la fiche conservée si c'est simple
-- et sûr ; sinon elle s'arrête avec le bon motif ») :
--   · la relance SUIT la fiche gardée quand celle-ci n'est pas déjà dans la même automatisation
--     (aucune tâche en attente ou en cours de cette règle pour elle) ;
--   · sinon elle s'arrête — la fiche gardée a déjà sa propre relance, la doubler écrirait deux
--     fois au même client — avec le motif « fiche fusionnée » (code `fiche_fusionnee`) et une
--     ligne au journal des exécutions.
-- Les tâches portées par un devis, un job, une facture ou un rendez-vous de la fiche absorbée
-- suivent déjà : ces fiches sont repointées par leurs clés étrangères.
--
-- Seul ajout : le bloc « Automatisations en attente », juste avant la mise à la corbeille de la
-- fiche absorbée. Le reste de la fonction est celui de la prod, au mot près.

BEGIN;

CREATE OR REPLACE FUNCTION public.fusionner_clients(p_org uuid, p_garder uuid, p_absorber uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_garder clients%rowtype;
  v_absorber clients%rowtype;
  v_cible record;
  v_n int;
  v_total int := 0;
  v_detail jsonb := '{}'::jsonb;
  v_ignores int := 0;
  v_row record;
  v_relances_suivies int := 0;
  v_relances_arretees int := 0;
begin
  if p_garder = p_absorber then
    raise exception 'fusionner_clients: les deux fiches sont identiques';
  end if;
  if v_uid is not null and not public.member_has_permission(v_uid, p_org, 'clients.delete') then
    raise exception 'fusionner_clients: permission clients.delete requise' using errcode = '42501';
  end if;
  select * into v_garder from clients where id = p_garder and org_id = p_org and deleted_at is null for update;
  if not found then raise exception 'fusionner_clients: fiche à garder introuvable'; end if;
  select * into v_absorber from clients where id = p_absorber and org_id = p_org and deleted_at is null for update;
  if not found then raise exception 'fusionner_clients: fiche à absorber introuvable'; end if;

  -- Drapeau local à la transaction : le trigger d'immuabilité laisse passer client_id (et rien d'autre).
  perform set_config('app.fusion_clients', 'on', true);

  for v_cible in
    select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.clients'::regclass
       and a.attname <> 'org_id'
     group by 1, 2
  loop
    begin
      execute format('update %s set %I = $1 where %I = $2', v_cible.tbl, v_cible.col, v_cible.col) using p_garder, p_absorber;
      get diagnostics v_n = row_count;
    exception when unique_violation then
      v_n := 0;
      for v_row in execute format('select ctid from %s where %I = $1', v_cible.tbl, v_cible.col) using p_absorber loop
        begin
          execute format('update %s set %I = $1 where ctid = $2', v_cible.tbl, v_cible.col) using p_garder, v_row.ctid;
          v_n := v_n + 1;
        exception when unique_violation then
          v_ignores := v_ignores + 1;
        end;
      end loop;
    end;
    if v_n > 0 then
      v_detail := v_detail || jsonb_build_object(v_cible.tbl || '.' || v_cible.col, v_n);
      v_total := v_total + v_n;
    end if;
  end loop;

  -- ── Automatisations en attente sur la fiche absorbée (B-16) ──
  -- 1. La relance suit la fiche gardée, si celle-ci n'est pas déjà dans la même automatisation.
  --    La clé d'unicité porte l'identifiant de la fiche : elle suit aussi, pour qu'un nouveau
  --    déclenchement sur la fiche gardée soit reconnu comme un doublon de cette relance.
  --    Tâche par tâche, chacune dans son bloc : l'index unique `idx_scheduled_tasks_dedup`
  --    (org_id, execution_key) parmi les tâches en attente ou en cours peut refuser la nouvelle
  --    clé dans un cas rare — la fiche gardée porte déjà une tâche à cette clé, d'une autre
  --    règle ou d'un autre type d'entité. Sans ce bloc, la `unique_violation` annulait TOUTE la
  --    fusion : un échec visible de l'utilisateur pour un détail. La tâche en conflit n'est pas
  --    repointée ; elle tombe à l'étape 2 (arrêtée avec « fiche fusionnée »).
  --    (Revue du coordinateur, 2026-10-02 ; même forme que la boucle des clés étrangères.)
  for v_row in
    select t.id
      from automation_scheduled_tasks t
     where t.org_id = p_org
       and t.status = 'pending'
       and t.entity_type in ('client', 'lead')
       and t.entity_id = p_absorber
       and not exists (
         select 1 from automation_scheduled_tasks g
          where g.org_id = p_org
            and g.automation_rule_id = t.automation_rule_id
            and g.entity_type in ('client', 'lead')
            and g.entity_id = p_garder
            and g.status in ('pending', 'running')
       )
     order by t.execute_at, t.id
  loop
    begin
      update automation_scheduled_tasks t
         set entity_id = p_garder,
             execution_key = replace(t.execution_key, p_absorber::text, p_garder::text)
       where t.id = v_row.id;
      v_relances_suivies := v_relances_suivies + 1;
    exception when unique_violation then
      null; -- étape 2
    end;
  end loop;

  -- 2. Sinon elle s'arrête, avec le bon motif, et le journal le dit.
  with arretees as (
    update automation_scheduled_tasks t
       set status = 'cancelled',
           completed_at = now(),
           last_error = 'Fiche fusionnée avec une autre : la relance continue sur la fiche gardée.',
           action_config = coalesce(t.action_config, '{}'::jsonb) || jsonb_build_object('motif_code', 'fiche_fusionnee')
     where t.org_id = p_org
       and t.status = 'pending'
       and t.entity_type in ('client', 'lead')
       and t.entity_id = p_absorber
    returning t.id, t.org_id, t.automation_rule_id, t.entity_type, t.entity_id, t.action_config
  )
  insert into automation_execution_logs
    (org_id, automation_rule_id, scheduled_task_id, trigger_event, entity_type, entity_id,
     action_type, action_config, result_success, result_data, result_error, duration_ms)
  select a.org_id, a.automation_rule_id, a.id, coalesce(a.action_config ->> 'trigger_event', 'scheduled'),
         a.entity_type, a.entity_id, coalesce(a.action_config ->> 'type', '__sequence__'),
         coalesce(a.action_config -> 'config', '{}'::jsonb), true,
         jsonb_build_object(
           'saute', 'Fiche fusionnée avec une autre : la relance continue sur la fiche gardée',
           'saute_code', 'fiche_fusionnee', 'fiche_gardee', p_garder),
         null, 0
    from arretees a;
  get diagnostics v_relances_arretees = row_count;

  update clients set
    email      = coalesce(nullif(email, ''), v_absorber.email),
    phone      = coalesce(nullif(phone, ''), v_absorber.phone),
    company    = coalesce(nullif(company, ''), v_absorber.company),
    address    = coalesce(nullif(address, ''), v_absorber.address),
    city       = coalesce(nullif(city, ''), v_absorber.city),
    notes      = case
                   when coalesce(v_absorber.notes, '') = '' then notes
                   when coalesce(notes, '') = '' then v_absorber.notes
                   else notes || E'\n' || v_absorber.notes
                 end,
    updated_at = now()
  where id = p_garder;

  update clients set deleted_at = now(), updated_at = now() where id = p_absorber;

  return jsonb_build_object(
    'merged', true, 'kept_client_id', p_garder, 'absorbed_client_id', p_absorber,
    'rows_reassigned', v_total, 'rows_skipped_unique', v_ignores, 'detail', v_detail,
    'relances_suivies', v_relances_suivies, 'relances_arretees', v_relances_arretees
  );
end;
$function$;

-- Mêmes droits que la migration d'origine (20260911030000) : redits ici pour que la fonction ne
-- dépende pas de l'ACL en place. Vu sur la pile locale : `anon` y avait EXECUTE (la prod, d'après
-- supabase/baseline, ne l'a pas) — et la fonction saute le contrôle de permission quand
-- `auth.uid()` est nul (chemin service_role). `anon` ne doit jamais pouvoir l'appeler.
REVOKE ALL ON FUNCTION public.fusionner_clients(uuid, uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fusionner_clients(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;
