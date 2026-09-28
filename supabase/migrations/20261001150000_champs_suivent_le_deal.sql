-- ═══════════════════════════════════════════════════════════════
-- Les valeurs des champs personnalisés suivent le deal
-- (étape 5 du plan étiquettes + champs, 2026-09-28 — décisions D5 et D6)
--
--   · client → deal : à la création du deal (ou quand on lui donne un
--     client), quel que soit le chemin — bouton « Nouveau deal »,
--     formulaire public, porte-à-porte, Lumi, conversion de prospect ;
--   · deal → devis : quand un devis est rattaché au deal (« Faire un devis »
--     de la fiche, deal créé depuis un devis).
--   · deal → job existait déjà (deals_cf_copier_vers_job).
--
-- Même règle partout, celle de cf_copier_valeurs : même CLÉ et même TYPE de
-- champ, et seulement si le champ cible est VIDE — jamais d'écrasement. Une
-- valeur tapée ensuite par le vendeur remplace la valeur copiée (écriture
-- sans version = dernier mot à l'humain).
--
-- Un déclencheur en base, pas une route : un deal naît par cinq chemins
-- (leçon de deal → job). Une copie ratée n'empêche jamais d'enregistrer le
-- deal (warning, comme cf_deal_job_lie).
--
-- ROLLBACK :
--   drop trigger if exists deals_cf_suivre on public.deals;
--   drop function if exists public.cf_deal_suivre();
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.cf_deal_suivre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- client → deal (d'abord : le devis reçoit ensuite ce que le deal a hérité)
  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id) then
    begin
      perform public.cf_copier_valeurs(new.org_id, 'client', new.client_id, 'deal', new.id);
    exception when others then
      raise warning 'cf_copier_valeurs(client % → deal %) : %', new.client_id, new.id, sqlerrm;
    end;
  end if;

  -- deal → devis
  if new.quote_id is not null
     and (tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id) then
    begin
      perform public.cf_copier_valeurs(new.org_id, 'deal', new.id, 'quote', new.quote_id);
    exception when others then
      raise warning 'cf_copier_valeurs(deal % → devis %) : %', new.id, new.quote_id, sqlerrm;
    end;
  end if;
  return null;
end $$;

revoke all on function public.cf_deal_suivre() from public, anon, authenticated;

drop trigger if exists deals_cf_suivre on public.deals;
create trigger deals_cf_suivre after insert or update of client_id, quote_id on public.deals
  for each row execute function public.cf_deal_suivre();

commit;
