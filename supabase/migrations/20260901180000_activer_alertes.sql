-- ============================================================================
-- Activation des alertes — le moteur tournait dans le vide
-- ============================================================================
-- CONSTAT (2026-09-01, audit du robot de recette)
-- `runAlertScan` s'exécute toutes les 30 minutes en production depuis la mise
-- en ligne du serveur (server/index.ts:1054). Or `alert_rules` est VIDE : zéro
-- règle, dans toutes les organisations. Le moteur lit une liste vide et repart.
--
-- Pire : il n'existe NI écran NI route pour créer une règle. La fonctionnalité
-- a été entièrement construite — quatre types d'alertes, un moteur, des
-- notifications, une déduplication — puis jamais branchée. Personne n'a donc
-- jamais été prévenu d'une facture en retard.
--
-- CE QUE FAIT CETTE MIGRATION
-- Elle crée les quatre règles pour chaque organisation qui n'en a pas encore.
-- Les alertes arrivent dans le centre de notifications de l'application ;
-- `notify_email` reste à FALSE, donc aucun courriel ne part : un seuil mal
-- réglé ne peut pas noyer une boîte de réception.
--
-- SEUILS RETENUS — volontairement prudents
--   invoice_overdue   30 j  … une facture impayée depuis un mois
--   job_overdue        1 j  … un job d'hier encore ouvert mérite un regard
--   client_inactive   90 j  … aligné sur l'automatisation « réengagement 90 j »
--   low_pipeline    5 devis … alerte si moins de 5 devis en cours
--
-- `job_overdue` est un type NOUVEAU, ajouté à `server/lib/alerts-engine.ts`
-- dans le même lot. Il remplace « Late job alert - not completed on time », un
-- workflow de l'ancien constructeur marqué actif mais que plus rien
-- n'exécutait (voir 20260901170000).
--
-- Idempotent : `on conflict do nothing` + filtre sur l'existant.
-- ============================================================================

insert into public.alert_rules (org_id, rule_type, enabled, threshold_days, threshold_count, notify_email)
select o.id, v.rule_type, true, v.jours, v.compte, false
  from public.orgs o
 cross join (values
     ('invoice_overdue', 30, null::int),
     ('job_overdue',      1, null::int),
     ('client_inactive', 90, null::int),
     ('low_pipeline',  null,          5)
   ) as v(rule_type, jours, compte)
 where o.deleted_at is null
   and not exists (
     select 1 from public.alert_rules ar
      where ar.org_id = o.id and ar.rule_type = v.rule_type
   );

do $$
declare
  n_org int;
  n_regles int;
begin
  select count(distinct org_id), count(*) into n_org, n_regles
    from public.alert_rules where enabled;

  raise notice 'Alertes actives : % règle(s) sur % organisation(s).', n_regles, n_org;

  if n_regles = 0 then
    raise exception 'Aucune règle active après la migration — le moteur resterait muet.';
  end if;
end $$;

comment on table public.alert_rules is
  'Règles du moteur d''alertes (runAlertScan, toutes les 30 min). Types gérés : '
  'invoice_overdue, job_overdue, client_inactive, team_overload, low_pipeline. '
  'Une organisation sans règle ne reçoit AUCUNE alerte — c''était le cas de '
  'toutes jusqu''au 2026-09-01. Il n''existe pas encore d''écran de réglage : '
  'ajouter un type ici demande une migration.';
