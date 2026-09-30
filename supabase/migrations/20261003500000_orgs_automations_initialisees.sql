-- ═══════════════════════════════════════════════════════════════
-- Le socle d'automatisations ne s'applique qu'UNE fois par entreprise.
--
-- `ensureAutomationPresets(…, { activateAll: true })` publie le pack de base
-- et met tout le reste en brouillon. Voulu à la création — mais le webhook
-- de paiement (lien de paiement acheté par quelqu'un qui a déjà un compte)
-- et l'onboarding le rappelaient sur une entreprise EXISTANTE : ses
-- automatisations étaient remises à zéro sans un mot (constaté le
-- 2026-09-30, jamais signalé par un client).
--
-- La colonne retient le moment où le socle a été posé ; le code ne
-- l'applique plus jamais ensuite. Les entreprises existantes l'ont TOUTES
-- déjà reçu : elles sont marquées maintenant.
--
-- Purement additif : une colonne nullable, aucune règle ne change.
--
-- ROLLBACK : alter table public.orgs drop column if exists automations_initialisees_le;
-- ═══════════════════════════════════════════════════════════════

begin;

alter table public.orgs
  add column if not exists automations_initialisees_le timestamptz;

comment on column public.orgs.automations_initialisees_le is
  'Moment où le pack de base d''automatisations a été posé (une seule fois) ; null = entreprise neuve, pas encore installée.';

update public.orgs
   set automations_initialisees_le = coalesce(automations_initialisees_le, created_at, now())
 where automations_initialisees_le is null;

commit;
