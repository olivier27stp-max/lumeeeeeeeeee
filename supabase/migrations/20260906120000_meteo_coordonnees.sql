-- ═══════════════════════════════════════════════════════════════
-- Météo : stocker les coordonnées exactes de la ville choisie
-- ─────────────────────────────────────────────────────────────
-- La météo de l'accueil re-géocodait le NOM de la ville avec Open-Meteo, sans
-- filtre pays : « Wickham » (Québec) tombait sur Wickham en Australie, et la
-- météo affichée n'avait aucun sens.
--
-- L'autocomplétion d'adresse (Google Places) fournit déjà les coordonnées
-- exactes au moment où l'utilisateur choisit sa ville. On les stocke ici pour
-- que la météo lise un point précis au lieu de deviner à partir d'un nom.
--
-- Nullable : les fiches existantes n'ont pas de coordonnées ; le code retombe
-- alors sur le géocodage du nom (désormais contraint au Canada). Rempli au
-- prochain enregistrement de la ville.
--
-- Ville du profil (chaque employé voit son coin) :
alter table public.team_members
  add column if not exists weather_lat double precision,
  add column if not exists weather_lng double precision;

-- Ville par défaut de l'entreprise (secours quand un profil n'a pas de ville) :
alter table public.company_settings
  add column if not exists weather_lat double precision,
  add column if not exists weather_lng double precision;

comment on column public.team_members.weather_lat is
  'Latitude de la ville du profil, capturée depuis l''autocomplétion. Utilisée par la météo de l''accueil pour éviter de re-géocoder un nom ambigu.';
comment on column public.company_settings.weather_lat is
  'Latitude de la ville de l''entreprise, capturée depuis l''autocomplétion (secours météo).';
