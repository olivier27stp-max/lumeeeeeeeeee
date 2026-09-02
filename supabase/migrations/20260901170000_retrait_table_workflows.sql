-- ============================================================================
-- Retrait de la table `workflows` — l'ancien constructeur d'automatisations
-- ============================================================================
-- CONSTAT (2026-09-01, audit du robot de recette)
--   public.workflows : 31 lignes en production, toutes dans « Coquin lavage ».
--   3 d'entre elles sont marquées ACTIVES — mais aucune ne s'exécute.
--
-- POURQUOI ELLES NE FONT RIEN
-- Le moteur qui lisait cette table a été retiré avec le constructeur visuel
-- (voir le commentaire de `server/lib/automationEngine.ts`). Aucun code du
-- dépôt ne lit plus `workflows` : ni le serveur, ni l'application, ni une
-- fonction, ni une vue. Les 4 tables satellites (nodes/edges/runs/logs) ont
-- été retirées par 20260901160000.
--
-- CE QUI LES REMPLACE, ET POURQUOI IL N'Y A AUCUNE PERTE
-- `automation_rules` porte 35 automatisations ACTIVES pour Coquin lavage —
-- vérifiées une à une : relances de devis (1/3/7/14/21 j), rappels de job
-- (1 sem / 1 j / 2 h avant), rappels de facture (1/3/7/14/30 j), accueil de
-- lead, demandes d'avis, confirmations de dépôt et de paiement, réengagement
-- 90 j, « 1 an avec nous ». Les 28 workflows inactifs y ont tous leur
-- équivalent ; sur les 3 « actifs » :
--   • « Quote accepted - create job »  → l'événement `quote.approved` est bien
--     émis (server/routes/quotes.ts:1058) et traité par le nouveau moteur ;
--   • « Lead no response after 4 hours » → couvert, à 1 jour, par
--     `lead_followup_1d` ;
--   • « Late job alert »               → seul manque réel, réintroduit comme
--     alerte `job_overdue` dans server/lib/alerts-engine.ts.
--
-- POURQUOI SUPPRIMER PLUTÔT QUE LAISSER DORMIR
-- Trois lignes marquées « actives » qui ne font rien sont un piège : la
-- prochaine personne qui ouvrira cette table croira que ces automatisations
-- tournent. Le contenu exact est conservé ci-dessous.
--
-- Idempotent : `if exists`.
-- ============================================================================

-- Garde-fou : refuser si une dépendance est apparue depuis l'audit.
do $$
declare
  dep int;
begin
  select count(*) into dep
    from pg_constraint c
    join pg_class tp on tp.oid = c.confrelid
    join pg_namespace n on n.oid = tp.relnamespace
   where n.nspname = 'public' and c.contype = 'f' and tp.relname = 'workflows';

  if dep > 0 then
    raise exception 'REFUS : % table(s) dépendent encore de public.workflows.', dep;
  end if;
end $$;

drop table if exists public.workflows;

-- La fonction qui numérotait les workflows (WF-1001, WF-1002…) devient
-- orpheline : son déclencheur est parti avec la table, et elle référence
-- `public.workflows` qui n'existe plus. Laissée en place, elle serait
-- signalée par `npm run check:broken-objects` — c'est d'ailleurs ce détecteur
-- qui l'a trouvée ici. Une référence morte casse en silence : la règle 4 du
-- CLAUDE.md impose de la retirer.
do $$
declare
  encore_utilisee int;
begin
  if to_regprocedure('public.generate_workflow_public_id()') is null then
    return;
  end if;

  select count(*) into encore_utilisee
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where p.proname = 'generate_workflow_public_id' and not t.tgisinternal;

  if encore_utilisee > 0 then
    raise exception 'REFUS : generate_workflow_public_id() sert encore à % déclencheur(s).', encore_utilisee;
  end if;

  drop function public.generate_workflow_public_id();
  raise notice 'Fonction orpheline generate_workflow_public_id() retirée.';
