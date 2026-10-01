-- Ménage des champs personnalisés pré-faits (demande de Rafba, 2026-09-30 : « y'en a ben trop »).
--
-- Chaque entreprise recevait 41 champs d'office (31 de base + 10 dépenses) ; aucune n'en a rempli
-- un seul (0 valeur en prod). On garde 12 champs utiles à une entreprise de services :
--   Client   : Courriel de facturation, Référé par, Code d'accès, Instructions d'accès
--   Job      : Instructions spéciales ; Dépenses : Carburant, Sous-traitance, Autres dépenses
--   Devis    : Motif de refus
--   Propriété: Superficie (pi²), Nombre d'étages
-- Retirés : les 29 autres (dont « Téléphone secondaire », doublon du champ standard « Autres
-- numéros de téléphone », et « Matériaux », doublon de la liste des matériaux du job que la
-- rentabilité compte déjà).
--
--   · cf_champs_base() et cf_depenses_champs_base() : catalogues réduits → une NOUVELLE entreprise
--     ne reçoit que les 12 champs ;
--   · entreprises existantes : les champs retirés sont ARCHIVÉS (jamais supprimés), seulement s'ils
--     sont d'origine (created_by null) et SANS aucune valeur. Une clé archivée n'est jamais recréée
--     par cf_assurer_* : ils ne reviennent pas. « Gérer les champs » peut les réactiver.
-- Les dossiers (sections des formulaires) ne changent pas : chacun porte des champs standard.
begin;

create or replace function public.cf_champs_base()
 returns table (objet public.cf_object_type, dossier text, cle text, fr text, en text,
                type public.cf_field_type, config jsonb, options jsonb, "position" integer)
 language sql
 immutable
 set search_path to ''
as $function$
  select o::public.cf_object_type, d, c, f, e, t::public.cf_field_type, cfg::jsonb, opt::jsonb, p from (values
    -- Client › Coordonnées
    ('client', 'coordonnees', 'courriel_facturation', 'Courriel de facturation', 'Billing email', 'email', '{"masque_creation":true}', null, 0),
    -- Client › Informations du lead
    ('client', 'lead', 'refere_par', 'Référé par', 'Referred by', 'single_line', '{}', null, 0),
    -- Client › Adresse de la propriété
    ('client', 'adresse', 'code_acces', 'Code d''accès', 'Access code', 'single_line', '{}', null, 0),
    ('client', 'adresse', 'instructions_acces', 'Instructions d''accès', 'Access instructions', 'multi_line', '{"masque_creation":true}', null, 1),
    -- Job › Notes
    ('job', 'notes', 'instructions_speciales', 'Instructions spéciales', 'Special instructions', 'multi_line', '{}', null, 0),
    -- Devis › Détails du devis
    ('quote', 'details', 'motif_refus', 'Motif de refus', 'Reason declined', 'dropdown_single', '{"masque_creation":true}',
       '[{"fr":"Prix","en":"Price","color":"#dc2626"},{"fr":"Délai","en":"Timing","color":"#d97706"},{"fr":"Concurrent","en":"Competitor","color":"#7c3aed"},{"fr":"Projet annulé","en":"Project cancelled","color":"#94a3b8"},{"fr":"Autre","en":"Other"}]', 0),
    -- Propriété
    ('property', 'propriete', 'superficie_pi2', 'Superficie (pi²)', 'Area (sq ft)', 'number', '{"decimals":0,"min":0,"max":10000000}', null, 0),
    ('property', 'propriete', 'nb_etages', 'Nombre d''étages', 'Number of floors', 'number', '{"decimals":0,"min":1,"max":200}', null, 1)
  ) as s(o, d, c, f, e, t, cfg, opt, p);
$function$;

create or replace function public.cf_depenses_champs_base()
 returns table (cle text, fr text, en text, "position" integer)
 language sql
 immutable
 set search_path to ''
as $function$
  select c, f, e, p from (values
    ('depense_carburant',     'Carburant',       'Fuel',           0),
    ('depense_sous_traitance','Sous-traitance',  'Subcontracting', 1),
    ('depense_autres',        'Autres dépenses', 'Other expenses', 2)
  ) as s(c, f, e, p);
$function$;

-- Entreprises existantes : archiver les champs retirés (d'origine, sans valeur).
update public.custom_fields f
   set archived_at = now()
  from (values
    ('client', 'langue_communication'), ('client', 'contact_prefere'), ('client', 'disponibilites'),
    ('client', 'telephone_secondaire'), ('client', 'budget_estime'), ('client', 'date_souhaitee'),
    ('client', 'type_batiment'), ('client', 'stationnement'), ('client', 'animaux'),
    ('deal', 'urgence'), ('deal', 'concurrent'),
    ('job', 'priorite'), ('job', 'duree_estimee_h'), ('job', 'plage_arrivee'), ('job', 'nb_techniciens'),
    ('job', 'numero_bon_commande'), ('job', 'lien_photos'), ('job', 'photo_travaux'), ('job', 'inspection_finale'),
    ('quote', 'date_evaluation'), ('quote', 'numero_bon_commande'),
    ('invoice', 'numero_bon_commande'),
    ('property', 'annee_construction'),
    ('job', 'depense_materiaux'), ('job', 'depense_consommables'), ('job', 'depense_location'), ('job', 'depense_outils'),
    ('job', 'depense_deplacement'), ('job', 'depense_elimination'), ('job', 'depense_permis')
  ) as r(objet, cle)
 where f.object_type::text = r.objet
   and f.key = r.cle
   and f.archived_at is null
   and f.created_by is null
   and not exists (select 1 from public.custom_field_values v where v.field_id = f.id);

commit;
