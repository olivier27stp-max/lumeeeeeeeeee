-- Plafonds internes d'inférence Lumi recalibrés (décision Rafba 2026-09-10) :
-- un tour coûte ~1 ¢ depuis Sonnet 5 + cache + outils différés (6 ¢ le matin
-- même). 80 $ sur Scale = 11 000 questions/mois, hors de portée ; 40 $ suffit
-- largement (5 700 tours). Autopilot garde 80 $ (fonctions proactives à venir ;
-- la voix aura sa propre ligne). Ces montants restent INVISIBLES pour le
-- client : à 60 % Lumi passe en mode économe, à 100 % il ralentit (1/min).
update public.plans set ai_monthly_budget_cents = 4000 where slug = 'pro';
update public.plans set ai_monthly_budget_cents = 8000 where slug = 'autopilot';
