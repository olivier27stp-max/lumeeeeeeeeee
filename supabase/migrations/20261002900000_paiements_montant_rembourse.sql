-- Remboursements : la facture reflète enfin ce qui a été rendu au client.
--
-- Constat (catalogue de tâches Lumi, 2026-09-29) :
--  * Remboursement PARTIEL (depuis Stripe, ou par la route serveur) : le
--    paiement restait « succeeded » pour son plein montant — la facture
--    continuait d'afficher « payée » alors qu'une partie de l'argent était rendue.
--    Le webhook charge.refunded écrivait même le statut 'partially_refunded',
--    refusé par la contrainte payments_status_check : l'échec était silencieux.
--  * Remboursement COMPLET par la route serveur : le passage à « refunded »
--    recalcule déjà la facture (trg_payments_recalculate_invoice), puis
--    reverse_invoice_payment retranchait le montant UNE DEUXIÈME FOIS — sur une
--    facture payée en deux versements, le versement restant disparaissait.
--
-- Correctif : le montant remboursé vit sur le paiement (refunded_cents) et le
-- recalcul de la facture compte « montant − remboursé » des paiements réussis.
-- Défaut 0 : aucune facture existante ne change.

begin;

alter table public.payments
  add column if not exists refunded_cents integer not null default 0;

alter table public.payments
  drop constraint if exists payments_refunded_cents_borne;
alter table public.payments
  add constraint payments_refunded_cents_borne check (refunded_cents >= 0 and refunded_cents <= amount_cents);

comment on column public.payments.refunded_cents is
  'Part du montant (hors pourboire) rendue au client. Un remboursement complet passe aussi le statut à refunded.';

create or replace function public.recalculate_invoice_from_payments(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_paid_cents bigint := 0;
  v_latest_paid_at timestamptz := null;
  v_total_cents integer := 0;
  v_balance_cents integer := 0;
  v_status text := 'sent';
  v_prev_status text;
begin
  if p_invoice_id is null then
    return;
  end if;

  -- Ce que le client a réellement laissé : montant encaissé moins la part remboursée.
  select
    coalesce(sum(p.amount_cents - coalesce(p.refunded_cents, 0)), 0)::bigint,
    max(p.payment_date)
  into v_paid_cents, v_latest_paid_at
  from public.payments p
  where p.invoice_id = p_invoice_id
    and p.deleted_at is null
    and p.status = 'succeeded';

  select i.total_cents, i.status
    into v_total_cents, v_prev_status
  from public.invoices i
  where i.id = p_invoice_id
    and i.deleted_at is null
  for update;

  if not found then
    return;
  end if;

  v_paid_cents := greatest(0, least(v_paid_cents, v_total_cents));
  v_balance_cents := greatest(v_total_cents - v_paid_cents::integer, 0);

  if v_prev_status = 'void' then
    v_status := 'void';
  elsif v_total_cents = 0 then
    v_status := 'draft';
  elsif v_balance_cents = 0 then
    v_status := 'paid';
  elsif v_paid_cents > 0 then
    v_status := 'partial';
  elsif v_prev_status = 'draft' then
    v_status := 'draft';
  else
    v_status := 'sent';
  end if;

  update public.invoices i
  set
    paid_cents = v_paid_cents::integer,
    balance_cents = v_balance_cents,
    status = v_status,
    paid_at = case when v_status = 'paid' then coalesce(v_latest_paid_at, i.paid_at, now()) else null end,
    updated_at = now()
  where i.id = p_invoice_id;
end;
$function$;

-- Revenus encaissés : nets de la part remboursée. security_invoker OBLIGATOIRE
-- (sans lui, la vue contourne la RLS — incident du 2026-09-06).
create or replace view public.v_revenue_analytics
with (security_invoker = true) as
 select p.org_id,
    (date_trunc('month'::text, (p.payment_date at time zone 'America/Toronto'::text)))::date as month,
    p.currency,
    p.method,
    (count(*))::integer as payment_count,
    sum(p.amount_cents - coalesce(p.refunded_cents, 0)) as total_cents,
    (avg(p.amount_cents - coalesce(p.refunded_cents, 0)))::integer as avg_cents,
    c.id as client_id,
    ((c.first_name || ' '::text) || c.last_name) as client_name,
    c.company as client_company
   from (payments p
     left join clients c on (((c.id = p.client_id) and (c.deleted_at is null))))
  where ((p.deleted_at is null) and (p.status = 'succeeded'::text))
  group by p.org_id, ((date_trunc('month'::text, (p.payment_date at time zone 'America/Toronto'::text)))::date), p.currency, p.method, c.id, c.first_name, c.last_name, c.company;

commit;
