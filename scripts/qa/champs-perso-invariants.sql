-- Champs personnalisés v2 — invariants de la base, prouvés sur staging.
-- Tout se passe dans UNE transaction annulée à la fin : rien ne reste.
-- Usage : node scripts/qa/verifier-champs-perso.mjs (lance ce fichier puis les tests RLS)
-- Chaque test lève une exception « ÉCHEC … » s'il ne tient pas.
begin;

create temp table _t (org uuid, client uuid, client2 uuid, deal uuid, job uuid, autre_org uuid, autre_client uuid) on commit drop;
insert into _t
select d.org_id, d.client_id,
       (select c.id from public.clients c where c.org_id = d.org_id and c.id <> d.client_id
          and not exists (select 1 from public.invoices i where i.client_id = c.id)
          and not exists (select 1 from public.quotes q where q.client_id = c.id) limit 1),
       d.id,
       (select j.id from public.jobs j where j.org_id = d.org_id limit 1),
       o.org_id, o.id
  from public.deals d
  cross join lateral (select c.org_id, c.id from public.clients c where c.org_id <> d.org_id limit 1) o
 where exists (select 1 from public.jobs j where j.org_id = d.org_id)
 limit 1;

do $$
declare
  t record;
  f_txt uuid; f_mail uuid; f_tel uuid; f_nb uuid; f_liste uuid; f_multi uuid; f_date uuid; f_ts uuid; f_job uuid;
  o1 uuid; o2 uuid; o3 uuid; v uuid; d uuid; n integer; r jsonb; ok boolean;
