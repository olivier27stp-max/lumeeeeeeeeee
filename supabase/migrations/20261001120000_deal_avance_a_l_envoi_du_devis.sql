-- ═══════════════════════════════════════════════════════════════
-- Le deal avance tout seul quand la soumission part chez le client
--
-- Demande de Rafba (2026-09-28) : faire le devis depuis la fiche du deal, et
-- que la pipeline suive sans qu'on déplace la carte à la main.
--
-- Automatisation par défaut `quote_sent_move_deal` pour chaque entreprise
-- EXISTANTE (nouvelles lignes seulement, clé `preset_key` — jamais de
-- doublon) : sur « Devis envoyé », le deal lié passe à l'étape de rôle
-- `soumission_envoyee` (action move_deal_stage, cible `role_envoyee`).
-- Seulement vers l'avant : un deal déjà plus loin, gagné ou perdu ne bouge
-- pas (garde dans executeMoveDealStage). Active, visible et désactivable
-- dans Automatisations. Les nouvelles entreprises la reçoivent par le seeder.
--
-- ROLLBACK :
--   delete from public.automation_rules where preset_key = 'quote_sent_move_deal';
-- ═══════════════════════════════════════════════════════════════

begin;

insert into public.automation_rules
  (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
select o.id,
  'Avancer le deal quand la soumission est envoyée',
  'Dès que la soumission part chez le client, le deal lié passe à « Soumission envoyée ». Seulement vers l''avant : un deal déjà plus loin, gagné ou perdu ne bouge pas.',
  'quote.sent',
  '{}'::jsonb,
  0,
  jsonb_build_array(jsonb_build_object(
    'type', 'move_deal_stage',
    'config', jsonb_build_object('cible', 'role_envoyee'))),
  true, true, 'quote_sent_move_deal'
from public.orgs o
where not exists (select 1 from public.automation_rules r where r.org_id = o.id and r.preset_key = 'quote_sent_move_deal');

commit;
