-- Champ personnalisé client « noreview », posé d'office dans chaque entreprise (2026-09-30).
--
-- Nouveau workflow Avis clients : la demande d'avis part à la fin de CHAQUE job, vers TOUS les
-- clients, et mène tout le monde au choix Google / Facebook (fin du filtrage par étoiles, interdit).
-- Seule exception : le client dont la case « noreview » est cochée ne reçoit ni la demande ni le
-- rappel d'avis (server/lib/reviewOptOut.ts lit custom_field_values.value_boolean).
--
--   · cf_champs_base() : catalogue du ménage (20261005400000) + noreview (Client › Coordonnées) ;
--     src/lib/champs/base.ts en est la recopie (tests/champs-de-base.test.ts) ;
--   · nouvelles entreprises : trigger existant trg_orgs_dossiers_systeme → cf_assurer_champs_base ;
--   · entreprises existantes : cf_assurer_champs_base sur toutes, en fin de fichier (idempotent :
--     une clé déjà prise, même archivée, n'est jamais recréée — seul noreview est ajouté).
-- Le code est tolérant : sans ce champ, personne n'est exclu.
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
    ('client', 'coordonnees', 'noreview', 'Aucune demande d''avis (noreview)', 'No review request (noreview)', 'checkbox', '{}', null, 1),
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

-- Toutes les entreprises existantes.
select public.cf_assurer_champs_base(o.id) from public.orgs o;

commit;
