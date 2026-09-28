-- Champs personnalisés — dossiers SYSTÈME (mission GHL, phase 2, 2026-09-28).
--
-- Chaque section d'un formulaire de création (audit du 2026-09-28) devient un
-- dossier système de son objet, dans le même ordre : « Clients › Coordonnées »,
-- « Jobs › Facturation et paiement »… Un champ personnalisé rangé dans un dossier
-- système s'affiche à la fin de cette section du formulaire (phase 4).
--
--   · custom_field_folders.cle_systeme : clé stable de la section (null = dossier perso) ;
--   · cf_sections_systeme() : la liste, recopiée de src/lib/champs/standard.ts
--     (SECTIONS_SYSTEME — tests/champs-perso-parite compare les deux) ;
--   · cf_assurer_dossiers_systeme(org) : crée ce qui manque, idempotent ; un
--     dossier perso qui porte déjà le nom d'une section devient ce dossier système ;
--   · toutes les entreprises existantes + chaque nouvelle entreprise (trigger) ;
--   · un dossier système ne se supprime pas et ne se renomme pas (garde en base).
--
-- cf_cles_standard est redéfinie : les champs réellement présents dans les
-- formulaires (vendeur, dépôt, taxes…) deviennent des clés réservées. Vérifié en
-- prod avant d'écrire : aucun champ personnalisé n'utilise l'une de ces clés.

alter table public.custom_field_folders add column if not exists cle_systeme text;

do $$ begin
  alter table public.custom_field_folders
    add constraint custom_field_folders_cle_systeme_format check (cle_systeme is null or cle_systeme ~ '^[a-z_]{1,40}$');
exception when duplicate_object then null; end $$;

create unique index if not exists custom_field_folders_systeme_uniq
  on public.custom_field_folders (org_id, object_type, cle_systeme) where cle_systeme is not null;

-- ── Les sections des formulaires de référence ──────────────────────────────────
create or replace function public.cf_sections_systeme()
 returns table (object_type public.cf_object_type, cle text, nom text, "position" integer)
 language sql
 immutable
 set search_path to ''
as $function$
  select o::public.cf_object_type, c, n, p from (values
    ('client', 'coordonnees', 'Coordonnées', 0),
    ('client', 'lead', 'Informations du lead', 1),
    ('client', 'adresse', 'Adresse de la propriété', 2),
    ('deal', 'depart', 'Deal', 0),
    ('deal', 'contact', 'Contact', 1),
    ('deal', 'previsions', 'Prévisions', 2),
    ('job', 'details', 'Détails', 0),
    ('job', 'client', 'Client', 1),
    ('job', 'type', 'Type de job', 2),
    ('job', 'visites', 'Visites', 3),
    ('job', 'assignation', 'Assignation', 4),
    ('job', 'facturation', 'Facturation et paiement', 5),
    ('job', 'produits', 'Produits / Services', 6),
    ('job', 'contrat', 'Contrat', 7),
    ('job', 'notes', 'Notes', 8),
    ('quote', 'contact', 'Contact', 0),
    ('quote', 'details', 'Détails du devis', 1),
    ('quote', 'photos', 'Photos', 2),
    ('quote', 'introduction', 'Introduction', 3),
    ('quote', 'produits', 'Produit / Service', 4),
    ('quote', 'contrat', 'Contrat / Clause', 5),
    ('quote', 'message', 'Message au client', 6),
    ('quote', 'notes', 'Notes', 7),
    ('quote', 'resume', 'Résumé', 8),
    ('quote', 'acompte', 'Acompte et paiement', 9),
    ('invoice', 'client', 'Client', 0),
    ('invoice', 'details', 'Détails', 1),
    ('invoice', 'articles', 'Articles', 2),
    ('invoice', 'totaux', 'Totaux', 3),
    ('invoice', 'notes', 'Notes', 4),
    ('property', 'propriete', 'Propriété', 0)
  ) as s(o, c, n, p);
$function$;

revoke all on function public.cf_sections_systeme() from public, anon;
grant execute on function public.cf_sections_systeme() to authenticated, service_role;

