-- S-03 — test LOCAL de la proposition (constat D-08), dans une transaction ANNULÉE.
--
-- À lancer depuis D:/lume-final/notes/S-migrations-proposees (pile locale seulement) :
--
--   ( echo 'begin;'; sed -e '/^begin;$/d' -e '/^commit;$/d' S-03_PROPOSITION_anonymize_client_journaux.sql; \
--     cat S-03_test_local.sql; echo 'rollback;' ) \
--   | MSYS_NO_PATHCONV=1 docker exec -i -u postgres lumefinal-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1
--
-- La fonction proposée et les données de test vivent le temps de la transaction : après le
-- `rollback`, la base est exactement comme avant (la fonction d'origine comprise).
-- Sortie attendue : « NOTICE:  S-03 : 7 vérifications passées » puis ROLLBACK.

do $$
declare
  v_org uuid;
  v_client uuid;
  v_regle uuid;
  v_tache uuid;
  v_auteur uuid;
  v_tel constant text := '+14385550142';
  v_courriel constant text := 'efface-s03@lume-qa.test';
  v_reste text;
  n integer;
begin
  select o.id into v_org from public.orgs o where o.name like '[TEST] QA Automatisations A (d)%' limit 1;
  if v_org is null then raise exception 'bureau de test A (d) introuvable'; end if;

  select m.user_id into v_auteur from public.memberships m where m.org_id = v_org and m.role = 'owner' limit 1;
  insert into public.clients (org_id, created_by, first_name, last_name, status, phone, email)
  values (v_org, v_auteur, 'Camille', 'Effacee-S03', 'lead', v_tel, v_courriel) returning id into v_client;

  insert into public.automation_rules (org_id, name, trigger_event, conditions, delay_seconds, is_active, is_preset, actions)
  values (v_org, '[QA-S effacement] S-03', 'lead.created', '{}'::jsonb, 0, false, false, '[]'::jsonb) returning id into v_regle;

  insert into public.automation_scheduled_tasks (org_id, automation_rule_id, entity_type, entity_id, action_config, execute_at, status, execution_key, last_error, sequence_context)
  values (v_org, v_regle, 'client', v_client,
          jsonb_build_object('type', 'send_sms', 'config', jsonb_build_object('body', 'Bonjour [client_first_name].'),
                             'event_metadata', jsonb_build_object('email', v_courriel, 'phone', v_tel, 'name', 'Camille Effacee-S03')),
          now() + interval '1 day', 'pending', 's03:' || v_client::text,
          'Twilio 21211 : numéro invalide ' || v_tel || ' — reprise 1/4 dans 5 min',
          jsonb_build_object('franchies', 2, 'passage', 'abc', 'email', v_courriel, 'nom', 'Camille Effacee-S03'))
  returning id into v_tache;

  insert into public.automation_execution_logs (org_id, automation_rule_id, trigger_event, entity_type, entity_id, action_type, action_config, result_success, result_data, result_error, scheduled_task_id)
  values
    (v_org, v_regle, 'lead.created', 'client', v_client, 'send_sms', '{"body":"Bonjour [client_first_name]."}', true,
     jsonb_build_object('to', v_tel, 'body', 'Bonjour Camille Effacee-S03, merci.'), null, null),
    (v_org, v_regle, 'lead.created', 'client', v_client, 'send_email', '{"subject":"Votre demande"}', true,
     jsonb_build_object('to', v_courriel, 'subject', 'Votre demande, Camille', 'body', 'Bonjour Camille Effacee-S03.'), null, null),
    (v_org, v_regle, 'scheduled', 'client', v_client, 'send_sms',
     jsonb_build_object('body', 'Bonjour.', 'event_metadata', jsonb_build_object('email', v_courriel)), false, null,
     'Frequency cap reached for ' || v_tel || ' (max 3 commercial messages / 24h) — skipped to avoid spamming', v_tache),
    (v_org, v_regle, 'lead.created', 'client', v_client, 'send_sms', '{"body":"Bonjour."}', true,
     jsonb_build_object('saute', 'Client désabonné (texto)', 'saute_code', 'desabonne'), null, null);

  insert into public.envois_simules (org_id, canal, destinataire, sujet, corps, meta)
  values (v_org, 'sms', v_tel, null, 'Bonjour Camille Effacee-S03, merci.', '{}'::jsonb),
         (v_org, 'courriel', v_courriel, 'Votre demande, Camille', 'Bonjour Camille Effacee-S03.', '{}'::jsonb),
         -- Un AUTRE destinataire du même bureau : il doit rester.
         (v_org, 'sms', '+14385550199', null, 's03-autre-destinataire', '{}'::jsonb);

  -- L'effacement, tel que le fait POST /api/dsr/erase/client/:id (rôle de service : auth.uid() est nul).
  perform public.anonymize_client(v_client);

  -- 1. La fiche est anonymisée (comportement d'origine, intact).
  perform 1 from public.clients c where c.id = v_client and c.first_name = 'ANONYMIZED' and c.phone is null and c.email is null and c.deleted_at is not null;
  if not found then raise exception 'S-03 (1) : la fiche du client n''est pas anonymisée'; end if;

  -- 2. Plus aucune coordonnée ni le nom dans le journal.
  select string_agg(to_jsonb(l)::text, E'\n') into v_reste from public.automation_execution_logs l where l.automation_rule_id = v_regle;
  if v_reste like '%' || v_tel || '%' or v_reste like '%' || v_courriel || '%' or v_reste like '%Effacee-S03%' then
    raise exception 'S-03 (2) : coordonnées encore dans le journal : %', v_reste;
  end if;

  -- 3. Les lignes sont toujours là, avec ce qui sert aux statistiques (succès, code d'issue).
  select count(*) into n from public.automation_execution_logs l where l.automation_rule_id = v_regle;
  if n <> 4 then raise exception 'S-03 (3) : % ligne(s) de journal au lieu de 4', n; end if;
  perform 1 from public.automation_execution_logs l where l.automation_rule_id = v_regle and l.result_data->>'saute_code' = 'desabonne';
  if not found then raise exception 'S-03 (3) : le code d''issue d''un envoi ignoré a été perdu'; end if;
  perform 1 from public.automation_execution_logs l where l.automation_rule_id = v_regle and l.result_error like 'Frequency cap reached for [téléphone]%';
  if not found then raise exception 'S-03 (3) : le motif d''échec n''est pas masqué comme attendu'; end if;

  -- 4. Plus aucune coordonnée dans la file planifiée ; les repères du moteur restent.
  select to_jsonb(t)::text into v_reste from public.automation_scheduled_tasks t where t.id = v_tache;
  if v_reste like '%' || v_tel || '%' or v_reste like '%' || v_courriel || '%' or v_reste like '%Effacee-S03%' then
    raise exception 'S-03 (4) : coordonnées encore dans la file : %', v_reste;
  end if;
  perform 1 from public.automation_scheduled_tasks t where t.id = v_tache and t.sequence_context = '{"franchies": 2, "passage": "abc"}'::jsonb and t.action_config->>'type' = 'send_sms';
  if not found then raise exception 'S-03 (4) : les repères du moteur ont été perdus : %', v_reste; end if;

  -- 5. Le bac à sable : les envois vers ce client sont partis, ceux des autres restent.
  select count(*) into n from public.envois_simules s where s.org_id = v_org and s.destinataire in (v_tel, v_courriel);
  if n <> 0 then raise exception 'S-03 (5) : % envoi(s) simulé(s) vers le client effacé', n; end if;
  select count(*) into n from public.envois_simules s where s.org_id = v_org and s.corps = 's03-autre-destinataire';
  if n <> 1 then raise exception 'S-03 (5) : l''envoi d''un autre destinataire a été supprimé'; end if;

  -- 6. L'effacement est tracé (comportement d'origine, intact).
  perform 1 from public.audit_events a where a.entity_id = v_client and a.action = 'anonymize';
  if not found then raise exception 'S-03 (6) : l''effacement n''est pas dans audit_events'; end if;

  -- 7. Les journaux d'un AUTRE client du bureau ne sont pas touchés.
  select count(*) into n from public.automation_execution_logs l
   where l.org_id = v_org and l.automation_rule_id <> v_regle and l.result_data ? 'to';
  if n = 0 then raise exception 'S-03 (7) : plus aucun destinataire dans les journaux des autres clients du bureau'; end if;

  raise notice 'S-03 : 7 vérifications passées';
end $$;
