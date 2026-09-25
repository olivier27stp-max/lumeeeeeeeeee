-- Captures d'écran dans le chat de support (2026-09-17).
--
-- Un client qui rapporte un bug peut joindre jusqu'à trois images à son
-- message. Elles vont dans le bucket privé `support-captures` (8 Mo, images
-- seulement ; le navigateur réduit à 1 600 px avant l'envoi), le serveur seul
-- y écrit et signe les liens (service_role) : aucune policy storage pour les
-- clients. Lumi les regarde (Sonnet lit les images) et l'équipe les reçoit
-- dans Slack par lien signé 7 jours.
--
-- support_messages.pieces : [{ chemin, nom, type, taille }] sur le message du client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('support-captures', 'support-captures', false, 8 * 1024 * 1024, array['image/*'])
  on conflict (id) do update set public = false, file_size_limit = 8 * 1024 * 1024, allowed_mime_types = array['image/*'];

alter table public.support_messages add column if not exists pieces jsonb not null default '[]'::jsonb;
comment on column public.support_messages.pieces is 'Captures jointes par le client : [{chemin, nom, type, taille}] dans le bucket support-captures (serveur seul).';
