-- Champs personnalisés — PR 1 de la refonte « comme GoHighLevel » (plan validé
-- par Rafba le 2026-09-25) : sécurité et nettoyage, aucun changement visible.
--
-- 1. cf_filtrer_brut était SECURITY DEFINER et exécutable par tout membre :
--    appelée directement, elle renvoyait les ids des fiches correspondant à un
--    filtre, y compris celles que la RLS cache à la personne (portée « moi
--    seulement », 20260927230200). Elle s'exécute maintenant avec les droits
--    de l'appelant : la RLS de custom_field_values et des fiches s'applique.
--    cf_filtrer (déjà INVOKER) l'appelle toujours ; le serveur (service_role)
--    n'est pas concerné.
-- 2. Le drapeau custom_fields_v2 est retiré : les champs sont offerts à toutes
--    les entreprises. Le déclencheur qui l'allumait à la création d'une
--    entreprise n'a plus d'objet. Les lignes org_features existantes restent
--    (inertes).
-- 3. Restes de l'ancien registre (custom_columns, retiré le 2026-09-26) :
--    legacy_column_id (trace de reprise, jamais une FK) et les deux copies
--    d'archive (2 définitions, 0 valeur — reprises dans custom_fields).

alter function public.cf_filtrer_brut(uuid, public.cf_object_type, jsonb, uuid[]) security invoker;

drop trigger if exists trg_orgs_activer_champs_perso on public.orgs;
drop function if exists public.org_activer_champs_perso();

alter table public.custom_fields drop column if exists legacy_column_id;

drop table if exists archive.custom_column_values_20260926;
drop table if exists archive.custom_columns_20260926;
