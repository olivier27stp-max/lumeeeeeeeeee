-- ═══════════════════════════════════════════════════════════════
-- « Devis ouvert par le client » : aussi par courriel, par défaut
--
-- Décidé par Rafba le 2026-09-28 : les personnes prévenues (rep assigné,
-- propriétaires, admins qui voient le pipeline) reçoivent aussi un courriel.
-- Nouvelle case « Aussi par courriel » de l'action Notifier l'équipe
-- (`par_courriel` = 'true').
--
-- Ne touche que l'automatisation par défaut quote_opened_notify restée sur
-- le réglage posé par 20260929260000 et sans choix de courriel : une
-- entreprise qui l'a modifiée garde son choix.
--
-- ROLLBACK : update public.automation_rules
--   set actions = actions #- '{0,config,par_courriel}'
--   where preset_key = 'quote_opened_notify';
-- ═══════════════════════════════════════════════════════════════

begin;

update public.automation_rules
set actions = jsonb_set(actions, '{0,config,par_courriel}', '"true"'),
    description = 'Notification (cloche et courriel) au rep assigné, aux propriétaires et aux admins qui ont accès au pipeline — dès la première ouverture.',
    updated_at = now()
where preset_key = 'quote_opened_notify'
  and actions -> 0 ->> 'type' = 'create_notification'
  and actions -> 0 -> 'config' ->> 'destinataire' = 'equipe_du_deal'
  and actions -> 0 -> 'config' -> 'par_courriel' is null;

commit;
