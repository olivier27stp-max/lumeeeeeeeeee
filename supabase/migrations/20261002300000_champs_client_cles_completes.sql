-- Nouveau client : chaque élément du formulaire a sa custom key (demande de Rafba,
-- 2026-09-28). Ajoutées : autres numéros de téléphone (bouton +) et les morceaux de
-- l'adresse remplis par l'autocomplétion (numéro et rue, ville, province, code
-- postal, pays). Vérifié en prod : aucune collision.

create or replace function public.cf_cles_standard(p_object public.cf_object_type)
 returns text[]
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_object::text
    when 'client'  then array['first_name','last_name','client_number','company','display_as_company','phone','phone_label','other_phones','email','email_label','lead_source','address','street','city','province','postal_code','country','taxes','billing_same_as_service','billing_address','name','status','source','notes','created_at','updated_at']
    when 'deal'    then array['pipeline','client','first_name','last_name','email','phone','address','amount','expected_close_date','assigned_user','source','title','stage','probability','lost_reason','status','created_at','updated_at']
    when 'job'     then array['title','job_number','salesperson','sale_date','show_on_leaderboard','ask_for_review','client','property','job_type','visits','visit_start_time','visit_end_time','team','requires_invoicing','billing_split','deposit_required','deposit_type','deposit_value','require_payment_method','line_items','taxes','subtotal','agreement','notes','status','address','scheduled_at','total','created_at','updated_at']
    when 'quote'   then array['client','quote_type','title','property','quote_number','salesperson','valid_days','photos','introduction','line_items','contract_disclaimer','client_message','notes','specific_notes','subtotal','discount','tax','deposit_required','deposit_type','deposit_value','require_payment_method','status','total','valid_until','created_at','updated_at']
    when 'invoice' then array['client','subject','invoice_date','due_date','salesperson','line_items','subtotal','discount','tax','notes','internal_notes','invoice_number','status','total','balance','created_at','updated_at']
    when 'property' then array['name','address','city','province','postal_code','country','client','kind','is_primary','created_at','updated_at']
  end;
$function$;
