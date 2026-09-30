-- Dossier système « Dépenses » sur les jobs (mission rentabilité, 2026-09-30).
-- ⚠ NON APPLIQUÉE : en attente de l'approbation de Rafba (règle de la mission).
--
-- Tout champ de type MONTANT rangé dans ce dossier est compté automatiquement
-- comme dépense du job par l'action analyze_profitability
-- (server/lib/rentabilite) ; un champ d'un autre type n'est pas compté et
-- l'écran le dit.
--
--   · clé stable custom_field_folders.cle_systeme = 'depenses' (jamais le nom) ;
--   · RENOMMABLE (contrairement aux sections du formulaire), jamais supprimable ;
--   · 10 champs de base, type montant, avant taxes, libellés dans la langue de
--     l'entreprise (company_settings.default_language) ;
--   · retirés de la fenêtre « Nouveau job » (config.masque_creation) : une dépense
--     se saisit après le travail, sur la fiche ; « Gérer les champs » les y remet ;
--   · chaque NOUVELLE entreprise le reçoit (trigger existant trg_orgs_dossiers_systeme) ;
--   · les entreprises EXISTANTES : migration séparée 20261003470001 (backfill),
--     elle aussi soumise à approbation.
--
-- Ce n'est PAS une section du formulaire de création : cf_sections_systeme /
-- SECTIONS_SYSTEME (et leur test de parité) ne changent pas. Côté écran, le nom
-- traduit vient de DOSSIERS_SYSTEME_LIBRES (src/lib/champs/standard.ts).
--
-- Idempotent : un champ de base supprimé (archivé) par l'entreprise n'est pas
-- recréé — sa clé existe toujours. Un dossier perso déjà nommé « Dépenses » ou
-- « Expenses » devient le dossier système (l'index d'unicité des noms
-- empêcherait sinon d'en créer un second).

begin;

-- ── Les champs de base (fr, en), dans l'ordre ────────────────────────────────
create or replace function public.cf_depenses_champs_base()
 returns table (cle text, fr text, en text, "position" integer)
 language sql
 immutable
 set search_path to ''
as $function$
  select c, f, e, p from (values
    ('depense_carburant',     'Carburant',                               'Fuel',                      0),
    ('depense_materiaux',     'Matériaux',                               'Materials',                 1),
    ('depense_consommables',  'Produits et consommables',                'Supplies & consumables',    2),
    ('depense_location',      'Location d''équipement',                  'Equipment rental',          3),
    ('depense_outils',        'Outils',                                  'Tools',                     4),
    ('depense_sous_traitance','Sous-traitance',                          'Subcontracting',            5),
    ('depense_deplacement',   'Déplacement (stationnement, péages)',     'Travel (parking, tolls)',   6),
    ('depense_elimination',   'Élimination des déchets',                 'Disposal fees',             7),
    ('depense_permis',        'Permis et frais',                         'Permits & fees',            8),
    ('depense_autres',        'Autres dépenses',                         'Other expenses',            9)
  ) as s(c, f, e, p);
$function$;

revoke all on function public.cf_depenses_champs_base() from public, anon;
grant execute on function public.cf_depenses_champs_base() to authenticated, service_role;

-- ── Créer ce qui manque pour UNE entreprise (idempotent) ─────────────────────
create or replace function public.cf_assurer_dossier_depenses(p_org uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_en boolean;
  v_dossier uuid;
begin
  select coalesce(cs.default_language, 'fr') = 'en' into v_en
    from public.company_settings cs where cs.org_id = p_org;
  v_en := coalesce(v_en, false);

  -- Un dossier perso « Dépenses » / « Expenses » devient le dossier système.
  update public.custom_field_folders f
     set cle_systeme = 'depenses'
   where f.org_id = p_org and f.object_type = 'job' and f.cle_systeme is null
     and lower(btrim(f.name)) in ('dépenses', 'depenses', 'expenses')
     and not exists (select 1 from public.custom_field_folders g
                      where g.org_id = p_org and g.object_type = 'job' and g.cle_systeme = 'depenses');

  insert into public.custom_field_folders (org_id, object_type, name, "position", cle_systeme, created_by)
  values (p_org, 'job', case when v_en then 'Expenses' else 'Dépenses' end, 100, 'depenses', null)
  on conflict (org_id, object_type, cle_systeme) where cle_systeme is not null do nothing;

  select id into v_dossier from public.custom_field_folders
   where org_id = p_org and object_type = 'job' and cle_systeme = 'depenses';

  -- Les 10 champs de base, sauf ceux dont la clé existe déjà (même archivés).
  insert into public.custom_fields (org_id, object_type, folder_id, key, label, field_type, config, "position", created_by)
  select p_org, 'job', v_dossier, b.cle, case when v_en then b.en else b.fr end, 'monetary',
         jsonb_build_object('currency', 'CAD', 'masque_creation', true), b."position", null
    from public.cf_depenses_champs_base() b
   where not exists (select 1 from public.custom_fields f
                      where f.org_id = p_org and f.object_type = 'job' and f.key = b.cle);
end;
$function$;

revoke all on function public.cf_assurer_dossier_depenses(uuid) from public, anon, authenticated;
grant execute on function public.cf_assurer_dossier_depenses(uuid) to service_role;

-- ── Chaque nouvelle entreprise (trigger existant, corps étendu) ──────────────
create or replace function public.cf_orgs_dossiers_systeme()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform public.cf_assurer_dossiers_systeme(new.id);
  perform public.cf_assurer_dossier_depenses(new.id);
  return new;
end;
$function$;

revoke all on function public.cf_orgs_dossiers_systeme() from public, anon, authenticated;
grant execute on function public.cf_orgs_dossiers_systeme() to service_role;

-- ── Garde : le dossier Dépenses se RENOMME, ne se supprime pas ───────────────
create or replace function public.cf_garde_dossier_systeme()
 returns trigger
 language plpgsql
 set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    -- Effacement d'une entreprise : la cascade emporte ses dossiers, système compris.
    if old.cle_systeme is not null and exists (select 1 from public.orgs o where o.id = old.org_id) then
      raise exception 'Un dossier système ne se supprime pas : il correspond à une section du formulaire.'
        using errcode = '22023';
    end if;
    return old;
  end if;
  if old.cle_systeme is not null
     and (new.cle_systeme is distinct from old.cle_systeme or new.object_type is distinct from old.object_type) then
    raise exception 'Un dossier système garde sa clé et son objet.' using errcode = '22023';
  end if;
  -- Les sections du formulaire gardent leur nom ; le dossier Dépenses, lui, se renomme.
  if old.cle_systeme is not null and old.cle_systeme <> 'depenses' and new.name is distinct from old.name then
    raise exception 'Un dossier système ne se renomme pas : il correspond à une section du formulaire.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

commit;
