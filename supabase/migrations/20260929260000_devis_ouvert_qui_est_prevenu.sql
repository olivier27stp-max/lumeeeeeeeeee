-- ═══════════════════════════════════════════════════════════════
-- « Devis ouvert par le client » : qui est prévenu
--
-- Décidé par Rafba le 2026-09-28 : le rep assigné au deal (s'il a accès au
-- pipeline), les propriétaires toujours, les administrateurs sauf ceux
-- exclus du pipeline. Nouveau choix « Pour qui » : `equipe_du_deal`.
--
-- Ne touche que l'automatisation par défaut quote_opened_notify ENCORE sur
-- son réglage d'origine (« responsable ») : une entreprise qui l'a modifiée
-- garde son choix.
--
-- ROLLBACK : même update en sens inverse (equipe_du_deal → responsable).
-- ═══════════════════════════════════════════════════════════════

begin;

update public.automation_rules
set actions = jsonb_set(actions, '{0,config,destinataire}', '"equipe_du_deal"'),
    description = 'Notification (et push) au rep assigné, aux propriétaires et aux admins qui ont accès au pipeline — dès la première ouverture.',
    updated_at = now()
where preset_key = 'quote_opened_notify'
  and actions -> 0 -> 'config' ->> 'destinataire' = 'responsable';

commit;