end $$;

do $$
begin
  if to_regclass('public.workflows') is not null then
    raise exception 'public.workflows existe toujours.';
  end if;
  raise notice 'Table workflows retirée (31 lignes, ancien constructeur).';
end $$;

-- ============================================================================
-- CONTENU RETIRÉ — les 31 workflows, tels qu'ils étaient en production
-- ============================================================================
--   [inactif] Client inactive 90 days re-engagement  (declencheur: lead_updated, cree 2026-03-31)
--   [inactif] Day-of appointment confirmation  (declencheur: job_scheduled, cree 2026-03-31)
--   [inactif] Deal stage changed - update team  (declencheur: pipeline_deal_stage_changed, cree 2026-03-31)
--   [inactif] Deposit received confirmation  (declencheur: payment_received, cree 2026-03-31)
--   [inactif] Form submitted - auto reply  (declencheur: form_submitted, cree 2026-03-31)
--   [inactif] Invoice 7 days overdue escalation  (declencheur: invoice_overdue, cree 2026-03-31)
--   [inactif] Invoice created - send to client  (declencheur: invoice_created, cree 2026-03-31)
--   [inactif] Invoice paid - thank and close  (declencheur: payment_received, cree 2026-03-31)
--   [inactif] Invoice reminder 3 days overdue  (declencheur: invoice_overdue, cree 2026-03-31)
--   [inactif] Job reminder 24h before appointment  (declencheur: job_scheduled, cree 2026-03-31)
--   [inactif] Job scheduled - notify client  (declencheur: job_scheduled, cree 2026-03-31)
--   [inactif] Job started - notify team  (declencheur: job_started, cree 2026-03-31)
--   [actif]   Late job alert - not completed on time  (declencheur: job_started, cree 2026-03-31)
--   [actif]   Lead no response after 4 hours  (declencheur: lead_created, cree 2026-03-31)
--   [inactif] Missed appointment follow-up  (declencheur: job_scheduled, cree 2026-03-31)
--   [inactif] New client onboarding email  (declencheur: lead_converted, cree 2026-03-31)
--   [inactif] New lead welcome SMS  (declencheur: lead_created, cree 2026-03-31)
--   [inactif] Notify when quote is viewed  (declencheur: estimate_sent, cree 2026-03-31)
--   [inactif] Nouveau workflow  (declencheur: lead_created, cree 2026-03-31)
--   [inactif] Payment received confirmation  (declencheur: payment_received, cree 2026-03-31)
--   [inactif] Quote 2nd follow-up after 7 days  (declencheur: quote_sent, cree 2026-03-31)
--   [actif]   Quote accepted - create job  (declencheur: quote_approved, cree 2026-03-31)
--   [inactif] Quote declined follow-up  (declencheur: quote_declined, cree 2026-03-31)
--   [inactif] Quote expiring soon reminder  (declencheur: quote_sent, cree 2026-03-31)
--   [inactif] Quote follow-up after 1 day  (declencheur: quote_sent, cree 2026-03-31)
--   [inactif] Quote reminder after 3 days  (declencheur: quote_sent, cree 2026-03-31)
--   [inactif] Review not submitted after 3 days  (declencheur: review_not_submitted, cree 2026-03-31)
--   [inactif] Review request after job completed  (declencheur: job_completed, cree 2026-03-31)
--   [inactif] Technician arrived - notify client  (declencheur: technician_arrived, cree 2026-03-31)
--   [inactif] Thank you email after service  (declencheur: job_completed, cree 2026-03-31)
--   [inactif] Weekly pipeline review reminder  (declencheur: lead_updated, cree 2026-03-31)
-- ============================================================================
-- Structure retirée (extraite de la production le 2026-09-01) :
--   id uuid, org_id uuid, name text, description text, active boolean,
--   trigger_type text, trigger_config jsonb, created_by uuid,
--   created_at timestamptz, updated_at timestamptz, status text,
--   preset_id uuid
-- ============================================================================
