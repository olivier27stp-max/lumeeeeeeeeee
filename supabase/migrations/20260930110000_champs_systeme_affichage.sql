-- Champs système : cochés par défaut, décochables dans « Gérer les champs » du
-- formulaire (demande de Rafba, 2026-09-28 — « Source du lead » ajoutée puis
-- retirée restait dans « Nouveau client »). Une ligne ici = ce champ de base est
-- masqué dans le formulaire de création de cet objet, pour toute l'entreprise.
-- Les champs indispensables (prénom/nom, titre/client de la job…) sont verrouillés
-- dans src/lib/champs/standard.ts et le serveur refuse de les masquer.
--
-- Aussi : clés réservées complétées avec les champs que les formulaires affichent
-- et qui manquaient (type de numéro / de courriel, heures de visite, sous-total,
-- notes spécifiques). Vérifié en prod avant d'écrire : aucune collision.

create table if not exists public.cf_affichage_systeme (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  object_type public.cf_object_type not null,
  key         text not null,
  masque_creation boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (org_id, object_type, key),
  constraint cf_affichage_systeme_key_format check (key ~ '^[a-z][a-z0-9_]{0,49}$')
);

alter table public.cf_affichage_systeme enable row level security;
alter table public.cf_affichage_systeme force row level security;

revoke all on public.cf_affichage_systeme from public, anon;
grant select, insert, update, delete on public.cf_affichage_systeme to authenticated;
grant all on public.cf_affichage_systeme to service_role;

drop policy if exists cf_affichage_systeme_select on public.cf_affichage_systeme;
create policy cf_affichage_systeme_select on public.cf_affichage_systeme for select to authenticated
  using (public.has_org_membership((select auth.uid()), org_id));
drop policy if exists cf_affichage_systeme_insert on public.cf_affichage_systeme;
create policy cf_affichage_systeme_insert on public.cf_affichage_systeme for insert to authenticated
  with check (public.member_has_permission((select auth.uid()), org_id, 'settings.update'));
drop policy if exists cf_affichage_systeme_update on public.cf_affichage_systeme;
create policy cf_affichage_systeme_update on public.cf_affichage_systeme for update to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'settings.update'))
  with check (public.member_has_permission((select auth.uid()), org_id, 'settings.update'));
drop policy if exists cf_affichage_systeme_delete on public.cf_affichage_systeme;
create policy cf_affichage_systeme_delete on public.cf_affichage_systeme for delete to authenticated
  using (public.member_has_permission((select auth.uid()), org_id, 'settings.update'));

-- ── Clés réservées = champs réels des formulaires (+ attributs déjà réservés) ──
create or replace function public.cf_cles_standard(p_object public.cf_object_type)
 returns text[]
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_object::text
    when 'client'  then array['first_name','last_name','client_number','company','display_as_company','phone','phone_label','email','email_label','lead_source','address','taxes','billing_same_as_service','billing_address','name','city','province','postal_code','status','source','notes','created_at','updated_at']
    when 'deal'    then array['pipeline','client','first_name','last_name','email','phone','address','amount','expected_close_date','assigned_user','source','title','stage','probability','lost_reason','status','created_at','updated_at']
    when 'job'     then array['title','job_number','salesperson','sale_date','show_on_leaderboard','ask_for_review','client','property','job_type','visits','visit_start_time','visit_end_time','team','requires_invoicing','billing_split','deposit_required','deposit_type','deposit_value','require_payment_method','line_items','taxes','subtotal','agreement','notes','status','address','scheduled_at','total','created_at','updated_at']
    when 'quote'   then array['client','quote_type','title','property','quote_number','salesperson','valid_days','photos','introduction','line_items','contract_disclaimer','client_message','notes','specific_notes','subtotal','discount','tax','deposit_required','deposit_type','deposit_value','require_payment_method','status','total','valid_until','created_at','updated_at']
    when 'invoice' then array['client','subject','invoice_date','due_date','salesperson','line_items','discount','tax','notes','internal_notes','invoice_number','status','total','balance','created_at','updated_at']
    when 'property' then array['name','address','city','province','postal_code','country','client','kind','is_primary','created_at','updated_at']
  end;
$function$;
