-- ═══════════════════════════════════════════════════════════════
-- Réglages → Étiquettes (étape 2 du plan étiquettes + champs, 2026-09-28)
--
-- Les étiquettes restent du TEXTE posé sur les clients (`client_tags`). Le
-- catalogue `tags` (nom + couleur par entreprise, jusqu'ici vide et inutilisé)
-- porte la COULEUR, retrouvée par le nom (insensible à la casse).
--
-- 1. Écrire le catalogue exige « Réglages » (décision D3) : avant, n'importe
--    quel membre pouvait l'écrire.
-- 2. Trois fonctions, appelées par le serveur seulement (service_role), après
--    vérification de la permission :
--      · etiquettes_de_l_org     — liste : nom, couleur, nb de clients ;
--      · etiquette_renommer      — renomme partout ; si le nouveau nom existe
--                                  déjà, FUSIONNE (aucun doublon créé) ;
--      · etiquette_supprimer     — retire l'étiquette de tous les clients de
--                                  l'entreprise et du catalogue.
--    Une seule transaction chacune. Renommer ou supprimer n'est PAS « retirer
--    une étiquette » client par client : aucun déclencheur ne part (sinon
--    supprimer une étiquette posée sur 500 clients lancerait 500 parcours).
--
-- ROLLBACK :
--   drop function if exists public.etiquettes_de_l_org(uuid);
--   drop function if exists public.etiquette_renommer(uuid, text, text);
--   drop function if exists public.etiquette_supprimer(uuid, text);
--   recréer tags_org_insert/update/delete avec has_org_membership (baseline).
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. Catalogue : écriture réservée à « Réglages » ──────────────
drop policy if exists tags_org_insert on public.tags;
drop policy if exists tags_org_update on public.tags;
drop policy if exists tags_org_delete on public.tags;
create policy tags_org_insert on public.tags for insert to authenticated
  with check (public.member_has_permission((select auth.uid()), org_id, 'settings.update'));
create policy tags_org_update on public.tags for update to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'settings.update'))
  with check (public.member_has_permission((select auth.uid()), org_id, 'settings.update'));
create policy tags_org_delete on public.tags for delete to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'settings.update'));

-- ── 2. Liste ─────────────────────────────────────────────────────
create or replace function public.etiquettes_de_l_org(p_org uuid)
returns table (nom text, couleur text, nb_clients bigint, catalogue boolean)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with posees as (
    select ct.tag as nom, count(distinct ct.client_id) as nb
      from public.client_tags ct
      join public.clients c on c.id = ct.client_id
     where c.org_id = p_org and c.deleted_at is null
     group by ct.tag
  )
  select coalesce(t.name, p.nom) as nom,
         t.color_hex as couleur,
         coalesce(p.nb, 0) as nb_clients,
         t.id is not null as catalogue
    from posees p
    full join public.tags t on t.org_id = p_org and lower(t.name) = lower(p.nom)
   where t.id is null or t.org_id = p_org
   order by lower(coalesce(t.name, p.nom));
$$;

-- ── 3. Renommer (et fusionner) ───────────────────────────────────
create or replace function public.etiquette_renommer(p_org uuid, p_ancien text, p_nouveau text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_nouveau text := btrim(p_nouveau);
begin
  if v_nouveau is null or v_nouveau = '' then
    raise exception 'Le nouveau nom est vide.' using errcode = '22023';
  end if;
  if length(v_nouveau) > 60 then
    raise exception 'Une étiquette fait 60 caractères au plus.' using errcode = '22023';
  end if;

  if p_ancien <> v_nouveau then
    -- Les clients qui ont DÉJÀ le nouveau nom perdent l'ancien (fusion) ;
    -- les autres voient l'ancien renommé. Jamais de doublon.
    delete from public.client_tags ct
     using public.clients c
     where c.id = ct.client_id and c.org_id = p_org and ct.tag = p_ancien
       and exists (select 1 from public.client_tags x where x.client_id = ct.client_id and x.tag = v_nouveau);
    update public.client_tags ct set tag = v_nouveau
      from public.clients c
     where c.id = ct.client_id and c.org_id = p_org and ct.tag = p_ancien;
  end if;

  -- Catalogue : si le nouveau nom y est déjà, il garde SA couleur et l'ancien
  -- disparaît ; sinon l'entrée de l'ancien (et sa couleur) prend le nouveau nom.
  if exists (select 1 from public.tags where org_id = p_org and lower(name) = lower(v_nouveau)
               and lower(name) <> lower(p_ancien)) then
    delete from public.tags where org_id = p_org and lower(name) = lower(p_ancien);
  else
    update public.tags set name = v_nouveau where org_id = p_org and lower(name) = lower(p_ancien);
  end if;

  -- Combien de clients portent maintenant l'étiquette.
  return (select count(distinct ct.client_id) from public.client_tags ct
            join public.clients c on c.id = ct.client_id
           where c.org_id = p_org and ct.tag = v_nouveau);
end;
$$;

-- ── 4. Supprimer ─────────────────────────────────────────────────
create or replace function public.etiquette_supprimer(p_org uuid, p_nom text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_retirees integer;
begin
  delete from public.client_tags ct
   using public.clients c
   where c.id = ct.client_id and c.org_id = p_org and ct.tag = p_nom;
  get diagnostics v_retirees = row_count;
  delete from public.tags where org_id = p_org and lower(name) = lower(p_nom);
  return v_retirees;
end;
$$;

-- Appelées par le serveur seulement, APRÈS sa vérification de permission.
revoke all on function public.etiquettes_de_l_org(uuid) from public, anon, authenticated;
revoke all on function public.etiquette_renommer(uuid, text, text) from public, anon, authenticated;
revoke all on function public.etiquette_supprimer(uuid, text) from public, anon, authenticated;
grant execute on function public.etiquettes_de_l_org(uuid) to service_role;
grant execute on function public.etiquette_renommer(uuid, text, text) to service_role;
grant execute on function public.etiquette_supprimer(uuid, text) to service_role;

commit;
