-- ═══════════════════════════════════════════════════════════════
-- Le deal passe à « Gagné » quand le client accepte la soumission
--
-- Demande de Rafba (2026-09-30), suite de la règle « un deal ne compte que
-- ce qui arrive après son entrée dans la pipeline » (20261003200000) : un
-- devis fait APRÈS le deal et accepté fait passer le deal à « Gagné ». Un
-- devis d'avant le deal ne le touche jamais (dealDeLaSoumission + trigger
-- deals_lien_posterieur).
--
-- Automatisation par défaut `quote_approved_move_deal` pour chaque entreprise
-- EXISTANTE (nouvelles lignes seulement, clé `preset_key` — jamais de
-- doublon) : sur « Devis accepté », le deal lié passe à l'étape de type
-- `won` de son pipeline (action move_deal_stage, cible `gagne`). Seulement
-- depuis une étape ouverte : un deal gagné ou perdu ne bouge pas. Active,
-- visible et désactivable dans Automatisations, comme ses deux sœurs
-- (quote_sent_move_deal, quote_opened_move_deal). Les nouvelles entreprises
-- la reçoivent par le seeder (PACK_ACTIF).
--
-- ROLLBACK :
--   delete from public.automation_rules where preset_key = 'quote_approved_move_deal';
-- ═══════════════════════════════════════════════════════════════

begin;

insert into public.automation_rules
  (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
select o.id,
  'Passer le deal à « Gagné » quand la soumission est acceptée',
  'Quand le client accepte une soumission faite depuis l''entrée du deal dans la pipeline, le deal passe à « Gagné » (bande « job à créer » tant que la job n''existe pas). Jamais depuis un deal déjà gagné ou perdu, jamais pour un devis d''avant le deal.',
  'quote.approved',
  '{}'::jsonb,
  0,
  jsonb_build_array(jsonb_build_object(
    'type', 'move_deal_stage',
    'config', jsonb_build_object('cible', 'gagne'))),
  true, true, 'quote_approved_move_deal'
from public.orgs o
where not exists (select 1 from public.automation_rules r where r.org_id = o.id and r.preset_key = 'quote_approved_move_deal');

commit;
