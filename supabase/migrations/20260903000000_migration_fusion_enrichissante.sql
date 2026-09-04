-- Fusion enrichissante des migrations assistées (audit sections 1-5, S5).
-- Quand une ligne importée est fusionnée avec un dossier client existant,
-- l'import comble désormais les champs VIDES du dossier (jamais d'écrasement)
-- au lieu de jeter la ligne source entière. Cette colonne consigne les valeurs
-- d'origine des champs comblés pour que le rollback les restaure fidèlement.
--
-- Le code tolère l'absence de la colonne (repli sans enrichissement consigné),
-- mais appliquer ce SQL est requis pour un rollback fidèle des fusions.

begin;

alter table public.migration_import_records
  add column if not exists previous_values jsonb;

comment on column public.migration_import_records.previous_values is
  'Fusion enrichissante : valeurs d''origine des champs du dossier existant comblés par l''import (null = aucun champ modifié). Permet la restauration exacte au rollback.';

commit;
