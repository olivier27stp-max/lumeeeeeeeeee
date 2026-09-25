-- ═══════════════════════════════════════════════════════════════
-- Les automatisations deviennent des SÉQUENCES.
--
-- AVANT : une règle = un déclencheur, UN délai, N actions exécutées d'un
-- seul coup. Pour relancer un devis à J+1, J+3, J+7, J+14 et J+21, il
-- fallait CINQ règles distinctes, sans lien entre elles, qu'on activait et
-- modifiait une par une. Et surtout : aucune branche possible — pas de
-- « si le client a répondu, arrête », pas de « sinon, relance ».
--
-- APRÈS : une règle porte un GRAPHE D'ÉTAPES (`steps`), exécutées une à la
-- fois, chacune planifiant la suivante.
--
-- ── Pourquoi une colonne et non une table ──────────────────────
-- Une table `automation_steps` aurait été plus « propre » en théorie. Trois
-- raisons de ne pas le faire :
--   1. le moteur lit la règle entière à chaque événement ; une table imposerait
--      une jointure sur un chemin déjà chaud ;
--   2. une étape n'a aucune existence hors de sa règle — jamais requêtée seule,
--      jamais partagée ;
--   3. `actions` est DÉJÀ un jsonb qui porte la même forme. Migrer vers une
--      table demanderait de réécrire les 35 préréglages et tout le moteur.
-- `steps` reste donc NULL sur les règles simples : elles continuent de tourner
-- exactement comme avant, sans conversion ni risque.
--
-- ── Forme d'une étape ──────────────────────────────────────────
--   { "id": "e1", "type": "action",   "action": {...}, "suivant": "e2" }
--   { "id": "e2", "type": "attendre", "delai_secondes": 259200, "suivant": "e3" }
--   { "id": "e3", "type": "si",       "conditions": {...},
--                 "alors": "e4", "sinon": "e5" }
--   { "id": "e4", "type": "arreter" }
--
-- L'enchaînement est porté par `suivant` plutôt que par l'ordre du tableau :
-- réordonner une étape dans l'interface ne doit pas changer le parcours, et
-- une branche « si » a DEUX suites — un tableau ordonné ne saurait pas les
-- exprimer.
-- ═══════════════════════════════════════════════════════════════

-- ── Le graphe ────────────────────────────────────────────────
alter table public.automation_rules
  add column if not exists steps jsonb;

comment on column public.automation_rules.steps is
  'Graphe d''étapes d''une séquence (null = règle simple, pilotée par delay_seconds + actions). '
  'Chaque étape : {id, type: action|attendre|si|arreter, ...,  suivant}. '
  'Validé côté serveur par automationSequenceSchema (server/lib/validation.ts).';

-- ── Le curseur ───────────────────────────────────────────────
-- Quelle étape cette tâche exécute. NULL pour les tâches des règles simples,
-- dont le comportement ne change pas.
--
-- ATTENTION à l'anti-doublon : `idx_scheduled_tasks_dedup` est unique sur
-- (org_id, execution_key) parmi les tâches pending/running. La clé d'une étape
-- vaut `ruleId:entityId:step:<id>` — l'identifiant d'étape y entre, donc deux
-- étapes différentes de la même séquence ne se bloquent pas l'une l'autre,
-- tandis que replanifier DEUX FOIS la même étape pour la même entité reste
-- impossible. C'est exactement la protection qui existait déjà (un incident de
-- double envoi est documenté dans automationEngine.ts) : elle n'est pas
-- assouplie, seulement étendue.
alter table public.automation_scheduled_tasks
  add column if not exists step_id text;

comment on column public.automation_scheduled_tasks.step_id is
  'Étape de la séquence que cette tâche exécute (null = règle simple). '
  'Entre aussi dans execution_key, pour que l''anti-doublon reste par étape.';

-- ── Le contexte du parcours ──────────────────────────────────
-- Les métadonnées de l'événement déclencheur voyagent déjà dans
-- `action_config.event_metadata`. Une séquence en a besoin À CHAQUE étape :
-- une étape « si » évalue ses conditions contre ces métadonnées, plusieurs
-- jours après l'événement. Les stocker à part évite de les recopier dans
-- chaque `action_config` et garde la trace de ce qui a décidé du parcours.
alter table public.automation_scheduled_tasks
  add column if not exists sequence_context jsonb;

comment on column public.automation_scheduled_tasks.sequence_context is
  'Métadonnées de l''événement déclencheur, transportées d''étape en étape '
  'pour que les conditions d''une étape « si » s''évaluent contre le même '
  'contexte que le déclenchement.';

-- ── Retrouver les tâches d'une séquence ──────────────────────
-- Annuler une séquence en cours (le client a répondu, le devis est accepté)
-- demande de retrouver toutes les tâches en attente d'une règle pour une
-- entité. Sans index, c'est un balayage à chaque annulation.
create index if not exists idx_scheduled_tasks_sequence
  on public.automation_scheduled_tasks (org_id, automation_rule_id, entity_id)
  where status = 'pending';
