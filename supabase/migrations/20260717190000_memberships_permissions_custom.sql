-- Permissions par utilisateur : marque une membership dont les permissions ont
-- été personnalisées. La sauvegarde d'un preset de rôle saute ces membres au
-- lieu d'écraser leurs personnalisations.
alter table public.memberships
  add column if not exists permissions_custom boolean not null default false;
