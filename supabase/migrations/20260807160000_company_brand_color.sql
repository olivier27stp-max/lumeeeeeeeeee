-- ═══════════════════════════════════════════════════════════════
--  Couleur de marque par entreprise
--
--  Les documents envoyés au client (contrat, soumission, page de
--  paiement) ne portaient de la marque que le logo : la palette était
--  monochrome et identique pour toutes les orgs. Une entreprise ne
--  pouvait pas se reconnaître dans ce qu'elle envoie.
--
--  NULL = le comportement actuel (encre noire #111). On ne remplit
--  donc rien : une org qui ne choisit pas de couleur ne voit aucun
--  changement.
-- ═══════════════════════════════════════════════════════════════

alter table public.company_settings
  add column if not exists brand_color text;

-- Un hex à 6 chiffres, ou rien. La valeur part directement dans du CSS
-- côté page publique : une chaîne libre y serait une injection.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_settings'::regclass
      and conname = 'company_settings_brand_color_hex'
  ) then
    alter table public.company_settings
      add constraint company_settings_brand_color_hex
      check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

comment on column public.company_settings.brand_color is
  'Couleur d''accent de l''entreprise (#RRGGBB) sur les documents client. NULL = encre noire par défaut.';

-- Les colonnes de company_settings sont accordées une à une : sans ce
-- GRANT, l''enregistrement échoue avec « permission denied » que
-- supabase-js n''élève jamais en exception (le réglage se perdrait en
-- silence, exactement comme billing_mode sur jobs).
grant select (brand_color) on public.company_settings to authenticated;
grant update (brand_color) on public.company_settings to authenticated;
grant insert (brand_color) on public.company_settings to authenticated;
