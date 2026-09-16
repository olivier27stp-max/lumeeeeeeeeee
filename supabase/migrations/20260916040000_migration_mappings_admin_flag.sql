-- Console /admin/migrations › Correspondances : drapeau de couleur posé par
-- l'admin plateforme sur une ligne (colonne importée) pour la repérer.
-- Note interne : jamais renvoyée au portail client (select explicite dans
-- migration-portal.ts). NULL = pas de drapeau. Une ré-analyse du fichier
-- recrée les correspondances, donc efface les drapeaux (comportement voulu).
alter table public.migration_field_mappings
  add column if not exists admin_flag text default null
    check (admin_flag is null or admin_flag in ('red', 'amber', 'green', 'blue', 'purple'));

comment on column public.migration_field_mappings.admin_flag is
  'Drapeau de couleur de l''admin plateforme (red|amber|green|blue|purple, NULL = aucun). Note interne, invisible pour le client.';
