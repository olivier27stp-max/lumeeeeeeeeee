-- ───────────────────────────────────────────────────────────────
-- Champs personnalisés v2 : activés pour toutes les entreprises.
--
-- Jusqu'ici derrière le drapeau `custom_fields_v2` (org_features), activé à
-- la main pour Coquin lavage seulement. La fonction est finie et vérifiée
-- (#541 → #569) ; les champs du métier sont déjà posés à l'inscription
-- (#558) mais restaient invisibles sans le drapeau.
--   1. Toute entreprise existante non archivée (les « zz-… » sont des bureaux
--      de test archivés) : drapeau allumé. Un drapeau déjà présent (même
--      éteint à dessein) n'est PAS écrasé.
--   2. Toute nouvelle entreprise : drapeau allumé à sa création, même motif
--      que auto_create_comm_settings. Ne peut jamais bloquer la création.
-- Coupable par entreprise depuis le Creator Space, comme avant.
-- ───────────────────────────────────────────────────────────────

insert into public.org_features (org_id, feature, enabled)
select o.id, 'custom_fields_v2', true
  from public.orgs o
 where o.deleted_at is null
   and o.name not like 'zz-%'
on conflict (org_id, feature) do nothing;

create or replace function public.org_activer_champs_perso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.org_features (org_id, feature, enabled)
    values (new.id, 'custom_fields_v2', true)
    on conflict (org_id, feature) do nothing;
  exception when others then
    -- Jamais au prix de la création d'une entreprise.
    raise warning 'org_activer_champs_perso(%) : %', new.id, sqlerrm;
  end;
  return new;
end $$;

revoke all on function public.org_activer_champs_perso() from public, anon, authenticated;

drop trigger if exists trg_orgs_activer_champs_perso on public.orgs;
create trigger trg_orgs_activer_champs_perso after insert on public.orgs
  for each row execute function public.org_activer_champs_perso();
