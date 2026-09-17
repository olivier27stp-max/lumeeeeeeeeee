-- Plafonds internes d'inférence Lumi abaissés (décision Rafba 2026-09-17).
-- Mesuré cette semaine : un tour chaud coûte 0,6 à 1 ¢, 1,5 ¢ à froid, et
-- ~30 % des demandes ne touchent plus le modèle (raccourcis, caches, actions
-- directes). Un utilisateur actif coûte 4 à 6 $ par mois. Les plafonds
-- précédents (40 $ Scale, 80 $ Autopilot, migration 20260911010000) valaient
-- dix fois l'usage réel : c'était une exposition sans contrepartie.
--
--   Scale     : 40 $ → 20 $  (≈ 3 000 messages par mois, 3-4 personnes actives)
--   Autopilot : 80 $ → 45 $  (≈ 6 500 messages par mois, 8-10 personnes actives)
--   Minimum   : 0 $ (inchangé, sans IA)
--
-- Le plafond reste invisible pour le client et n'est pas une coupure sèche :
-- mode économe à 70 %, restreint à 90 %, gabarit « en pause jusqu'au 1er » à
-- 100 %, et jamais plus de 15 % du mois en une journée (regles-cout.ts). Les
-- packs de lumees prépayés restent la porte de sortie des gros utilisateurs.
-- Appliquée sur staging puis en prod le 2026-09-17.

update public.plans set ai_monthly_budget_cents = 2000 where slug = 'pro';
update public.plans set ai_monthly_budget_cents = 4500 where slug = 'autopilot';
