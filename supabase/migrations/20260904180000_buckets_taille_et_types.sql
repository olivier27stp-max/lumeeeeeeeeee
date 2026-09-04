-- ═══════════════════════════════════════════════════════════════
-- Une taille maximale et des types autorisés sur chaque bucket.
--
-- CONSTAT DU 2026-09-04 (staging, session réelle d'un membre)
-- Trois buckets n'avaient ni limite de taille ni restriction de type :
-- `avatars` et `company-logos` (PUBLICS) et `job-photos`. Un fichier de
-- 30 Mo de zéros y est entré sans broncher. Rien n'empêche 30 Go.
--
-- L'application impose bien 10 à 15 Mo et image/* — mais dans le
-- navigateur, et par le relais serveur. Un membre authentifié qui parle
-- directement à Supabase Storage n'a aucune de ces limites. Le bucket
-- est le seul endroit où elles tiennent dans tous les cas.
--
-- (Vérifié au passage : un HTML déposé dans un bucket public est servi
-- en text/plain avec nosniff — Supabase empêche déjà d'y héberger une
-- page. Ce n'est donc pas le sujet ici ; la taille l'est.)
--
-- LES PLAFONDS
-- Mesuré en prod avant de choisir : le plus gros avatar fait 56 Ko, le
-- plus gros logo 139 Ko, la plus grosse photo de job 694 Ko.
--
--     avatars ........  10 Mo   images
--     company-logos ..  10 Mo   images (SVG compris : un logo l'est souvent)
--     job-photos .....  25 Mo   images et vidéos (HEIC des iPhone inclus)
--     attachments ....  50 Mo   tous types — inchangé, reçoit PDF et vidéos
--
-- Les jokers (`image/*`) sont compris par Supabase Storage.
-- ═══════════════════════════════════════════════════════════════

begin;

update storage.buckets
   set file_size_limit    = 10 * 1024 * 1024,
       allowed_mime_types = array['image/*']
 where id = 'avatars';

update storage.buckets
   set file_size_limit    = 10 * 1024 * 1024,
       allowed_mime_types = array['image/*']
 where id = 'company-logos';

update storage.buckets
   set file_size_limit    = 25 * 1024 * 1024,
       allowed_mime_types = array['image/*', 'video/*']
 where id = 'job-photos';

commit;