-- ── Créer ce qui manque (idempotent) ───────────────────────────────────────────
create or replace function public.cf_assurer_dossiers_systeme(p_org uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- Un dossier perso qui porte déjà le nom d'une section en devient le dossier
  -- système (l'index d'unicité des noms empêcherait sinon d'en créer un).
  update public.custom_field_folders f
     set cle_systeme = s.cle, "position" = s."position"
    from public.cf_sections_systeme() s
   where f.org_id = p_org
     and f.object_type = s.object_type
     and f.cle_systeme is null
     and lower(btrim(f.name)) = lower(s.nom)
     and not exists (select 1 from public.custom_field_folders g
                      where g.org_id = p_org and g.object_type = s.object_type and g.cle_systeme = s.cle);

  insert into public.custom_field_folders (org_id, object_type, name, "position", cle_systeme, created_by)
  select p_org, s.object_type, s.nom, s."position", s.cle, null
    from public.cf_sections_systeme() s
  on conflict (org_id, object_type, cle_systeme) where cle_systeme is not null do nothing;
end;
$function$;

revoke all on function public.cf_assurer_dossiers_systeme(uuid) from public, anon, authenticated;
grant execute on function public.cf_assurer_dossiers_systeme(uuid) to service_role;

-- ── Chaque nouvelle entreprise ─────────────────────────────────────────────────
create or replace function public.cf_orgs_dossiers_systeme()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform public.cf_assurer_dossiers_systeme(new.id);
  return new;
end;
$function$;

revoke all on function public.cf_orgs_dossiers_systeme() from public, anon, authenticated;
grant execute on function public.cf_orgs_dossiers_systeme() to service_role;

drop trigger if exists trg_orgs_dossiers_systeme on public.orgs;
create trigger trg_orgs_dossiers_systeme after insert on public.orgs
  for each row execute function public.cf_orgs_dossiers_systeme();

-- ── Garde : ni supprimé, ni renommé, ni « détaché » ────────────────────────────
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
     and (new.name is distinct from old.name or new.cle_systeme is distinct from old.cle_systeme
          or new.object_type is distinct from old.object_type) then
    raise exception 'Un dossier système ne se renomme pas : il correspond à une section du formulaire.'
      using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_custom_field_folders_garde_systeme on public.custom_field_folders;
create trigger trg_custom_field_folders_garde_systeme
  before update or delete on public.custom_field_folders
  for each row execute function public.cf_garde_dossier_systeme();

-- ── Clés réservées = champs réels des formulaires (+ attributs déjà réservés) ──
create or replace function public.cf_cles_standard(p_object public.cf_object_type)
 returns text[]
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_object::text
    when 'client'  then array['first_name','last_name','client_number','company','display_as_company','phone','email','lead_source','address','taxes','billing_same_as_service','billing_address','name','city','province','postal_code','status','source','notes','created_at','updated_at']
    when 'deal'    then array['pipeline','client','first_name','last_name','email','phone','address','amount','expected_close_date','assigned_user','source','title','stage','probability','lost_reason','status','created_at','updated_at']
    when 'job'     then array['title','job_number','salesperson','sale_date','show_on_leaderboard','ask_for_review','client','property','job_type','visits','team','requires_invoicing','billing_split','deposit_required','deposit_type','deposit_value','require_payment_method','line_items','taxes','agreement','notes','status','address','scheduled_at','total','created_at','updated_at']
    when 'quote'   then array['client','quote_type','title','property','quote_number','salesperson','valid_days','photos','introduction','line_items','contract_disclaimer','client_message','notes','discount','tax','deposit_required','deposit_type','deposit_value','require_payment_method','status','total','valid_until','created_at','updated_at']
    when 'invoice' then array['client','subject','invoice_date','due_date','salesperson','line_items','discount','tax','notes','internal_notes','invoice_number','status','total','balance','created_at','updated_at']
    when 'property' then array['name','address','city','province','postal_code','country','client','kind','is_primary','created_at','updated_at']
  end;
$function$;

-- ── Toutes les entreprises existantes ──────────────────────────────────────────
select public.cf_assurer_dossiers_systeme(id) from public.orgs;
