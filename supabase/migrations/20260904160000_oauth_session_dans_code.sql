-- La session Supabase dédiée à Claude était mémorisée entre le consentement et
-- l'échange du code dans une Map EN MÉMOIRE du serveur. Un redémarrage (déploi,
-- scaling, restart Railway) pendant ces quelques secondes vidait la Map : le
-- jeton OAuth naissait alors SANS session, et tous les outils à identité
-- (finances, conseil, écritures) restaient morts jusqu'à une reconnexion
-- chanceuse. On stocke désormais la session chiffrée À CÔTÉ DU CODE, en base :
-- elle survit à n'importe quel redémarrage.
alter table public.oauth_authorization_codes
  add column if not exists supabase_session_chiffre text;

comment on column public.oauth_authorization_codes.supabase_session_chiffre is
  'Refresh token de la session Supabase dédiée, chiffré (AES-256-GCM via AGENT_JWT_SECRET). Posé au consentement, relu à l''échange du code puis transféré vers oauth_tokens. Survit à un redémarrage serveur (contrairement à l''ancienne Map mémoire).';
