-- ============================================================================
-- PROPOSÉE — NE PAS APPLIQUER SANS L'OK DE RAFBA (audit commissions 2026-09-30)
--
-- Ajoute la politique de remboursement « clawback » (« Reprendre ») au choix
-- de l'entreprise (Commissions › Réglages). Avec elle, une commission déjà
-- versée dont la facture est remboursée reste versée dans SA période (période
-- versée = verrouillée) et une ligne NÉGATIVE visible est ajoutée à la période
-- en cours. Les politiques existantes (alert par défaut, auto, keep) ne
-- changent pas ; aucune entreprise n'est basculée.
--
-- Additive : élargit une contrainte CHECK, aucune donnée touchée.
-- ============================================================================
begin;
alter table public.commission_settings drop constraint if exists commission_settings_reversal_policy_check;
alter table public.commission_settings add constraint commission_settings_reversal_policy_check
  check (reversal_policy = any (array['auto', 'keep', 'alert', 'clawback']));
commit;
