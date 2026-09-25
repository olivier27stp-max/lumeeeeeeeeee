-- ═══════════════════════════════════════════════════════════════
-- Les réglages propres à une automatisation.
--
-- Jusqu'ici, trois comportements étaient EN DUR dans le moteur :
--   · la fenêtre d'envoi 8 h–20 h (`automationEngine.ts`) ;
--   · l'arrêt quand l'entité change d'état (`checkStopConditions`) ;
--   · une seule inscription par entité, via la clé d'unicité.
--
-- Ils sont bons par défaut — c'est même ce qui distingue Lume de
-- GoHighLevel, où ces réglages sont cachés dans un onglet que personne
-- n'ouvre. Mais une entreprise doit pouvoir les ajuster : un plombier
-- d'urgence veut texter à 22 h, un déneigeur veut relancer le même client
-- chaque hiver.
--
-- ── Pourquoi un seul jsonb, pas six colonnes ───────────────────
-- Ces réglages sont lus ENSEMBLE, à chaque exécution, et jamais filtrés en
-- SQL (« toutes les règles où re-entry = true » n'a aucun sens). Six
-- colonnes coûteraient six migrations à chaque nouveau réglage, pour un
-- gain nul. `settings` reste NULL tant que rien n'est changé : une règle
-- qui n'y touche pas garde exactement le comportement d'aujourd'hui.
--
-- Forme (validée côté serveur par `automationSettingsSchema`) :
--   {
--     "reentree": false,          -- le même client peut-il repasser ?
--     "arret_sur_reponse": true,  -- sortir s'il répond
--     "fenetre": { "debut": 8, "fin": 20 },  -- heures locales
--     "jours_ouvrables": false,   -- lundi-vendredi seulement
--     "marquer_lu": false         -- ne pas remonter en non-lu
--   }
-- ═══════════════════════════════════════════════════════════════

alter table public.automation_rules
  add column if not exists settings jsonb;

comment on column public.automation_rules.settings is
  'Réglages propres à cette automatisation (null = les défauts du moteur : '
  'fenêtre 8h-20h, arrêt sur changement d''état, une inscription par entité). '
  'Validé par automationSettingsSchema dans server/lib/validation.ts.';
