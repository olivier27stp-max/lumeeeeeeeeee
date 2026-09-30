-- Champs personnalisés DE BASE, rangés dans les dossiers système (2026-09-30).
--
-- Chaque entreprise reçoit un jeu de custom keys utiles à toute entreprise de
-- services, rangés dans la section du formulaire qui leur correspond
-- (Client › Coordonnées, Job › Visites…). Les 12 types de champ y sont
-- représentés. Les champs par MÉTIER (src/lib/champs/modeles.ts) restent un
-- extra : une clé déjà prise n'est jamais recréée ni modifiée.
--
--   · cf_champs_base() : le catalogue — recopié de src/lib/champs/base.ts
--     (CHAMPS_DE_BASE ; tests/champs-de-base.test.ts compare les deux) ;
--   · cf_assurer_champs_base(org) : crée ce qui manque, idempotent ; libellés et
--     options dans la langue de l'entreprise ; un champ supprimé (archivé) par
--     l'entreprise n'est pas recréé (sa clé existe toujours) ;
--   · chaque NOUVELLE entreprise (trigger existant trg_orgs_dossiers_systeme) ;
--   · toutes les entreprises existantes, en fin de fichier.
--
-- Même clé + même type sur devis / job / facture (numero_bon_commande) : la
-- valeur suit toute seule (cf_copier_valeurs, triggers cf_devis_job_lie et
-- cf_facture_job_liee).
-- config : masque_creation = retiré de la fenêtre de création (reste sur la
-- fiche, « Gérer les champs » le remet) ; show_on_documents = imprimé sur le
-- devis / la facture remis au client.

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
    ('client', 'coordonnees', 'langue_communication', 'Langue de communication', 'Communication language', 'dropdown_single', '{}',
       '[{"fr":"Français","en":"French","color":"#2563eb"},{"fr":"Anglais","en":"English","color":"#dc2626"}]', 0),
    ('client', 'coordonnees', 'contact_prefere', 'Moyen de contact préféré', 'Preferred contact method', 'dropdown_single', '{}',
       '[{"fr":"Texto","en":"Text","color":"#16a34a"},{"fr":"Appel","en":"Call","color":"#2563eb"},{"fr":"Courriel","en":"Email","color":"#7c3aed"}]', 1),
    ('client', 'coordonnees', 'disponibilites', 'Meilleurs moments pour joindre', 'Best times to reach', 'dropdown_multi', '{"masque_creation":true}',
       '[{"fr":"Matin","en":"Morning"},{"fr":"Après-midi","en":"Afternoon"},{"fr":"Soir","en":"Evening"},{"fr":"Fin de semaine","en":"Weekend"}]', 2),
    ('client', 'coordonnees', 'telephone_secondaire', 'Téléphone secondaire', 'Secondary phone', 'phone', '{"masque_creation":true}', null, 3),
    ('client', 'coordonnees', 'courriel_facturation', 'Courriel de facturation', 'Billing email', 'email', '{"masque_creation":true}', null, 4),
    -- Client › Informations du lead
    ('client', 'lead', 'refere_par', 'Référé par', 'Referred by', 'single_line', '{}', null, 0),
    ('client', 'lead', 'budget_estime', 'Budget estimé', 'Estimated budget', 'monetary', '{"currency":"CAD"}', null, 1),
    ('client', 'lead', 'date_souhaitee', 'Date souhaitée des travaux', 'Desired work date', 'date', '{}', null, 2),
    -- Client › Adresse de la propriété
    ('client', 'adresse', 'code_acces', 'Code d''accès', 'Access code', 'single_line', '{}', null, 0),
    ('client', 'adresse', 'type_batiment', 'Type de bâtiment', 'Building type', 'dropdown_single', '{}',
       '[{"fr":"Résidentiel","en":"Residential","color":"#2563eb"},{"fr":"Commercial","en":"Commercial","color":"#d97706"},{"fr":"Multilogement","en":"Multi-unit","color":"#7c3aed"}]', 1),
    ('client', 'adresse', 'stationnement', 'Stationnement', 'Parking', 'dropdown_single', '{"masque_creation":true}',
       '[{"fr":"Dans l''entrée","en":"Driveway","color":"#16a34a"},{"fr":"Dans la rue","en":"Street","color":"#2563eb"},{"fr":"Payant","en":"Paid","color":"#d97706"},{"fr":"Aucun","en":"None","color":"#dc2626"}]', 2),
    ('client', 'adresse', 'animaux', 'Animaux sur place', 'Pets on site', 'dropdown_multi', '{"masque_creation":true}',
       '[{"fr":"Chien","en":"Dog","color":"#d97706"},{"fr":"Chat","en":"Cat","color":"#7c3aed"},{"fr":"Autre","en":"Other"}]', 3),
    ('client', 'adresse', 'instructions_acces', 'Instructions d''accès', 'Access instructions', 'multi_line', '{"masque_creation":true}', null, 4),
    -- Deal › Prévisions
    ('deal', 'previsions', 'urgence', 'Urgence', 'Urgency', 'dropdown_single', '{}',
       '[{"fr":"Basse","en":"Low","color":"#94a3b8"},{"fr":"Moyenne","en":"Medium","color":"#d97706"},{"fr":"Haute","en":"High","color":"#dc2626"}]', 0),
    ('deal', 'previsions', 'concurrent', 'Concurrent en lice', 'Competitor', 'single_line', '{"masque_creation":true}', null, 1),
    -- Job › Détails
    ('job', 'details', 'priorite', 'Priorité', 'Priority', 'dropdown_single', '{}',
       '[{"fr":"Normale","en":"Normal","color":"#94a3b8"},{"fr":"Haute","en":"High","color":"#d97706"},{"fr":"Urgente","en":"Urgent","color":"#dc2626"}]', 0),
    -- Job › Visites
    ('job', 'visites', 'duree_estimee_h', 'Durée estimée (h)', 'Estimated duration (h)', 'number', '{"decimals":1,"min":0,"max":1000}', null, 0),
    ('job', 'visites', 'plage_arrivee', 'Plage d''arrivée', 'Arrival window', 'dropdown_single', '{}',
       '[{"fr":"Matin (8 h – 12 h)","en":"Morning (8 am – 12 pm)"},{"fr":"Après-midi (12 h – 17 h)","en":"Afternoon (12 – 5 pm)"},{"fr":"Toute la journée","en":"All day"}]', 1),
    -- Job › Assignation
    ('job', 'assignation', 'nb_techniciens', 'Techniciens requis', 'Technicians needed', 'number', '{"decimals":0,"min":1,"max":50}', null, 0),
    -- Job › Facturation et paiement
    ('job', 'facturation', 'numero_bon_commande', 'N° de bon de commande', 'Purchase order no.', 'single_line', '{"masque_creation":true}', null, 0),
    -- Job › Notes
    ('job', 'notes', 'instructions_speciales', 'Instructions spéciales', 'Special instructions', 'multi_line', '{}', null, 0),
    ('job', 'notes', 'lien_photos', 'Lien vers les photos', 'Photos link', 'url', '{"masque_creation":true}', null, 1),
    ('job', 'notes', 'photo_travaux', 'Photo / document des travaux', 'Work photo / document', 'file', '{"masque_creation":true}', null, 2),
    ('job', 'notes', 'inspection_finale', 'Inspection finale faite', 'Final inspection done', 'checkbox', '{"masque_creation":true}', null, 3),
    -- Devis › Détails du devis
    ('quote', 'details', 'date_evaluation', 'Date de la visite d''évaluation', 'Assessment visit date', 'date', '{}', null, 0),
    ('quote', 'details', 'numero_bon_commande', 'N° de bon de commande', 'Purchase order no.', 'single_line', '{"masque_creation":true,"show_on_documents":true}', null, 1),
    ('quote', 'details', 'motif_refus', 'Motif de refus', 'Reason declined', 'dropdown_single', '{"masque_creation":true}',
       '[{"fr":"Prix","en":"Price","color":"#dc2626"},{"fr":"Délai","en":"Timing","color":"#d97706"},{"fr":"Concurrent","en":"Competitor","color":"#7c3aed"},{"fr":"Projet annulé","en":"Project cancelled","color":"#94a3b8"},{"fr":"Autre","en":"Other"}]', 2),
    -- Facture › Détails
    ('invoice', 'details', 'numero_bon_commande', 'N° de bon de commande', 'Purchase order no.', 'single_line', '{"show_on_documents":true}', null, 0),
    -- Propriété
    ('property', 'propriete', 'superficie_pi2', 'Superficie (pi²)', 'Area (sq ft)', 'number', '{"decimals":0,"min":0,"max":10000000}', null, 0),
    ('property', 'propriete', 'nb_etages', 'Nombre d''étages', 'Number of floors', 'number', '{"decimals":0,"min":1,"max":200}', null, 1),
    ('property', 'propriete', 'annee_construction', 'Année de construction', 'Year built', 'number', '{"decimals":0,"min":1600,"max":2100}', null, 2)
  ) as s(o, d, c, f, e, t, cfg, opt, p);
