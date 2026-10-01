-- ============================================================================
-- Préréglages « Paiement reçu » / « Dépôt reçu » : remettre la condition
-- payment_type que le seed SQL a oubliée.
--
-- NON APPLIQUÉE (suite QA des automatisations, 2026-09-30) — à appliquer
-- staging puis prod selon le pipeline, après relecture.
--
-- CONSTAT (staging, 2026-09-30) : seed_automation_presets() — trigger de
-- création d'entreprise — insère payment_confirmation et deposit_received avec
-- conditions = '{}' ; le catalogue serveur (automationPresets.data.ts) porte
-- payment_type <> 'deposit' et payment_type = 'deposit'. Le filet serveur
-- (ensureAutomationPresets) n'insérant que les préréglages MANQUANTS, la
-- version sans condition gagne : 29 entreprises sur 32 sur staging. Chaque
-- paiement déclenche les deux règles (un dépôt reçoit « Paiement reçu », un
-- paiement complet fait notifier « Dépôt reçu »).
--
-- Le code (ensureAutomationPresets, étape 1c) répare désormais les nouvelles
-- entreprises et toute entreprise qui repasse par le filet. Cette migration
-- répare les existantes. Elle ne touche QUE les lignes dont la condition est
-- encore vide (jamais une condition choisie par l'entreprise).
--
-- Reste à faire (hors de cette migration) : aligner le corps de
-- seed_automation_presets() sur le catalogue serveur.
-- ============================================================================

begin;

update public.automation_rules
   set conditions = '{"payment_type": {"neq": "deposit"}}'::jsonb,
       updated_at = now()
 where preset_key = 'payment_confirmation'
   and is_preset = true
   and conditions = '{}'::jsonb;

update public.automation_rules
   set conditions = '{"payment_type": "deposit"}'::jsonb,
       updated_at = now()
 where preset_key = 'deposit_received'
   and is_preset = true
   and conditions = '{}'::jsonb;

commit;

-- DOWN : rien à défaire de façon sûre (on ne sait plus quelles lignes étaient
-- vides) ; la condition remise correspond au catalogue.
