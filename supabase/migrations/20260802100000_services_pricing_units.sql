-- Services tarifés à la mesure : unité de tarification + défaut pour l'outil Mesure.
-- 'flat' = forfait (comportement historique), 'linear_ft' = $/pi linéaire,
-- 'sq_ft' = $/pi². Un service marqué measure_default est attaché automatiquement
-- aux nouvelles formes de l'outil Mesure dont le type correspond (chemin →
-- linear_ft, zone → sq_ft). Plusieurs défauts possibles par unité (une ligne de
-- devis par service). Rétrocompatible : tout l'existant reste 'flat'.

alter table public.predefined_services
  add column if not exists pricing_unit text not null default 'flat'
    check (pricing_unit in ('flat', 'linear_ft', 'sq_ft')),
  add column if not exists measure_default boolean not null default false;

comment on column public.predefined_services.pricing_unit is
  'flat (forfait) | linear_ft ($/pi lin) | sq_ft ($/pi²)';
comment on column public.predefined_services.measure_default is
  'Attaché automatiquement aux nouvelles mesures du type correspondant';
