-- ═══════════════════════════════════════════════════════════════
-- METTRE SES AUTOMATISATIONS EN PAUSE — par entreprise
--
-- POURQUOI. L'interrupteur d'arrêt existe (F6, #470), mais il est
-- GLOBAL à la plateforme et pilotable par une variable d'environnement :
-- seul l'éditeur peut l'actionner, et couper punirait tous les clients à
-- la fois.
--
-- Le jour où une entreprise voit partir des messages qu'elle ne veut pas
-- — import massif qui déclenche tout, gabarit qui part de travers,
-- campagne lancée trop tôt — elle n'a aujourd'hui aucun moyen d'arrêter.
-- Désactiver 43 automatisations une par une prend des minutes ; un envoi
-- en rafale aussi. Et ce qui est parti est parti : chaque texto est
-- facturé, et lu par un vrai client.
--
-- CE QU'ON AJOUTE. Un interrupteur dans `company_settings` : la file est
-- CONSERVÉE, comme pour l'interrupteur global. On reprend où on en
-- était.
--
-- ADDITIVE ET RÉVERSIBLE. Une colonne, avec un défaut qui laisse tout
-- fonctionner : une entreprise existante n'est pas affectée.
-- Rollback = `alter table ... drop column` (en bas).
-- ═══════════════════════════════════════════════════════════════

/*
 * Le défaut est `false` (pas en pause). Une colonne absente ou nulle ne
 * doit JAMAIS couper les automatisations d'une entreprise : ce dépôt a
 * déjà payé des pannes muettes où l'absence de configuration éteignait
 * une fonctionnalité en silence.
 */
alter table public.company_settings
  add column if not exists automations_paused boolean not null default false;

/*
 * QUAND et PAR QUI. Sans ça, « pourquoi rien ne part depuis mardi ? » est
 * indébogable : on ne sait pas si quelqu'un a mis en pause, ni quand.
 * C'est la première question du support.
 */
alter table public.company_settings
  add column if not exists automations_paused_at timestamptz;

alter table public.company_settings
  add column if not exists automations_paused_by uuid references auth.users(id) on delete set null;

comment on column public.company_settings.automations_paused is
  'Interrupteur par entreprise : true = le moteur ne traite plus rien pour cette org. La file est conservée. Distinct de AUTOMATIONS_ENABLED, qui coupe TOUTE la plateforme.';

-- ═══════════════════════════════════════════════════════════════
-- ROLLBACK :
--
--   alter table public.company_settings drop column if exists automations_paused;
--   alter table public.company_settings drop column if exists automations_paused_at;
--   alter table public.company_settings drop column if exists automations_paused_by;
--
-- Aucune donnée existante n'est touchée : la colonne est neuve et son
-- défaut (`false`) reproduit le comportement d'avant.
-- ═══════════════════════════════════════════════════════════════