begin
  select * into t from _t;
  if t.org is null then raise exception 'ÉCHEC préparation : aucune org de test'; end if;

  -- ── Définitions ──
  insert into public.custom_fields (org_id, object_type, key, label, field_type)
  values (t.org, 'client', '', 'Superficie du terrain', 'single_line') returning id into f_txt;
  if (select key from public.custom_fields where id = f_txt) <> 'superficie_du_terrain' then
    raise exception 'ÉCHEC clé : slug inattendu %', (select key from public.custom_fields where id = f_txt);
  end if;
  -- Clé réservée (champ standard) → suffixée
  insert into public.custom_fields (org_id, object_type, key, label, field_type)
  values (t.org, 'client', '', 'Email', 'email') returning id into f_mail;
  if (select key from public.custom_fields where id = f_mail) <> 'email_2' then
    raise exception 'ÉCHEC clé réservée : %', (select key from public.custom_fields where id = f_mail);
  end if;
  -- Clé explicite en collision → refus, jamais renommée en silence
  begin
    insert into public.custom_fields (org_id, object_type, key, label, field_type)
    values (t.org, 'client', 'superficie_du_terrain', 'Autre', 'single_line');
    raise exception 'ÉCHEC collision de clé acceptée';
  exception when unique_violation then null; end;
  -- Clé immuable
  begin
    update public.custom_fields set key = 'autre' where id = f_txt;
    raise exception 'ÉCHEC clé modifiable';
  exception when invalid_parameter_value then null; end;

  insert into public.custom_fields (org_id, object_type, label, field_type, key) values (t.org, 'client', 'Cellulaire', 'phone', '') returning id into f_tel;
  insert into public.custom_fields (org_id, object_type, label, field_type, key, config) values (t.org, 'client', 'Fenêtres', 'number', '', '{"decimals":0,"min":0,"max":500}') returning id into f_nb;
  insert into public.custom_fields (org_id, object_type, label, field_type, key) values (t.org, 'client', 'Type de surface', 'dropdown_single', '') returning id into f_liste;
  insert into public.custom_field_options (org_id, field_id, label, color) values (t.org, f_liste, 'Asphalte', '#334455') returning id into o1;
  insert into public.custom_field_options (org_id, field_id, label) values (t.org, f_liste, 'Pavé') returning id into o2;
  insert into public.custom_fields (org_id, object_type, label, field_type, key) values (t.org, 'client', 'Services', 'dropdown_multi', '') returning id into f_multi;
  insert into public.custom_fields (org_id, object_type, label, field_type, key) values (t.org, 'client', 'Visite', 'date', '') returning id into f_date;
  insert into public.custom_fields (org_id, object_type, label, field_type, key, config) values (t.org, 'client', 'Rappel', 'date', '', '{"include_time":true}') returning id into f_ts;

  -- ── CHECK : une valeur liée à zéro ou deux objets → rejetée ──
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, value_text) values (t.org, f_txt, 'client', 'x');
    raise exception 'ÉCHEC valeur sans entité acceptée';
  exception when check_violation then null; end;
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, deal_id, value_text)
    values (t.org, f_txt, 'client', t.client, t.deal, 'x');
    raise exception 'ÉCHEC valeur à deux entités acceptée';
  exception when check_violation then null; end;
  -- Mauvais object_type : champ client posé sur un deal → rejeté
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, deal_id, value_text) values (t.org, f_txt, 'deal', t.deal, 'x');
    raise exception 'ÉCHEC valeur sur le mauvais objet acceptée';
  exception when check_violation then null; end;
  -- Inter-entreprise : champ de l'org A sur un client de l'org B → rejeté par FK
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.org, f_txt, 'client', t.autre_client, 'x');
    raise exception 'ÉCHEC client d''une autre org accepté';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.autre_org, f_txt, 'client', t.autre_client, 'x');
    raise exception 'ÉCHEC champ d''une autre org accepté';
  exception when foreign_key_violation then null; end;
  -- Mauvaise colonne typée → rejetée
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_number) values (t.org, f_txt, 'client', t.client, 3);
    raise exception 'ÉCHEC nombre dans un champ texte accepté';
  exception when invalid_parameter_value then null; end;
  -- Une ligne ne contient pas de saut de ligne
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.org, f_txt, 'client', t.client, E'a\nb');
    raise exception 'ÉCHEC saut de ligne dans une ligne accepté';
  exception when invalid_parameter_value then null; end;

  -- ── Normalisation ──
  insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.org, f_tel, 'client', t.client, '(819) 555-1234');
  if (select value_text from public.custom_field_values where field_id = f_tel and client_id = t.client) <> '+18195551234' then
    raise exception 'ÉCHEC téléphone non normalisé en E.164';
  end if;
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.org, f_mail, 'client', t.client, 'pas-un-courriel');
    raise exception 'ÉCHEC courriel invalide accepté';
  exception when invalid_parameter_value then null; end;
  insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.org, f_mail, 'client', t.client, ' Jean@Exemple.CA ');
  -- Nombre : décimales et bornes
  insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_number) values (t.org, f_nb, 'client', t.client, 12.6);
  if (select value_number from public.custom_field_values where field_id = f_nb and client_id = t.client) <> 13 then
    raise exception 'ÉCHEC arrondi aux décimales du champ';
  end if;
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_number) values (t.org, f_nb, 'client', t.client2, 900);
    raise exception 'ÉCHEC borne max ignorée';
  exception when invalid_parameter_value then null; end;
  -- Date seule vs date+heure
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_timestamp) values (t.org, f_date, 'client', t.client, now());
    raise exception 'ÉCHEC heure dans une date seule acceptée';
  exception when invalid_parameter_value then null; end;

  -- ── Unicité ──
  insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.org, f_mail, 'client', t.client2, 'jean@exemple.ca');
  r := public.cf_activer_unique(f_mail, true);
  if (r->>'ok')::boolean then raise exception 'ÉCHEC unicité activée malgré un doublon'; end if;
  if jsonb_array_length(r->'doublons') <> 1 then raise exception 'ÉCHEC doublons non renvoyés'; end if;
  delete from public.custom_field_values where field_id = f_mail and client_id = t.client2;
  r := public.cf_activer_unique(f_mail, true);
  if not (r->>'ok')::boolean then raise exception 'ÉCHEC unicité refusée sans doublon'; end if;
  begin
    -- même adresse, casse différente → doublon après normalisation
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.org, f_mail, 'client', t.client2, 'JEAN@exemple.ca');
    raise exception 'ÉCHEC doublon normalisé accepté';
  exception when unique_violation then null; end;
  -- Unicité interdite sur une liste
  begin
    update public.custom_fields set is_unique = true where id = f_liste;
    raise exception 'ÉCHEC unicité sur une liste acceptée';
  exception when check_violation then null; end;

  -- ── Options ──
  -- Une option d'un AUTRE champ → rejetée
  insert into public.custom_field_options (org_id, field_id, label) values (t.org, f_multi, 'Vitres') returning id into o3;
  begin
    insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_option_id) values (t.org, f_liste, 'client', t.client, o3);
    raise exception 'ÉCHEC option d''un autre champ acceptée';
  exception when foreign_key_violation then null; end;
  insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_option_id) values (t.org, f_liste, 'client', t.client, o1);
  -- Supprimer une option utilisée → archivée, pas supprimée
  delete from public.custom_field_options where id = o1;
  if not exists (select 1 from public.custom_field_options where id = o1 and archived_at is not null) then
    raise exception 'ÉCHEC option utilisée supprimée au lieu d''archivée';
  end if;
  -- Option inutilisée → vraiment supprimée
  delete from public.custom_field_options where id = o2;
  if exists (select 1 from public.custom_field_options where id = o2) then raise exception 'ÉCHEC option libre non supprimée'; end if;

  -- ── Conversions de type ──
  update public.custom_fields set field_type = 'multi_line' where id = f_txt;              -- permise
  update public.custom_fields set field_type = 'single_line' where id = f_txt;             -- permise
  update public.custom_fields set field_type = 'monetary' where id = f_nb;                 -- permise, 13 → 1300 ¢
  if (select value_money_cents from public.custom_field_values where field_id = f_nb and client_id = t.client) <> 1300 then
    raise exception 'ÉCHEC conversion nombre → montant';
  end if;
  update public.custom_fields set field_type = 'dropdown_multi' where id = f_liste;        -- permise
  if not exists (select 1 from public.custom_field_value_options where field_id = f_liste and option_id = o1) then
    raise exception 'ÉCHEC conversion liste simple → multiple : option perdue';
  end if;
  begin
    update public.custom_fields set field_type = 'number' where id = f_txt;
    raise exception 'ÉCHEC conversion texte → nombre acceptée';
  exception when invalid_parameter_value then null; end;
  begin
    update public.custom_fields set field_type = 'single_line' where id = f_tel;
    raise exception 'ÉCHEC conversion téléphone → texte acceptée';
  exception when invalid_parameter_value then null; end;

  -- ── Suppression d'une définition qui a des valeurs → bloquée ──
  begin
    delete from public.custom_fields where id = f_tel;
    raise exception 'ÉCHEC hard delete d''un champ avec valeurs accepté';
  exception when foreign_key_violation then null; end;

  -- ── Dossier : supprimé → champs « Sans dossier » ──
  insert into public.custom_field_folders (org_id, object_type, name) values (t.org, 'client', 'Terrain') returning id into d;
  update public.custom_fields set folder_id = d where id = f_txt;
  delete from public.custom_field_folders where id = d;
  if (select folder_id from public.custom_fields where id = f_txt) is not null
     or (select org_id from public.custom_fields where id = f_txt) is distinct from t.org then
    raise exception 'ÉCHEC suppression de dossier : champ non remis à « Sans dossier » (ou org_id touché)';
  end if;
  -- Dossier d'un autre objet → refusé
  insert into public.custom_field_folders (org_id, object_type, name) values (t.org, 'job', 'Chantier') returning id into d;
  begin
    update public.custom_fields set folder_id = d where id = f_txt;
    raise exception 'ÉCHEC dossier d''un autre objet accepté';
  exception when foreign_key_violation then null; end;

  -- ── Dossier en lot : un champ invalide → rien n'est créé ──
  select count(*) into n from public.custom_field_folders where org_id = t.org;
  begin
    perform public.cf_creer_dossier(t.org, 'client', 'Lot raté', '[{"label":"Bon","field_type":"single_line"},{"label":"Mauvais","field_type":"inexistant"}]');
    raise exception 'ÉCHEC lot invalide accepté';
  exception when invalid_text_representation then null; end;
  if (select count(*) from public.custom_field_folders where org_id = t.org) <> n
     or exists (select 1 from public.custom_fields where org_id = t.org and label = 'Bon') then
    raise exception 'ÉCHEC lot partiellement créé';
  end if;
  d := public.cf_creer_dossier(t.org, 'client', 'Lot réussi',
    '[{"label":"Couleur","field_type":"dropdown_single","options":[{"label":"Rouge","color":"#ff0000"},{"label":"Bleu"}]},{"label":"Remarque","field_type":"multi_line"}]');
  if (select count(*) from public.custom_fields where folder_id = d) <> 2
     or (select count(*) from public.custom_field_options o join public.custom_fields f on f.id = o.field_id where f.folder_id = d) <> 2 then
    raise exception 'ÉCHEC lot incomplet';
  end if;

  -- ── Filtres ──
  -- Garde du filtre sans RLS : sans identité, refusé.
  begin
    perform public.cf_filtrer_brut(t.org, 'client', '[]'::jsonb);
    raise exception 'ÉCHEC cf_filtrer_brut accepté sans identité';
  exception when insufficient_privilege then null; end;
  -- Membre d'une AUTRE org : refusé aussi.
  perform set_config('request.jwt.claims', json_build_object('sub',
    (select m.user_id from public.memberships m where m.org_id <> t.org
        and not exists (select 1 from public.memberships x where x.user_id = m.user_id and x.org_id = t.org) limit 1),
    'role', 'authenticated')::text, true);
  begin
    perform public.cf_filtrer_brut(t.org, 'client', '[]'::jsonb);
    raise exception 'ÉCHEC cf_filtrer_brut accepté pour un membre d''une autre org';
  exception when insufficient_privilege then null; end;
  -- La suite comme le serveur (service_role).
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_date)
  values (t.org, f_date, 'client', t.client, ((now() at time zone public.cf_fuseau(t.org))::date - 3));
  select count(*) into n from public.cf_filtrer(t.org, 'client', jsonb_build_array(jsonb_build_object('field_id', f_date, 'op', 'in_last', 'n', 7, 'unit', 'days'))) x where x = t.client;
  if n <> 1 then raise exception 'ÉCHEC filtre in_last 7 jours'; end if;
  select count(*) into n from public.cf_filtrer(t.org, 'client', jsonb_build_array(jsonb_build_object('field_id', f_date, 'op', 'more_than_ago', 'n', 7, 'unit', 'days'))) x where x = t.client;
  if n <> 0 then raise exception 'ÉCHEC filtre more_than_ago 7 jours'; end if;
  select count(*) into n from public.cf_filtrer(t.org, 'client', jsonb_build_array(jsonb_build_object('field_id', f_date, 'op', 'is_empty'))) x where x = t.client2;
  if n <> 1 then raise exception 'ÉCHEC filtre « est vide » (absence de valeur)'; end if;
  select count(*) into n from public.cf_filtrer(t.org, 'client', jsonb_build_array(jsonb_build_object('field_id', f_txt, 'op', 'contains', 'value', '%'))) x;
  if n <> 0 then raise exception 'ÉCHEC « contient %% » : le joker n''est pas échappé'; end if;
  begin
    perform public.cf_filtrer(t.org, 'client', jsonb_build_array(jsonb_build_object('field_id', f_date, 'op', 'eq', 'value', '1')));
    raise exception 'ÉCHEC opérateur invalide accepté';
  exception when invalid_parameter_value then null; end;
  -- Injection par la valeur : neutralisée par %L
  select count(*) into n from public.cf_filtrer(t.org, 'client', jsonb_build_array(jsonb_build_object('field_id', f_txt, 'op', 'is', 'value', $x$'; drop table public.clients; --$x$))) x;

  -- ── Deal gagné → job : les valeurs suivent (même clé, même type) ──
  insert into public.custom_fields (org_id, object_type, label, field_type, key) values (t.org, 'deal', 'Superficie', 'number', '') returning id into f_ts;
  insert into public.custom_fields (org_id, object_type, label, field_type, key) values (t.org, 'job', 'Superficie', 'number', '') returning id into f_job;
  insert into public.custom_field_values (org_id, field_id, object_type, deal_id, value_number) values (t.org, f_ts, 'deal', t.deal, 250);
  n := public.cf_copier_valeurs_deal_vers_job(t.deal, t.job);
  if (select value_number from public.custom_field_values where field_id = f_job and job_id = t.job) is distinct from 250 then
    raise exception 'ÉCHEC copie deal → job';
  end if;
  -- idempotente : une 2e copie ne duplique ni n'écrase
  n := public.cf_copier_valeurs_deal_vers_job(t.deal, t.job);
  if n <> 0 then raise exception 'ÉCHEC copie deal → job non idempotente'; end if;

  -- ── Version : chaque mise à jour l'incrémente (rejeu hors ligne détectable) ──
  select id into v from public.custom_field_values where field_id = f_tel and client_id = t.client;
  update public.custom_field_values set value_text = '8195551234' where id = v;
  if (select version from public.custom_field_values where id = v) <> 2 then raise exception 'ÉCHEC version non incrémentée'; end if;

  -- ── Écriture idempotente (rejeu hors ligne) et verrou optimiste ──
  r := public.cf_ecrire_valeur(f_txt, t.client, '{"value_text":"Rejeu"}'::jsonb, null, null);
  if not (r->>'changed')::boolean then raise exception 'ÉCHEC première écriture'; end if;
  n := (r->>'version')::integer;
  r := public.cf_ecrire_valeur(f_txt, t.client, '{"value_text":"Rejeu"}'::jsonb, null, n);
  if (r->>'changed')::boolean or (r->>'version')::integer <> n then raise exception 'ÉCHEC rejeu : la même écriture a changé la ligne'; end if;
  -- rejeu avec une version PÉRIMÉE mais la même valeur → toujours pas de conflit
  r := public.cf_ecrire_valeur(f_txt, t.client, '{"value_text":"Rejeu"}'::jsonb, null, n - 1);
  if (r->>'conflict')::boolean then raise exception 'ÉCHEC rejeu identique vu comme un conflit'; end if;
  -- valeur DIFFÉRENTE avec une version périmée → conflit, rien d'écrit
  r := public.cf_ecrire_valeur(f_txt, t.client, '{"value_text":"Autre"}'::jsonb, null, n - 1);
  if not (r->>'conflict')::boolean then raise exception 'ÉCHEC conflit de version non détecté'; end if;
  if (select value_text from public.custom_field_values where field_id = f_txt and client_id = t.client) <> 'Rejeu' then
    raise exception 'ÉCHEC écriture malgré le conflit';
  end if;
  -- liste multiple par la RPC
  insert into public.custom_field_options (org_id, field_id, label) values (t.org, f_multi, 'Gouttières') returning id into o2;
  r := public.cf_ecrire_valeur(f_multi, t.client, '{}'::jsonb, array[o3, o2], null);
  r := public.cf_ecrire_valeur(f_multi, t.client, '{}'::jsonb, array[o2, o3], null);
  if (r->>'changed')::boolean then raise exception 'ÉCHEC liste multiple : même ensemble dans un autre ordre vu comme un changement'; end if;
  -- vider
  r := public.cf_ecrire_valeur(f_txt, t.client, null, null, null);
  if exists (select 1 from public.custom_field_values where field_id = f_txt and client_id = t.client) then
    raise exception 'ÉCHEC vider une valeur';
  end if;

  -- ── Options : réordonner/renommer sans heurt, retirée utilisée → archivée ──
  perform public.cf_maj_options(f_multi, jsonb_build_array(
    jsonb_build_object('id', o2, 'label', 'Vitres'), jsonb_build_object('id', o3, 'label', 'Gouttières')));
  if (select label from public.custom_field_options where id = o2) <> 'Vitres' then raise exception 'ÉCHEC échange de libellés'; end if;
  perform public.cf_maj_options(f_multi, jsonb_build_array(jsonb_build_object('id', o2, 'label', 'Vitres')));
  if not exists (select 1 from public.custom_field_options where id = o3 and archived_at is not null and label = 'Gouttières') then
    raise exception 'ÉCHEC option retirée mais utilisée : pas archivée (ou libellé abîmé)';
  end if;

  -- ── Loi 25 : export puis effacement ──
  if jsonb_array_length(public.export_client_data(t.client)->'custom_fields') = 0 then
    raise exception 'ÉCHEC export Loi 25 sans champs personnalisés';
  end if;
  perform public.anonymize_client(t.client);
  if exists (select 1 from public.custom_field_values where client_id = t.client) then
    raise exception 'ÉCHEC anonymisation : valeurs du client restantes';
  end if;
  if exists (select 1 from public.custom_field_values where deal_id = t.deal) then
    raise exception 'ÉCHEC anonymisation : valeurs du deal restantes';
  end if;

  -- ── Cascade : supprimer l'entité supprime ses valeurs ──
  insert into public.custom_field_values (org_id, field_id, object_type, client_id, value_text) values (t.org, f_txt, 'client', t.client2, 'cascade');
  delete from public.deals where client_id = t.client2;
  delete from public.clients where id = t.client2;
  if exists (select 1 from public.custom_field_values where client_id = t.client2) then
    raise exception 'ÉCHEC cascade client → valeurs';
  end if;

  -- ── Purge : nombre confirmé exigé ──
  begin
    perform public.cf_purger_champ(f_job, 99);
    raise exception 'ÉCHEC purge sans le bon décompte';
  exception when others then
    if sqlerrm like 'ÉCHEC%' then raise; end if;
  end;

  raise notice 'OK — tous les invariants tiennent';
end $$;

rollback;
