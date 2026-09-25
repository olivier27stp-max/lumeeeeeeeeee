-- Taxes orphelines : désactivées (jamais supprimées).
--
-- Avant #656, supprimer une région (DELETE /taxes/group) gardait ses taxes
-- ACTIVES, hors de toute région : invisibles dans Réglages → Taxes, mais
-- appliquées par resolveTaxesForOrg dès que le bureau n'a plus aucune région
-- (TPS + TVQ comptées deux fois). #656 empêche d'en créer de nouvelles ; ceci
-- range celles qui existent déjà (prod 2026-09-25 : Coquin lavage 2, Vision
-- Lavage 2, QA Santé B 4). Décision de Rafba : « choisis » → désactiver.
--
-- Seulement dans les bureaux qui ont au moins une région : sans région, les
-- taxes actives restent la vérité (repli volontaire de resolveTaxesForOrg).
-- Désactiver est réversible et garde le numéro d'inscription que relisent les
-- anciens documents. Idempotent.
update public.tax_configs c
   set is_active = false,
       updated_at = now()
 where c.is_active
   and not exists (select 1 from public.tax_group_items i where i.tax_config_id = c.id)
   and exists (select 1 from public.tax_groups g where g.org_id = c.org_id);
