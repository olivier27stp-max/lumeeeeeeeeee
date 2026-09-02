-- ============================================================================
-- Retrait des 6 organisations « zz-archive-test-migration »
-- ============================================================================
-- CONSTAT (2026-09-01, audit du robot de recette)
-- La production porte 7 organisations : « Coquin lavage » (56 clients, 40 jobs,
-- 8 membres) et SIX homonymes nommées « zz-archive-test-migration », créées les
-- 26 et 31 août 2026. Ce nom n'apparaît nulle part dans le dépôt : elles ont
-- été créées à la main ou par un script depuis supprimé.
--
-- CE QU'ELLES CONTIENNENT — 320 lignes, aucune donnée métier réelle
--   automation_rules       210   presets créés d'office à chaque organisation
--   audit_events            42
--   alert_rules             24   posées par 20260901180000
--   quotes                  10
--   notifications           10
--   security_events          6
--   org_job_counters         6
--   org_client_counters      6
--   communication_settings   6
--
-- Aucun client, aucun job, aucune facture, et surtout AUCUN compte utilisateur
-- rattaché : supprimer ne prive personne d'accès.
--
-- LE PIÈGE : `audit_events` est APPEND-ONLY
-- Un déclencheur `audit_events_no_delete` refuse toute suppression. La cascade
-- depuis `orgs` tenterait pourtant d'effacer ses 42 lignes, et la transaction
-- entière échouerait. Le mécanisme prévoit son échappatoire :
--     set local app.audit_maintenance = 'on'
-- `SET LOCAL` est OBLIGATOIRE — le corps du déclencheur le documente : en mode
-- « transaction pooling », un SET de session fuirait vers la requête suivante
-- et laisserait le journal d'audit ouvert aux suppressions.
--
-- C'est la même raison pour laquelle `seed-rls-fixture.mjs` ne supprime jamais
-- ses organisations de test.
--
-- Tout le reste part par CASCADE : les 9 tables concernées sont toutes en
-- `on delete cascade` depuis `orgs`.
--
-- Idempotent : sans organisation portant ce nom, la migration ne fait rien.
-- ============================================================================

do $$
declare
  v_orgs uuid[];
  n_orgs int;
  n_membres int;
  n_clients int;
  n_jobs int;
begin
  select array_agg(id) into v_orgs
    from public.orgs where name = 'zz-archive-test-migration';

  if v_orgs is null then
    raise notice 'Aucune organisation « zz-archive-test-migration » : rien à faire.';
    return;
  end if;

  n_orgs := array_length(v_orgs, 1);

  -- Garde-fous : on refuse si de vraies données sont apparues depuis l'audit.
  select count(*) into n_membres from public.memberships where org_id = any(v_orgs);
  select count(*) into n_clients from public.clients     where org_id = any(v_orgs);
  select count(*) into n_jobs    from public.jobs        where org_id = any(v_orgs);

  if n_membres > 0 then
    raise exception 'REFUS : % compte(s) rattaché(s) à ces organisations.', n_membres;
  end if;
  if n_clients > 0 or n_jobs > 0 then
    raise exception 'REFUS : % client(s) et % job(s) rattachés — ce ne sont plus des organisations vides.', n_clients, n_jobs;
  end if;

  -- Ouvre la fenêtre de maintenance du journal d'audit, le temps de cette
  -- transaction seulement (voir l'en-tête : SET LOCAL, jamais SET).
  set local app.audit_maintenance = 'on';

  delete from public.orgs where id = any(v_orgs);

  raise notice '% organisation(s) de test retirée(s), cascade comprise.', n_orgs;
end $$;

-- Vérification.
do $$
declare
  restant int;
  total int;
begin
  select count(*) into restant from public.orgs where name = 'zz-archive-test-migration';
  select count(*) into total   from public.orgs where deleted_at is null;

  if restant > 0 then
    raise exception 'Il reste % organisation(s) de test.', restant;
  end if;
  raise notice 'Organisations restantes en base : %.', total;
end $$;