$function$;

revoke all on function public.cf_champs_base() from public, anon;
grant execute on function public.cf_champs_base() to authenticated, service_role;

-- ── Créer ce qui manque pour UNE entreprise (idempotent) ─────────────────────
create or replace function public.cf_assurer_champs_base(p_org uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_en boolean;
  b record;
  v_champ uuid;
  v_dossier uuid;
begin
  select coalesce(cs.default_language, 'fr') = 'en' into v_en
    from public.company_settings cs where cs.org_id = p_org limit 1;
  v_en := coalesce(v_en, false);

  -- Les dossiers système d'abord (sections du formulaire) : les champs s'y rangent.
  perform public.cf_assurer_dossiers_systeme(p_org);

  for b in select * from public.cf_champs_base() loop
    -- Clé déjà prise (même archivée, même par un champ de métier) : jamais recréée ni modifiée.
    continue when exists (select 1 from public.custom_fields f
                           where f.org_id = p_org and f.object_type = b.objet and f.key = b.cle);
    select id into v_dossier from public.custom_field_folders
     where org_id = p_org and object_type = b.objet and cle_systeme = b.dossier;

    insert into public.custom_fields (org_id, object_type, folder_id, key, label, field_type, config, "position", created_by)
    values (p_org, b.objet, v_dossier, b.cle, case when v_en then b.en else b.fr end, b.type, b.config, b."position", null)
    returning id into v_champ;

    if b.options is not null then
      insert into public.custom_field_options (org_id, field_id, label, color, "position")
      select p_org, v_champ, case when v_en then o ->> 'en' else o ->> 'fr' end, o ->> 'color', (i - 1)::integer
        from jsonb_array_elements(b.options) with ordinality as x(o, i);
    end if;
  end loop;
end;
$function$;

revoke all on function public.cf_assurer_champs_base(uuid) from public, anon, authenticated;
grant execute on function public.cf_assurer_champs_base(uuid) to service_role;

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
  perform public.cf_assurer_champs_base(new.id);
  return new;
end;
$function$;

revoke all on function public.cf_orgs_dossiers_systeme() from public, anon, authenticated;
grant execute on function public.cf_orgs_dossiers_systeme() to service_role;

-- ── Toutes les entreprises existantes ────────────────────────────────────────
select public.cf_assurer_champs_base(o.id) from public.orgs o;

commit;
