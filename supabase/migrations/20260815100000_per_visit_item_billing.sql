-- Plans de service — la facture d'une visite reflète SES services.
--
-- Avant : create_invoice_from_visit divisait toujours le total du job en
-- parts égales (total ÷ nb de visites). Quand les produits/services du plan
-- sont personnalisés par visite (« S'applique à » une visite précise),
-- 3 lavages de vitres + 1 lavage de revêtement donnaient 4 factures égales
-- au lieu de 3 petites et 1 plus grosse.
--
-- 1) job_line_items.visit_date : date (locale) de la visite du plan à
--    laquelle la ligne s'applique (null = la ligne couvre le job entier).
--    Écrite par le job form quand les services du plan sont personnalisés.
-- 2) create_invoice_from_visit v2 : si le job a des lignes rattachées à des
--    visites, le montant de la visite = part du total du job (TTC) au
--    prorata du sous-total de SES lignes ; la DERNIÈRE visite non facturée
--    reçoit le reste exact (somme des factures = total du job, au cent
--    près). La facture liste les services réels de la visite ; l'écart TTC
--    (la part de taxes) va dans invoices.tax_cents. Une visite sans
--    services retourne skipped=true (aucune facture) au lieu d'une erreur.
--    Sans lignes rattachées : part égale, comportement inchangé.

begin;

-- ── 1) Lien ligne du job ↔ visite du plan ───────────────────────────────
alter table public.job_line_items
  add column if not exists visit_date date;

comment on column public.job_line_items.visit_date is
  'Date (locale) de la visite du plan de service à laquelle cette ligne s''applique — null = la ligne couvre le job entier (toutes les visites).';

-- ── 2) RPC : facture d'une visite, pondérée par ses services ────────────
create or replace function public.create_invoice_from_visit(
  p_org_id uuid,
  p_job_id uuid,
  p_visit_id uuid,
  p_send_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_job record;
  v_visit record;
  v_existing record;
  v_invoice_id uuid;
  v_invoice_status text;
  v_invoice_number text;
  v_amount integer;
  v_visit_count integer;
  v_invoiced_cents integer;
  v_invoiced_count integer;
  v_label text;
  v_visit_date date;
  v_total integer;
  v_all_sub bigint;
  v_dated_sub bigint;
  v_visit_sub bigint;
  v_same_date_events integer;
  v_weight numeric;
  v_use_items boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_org_id is null or p_job_id is null or p_visit_id is null then
    raise exception 'p_org_id, p_job_id and p_visit_id are required' using errcode = '22023';
  end if;

  -- Membre de l'org suffit : les visites sont complétées par les techniciens
  -- sur le terrain et le montant est calculé ici, jamais fourni par l'appelant.
  if not public.has_org_membership(v_uid, p_org_id) then
    raise exception 'Not a member of this organization' using errcode = '42501';
  end if;

  select j.id, j.org_id, j.client_id, j.title, j.total_cents, j.deleted_at
    into v_job
  from public.jobs j
  where j.id = p_job_id
    and j.org_id = p_org_id
  limit 1;

  if not found or v_job.deleted_at is not null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;

  if v_job.client_id is null then
    raise exception 'Job must be linked to a client before invoicing' using errcode = '23514';
  end if;

  select e.id, e.start_at, e.timezone, e.deleted_at
    into v_visit
  from public.schedule_events e
  where e.id = p_visit_id
    and e.job_id = p_job_id
    and e.org_id = p_org_id
  limit 1;

  if not found or v_visit.deleted_at is not null then
    raise exception 'Visit not found' using errcode = 'P0002';
  end if;

  -- Idempotence : une visite = au plus une facture.
  select i.id, i.status
    into v_existing
  from public.invoices i
  where i.schedule_event_id = p_visit_id
    and i.deleted_at is null
  order by i.created_at desc
  limit 1;

  if found then
    if p_send_now and v_existing.status = 'draft' then
      update public.invoices
         set status = 'sent',
             issued_at = coalesce(issued_at, now()),
             updated_at = now()
       where id = v_existing.id;
      select status into v_invoice_status from public.invoices where id = v_existing.id;
    else
      v_invoice_status := v_existing.status;
    end if;
    return jsonb_build_object(
      'invoice_id', v_existing.id,
      'already_exists', true,
      'status', coalesce(v_invoice_status, v_existing.status)
    );
  end if;

  select count(*)::int into v_visit_count
  from public.schedule_events e
  where e.job_id = p_job_id
    and e.org_id = p_org_id
    and e.deleted_at is null;

  select coalesce(sum(i.total_cents), 0)::int, count(*)::int
    into v_invoiced_cents, v_invoiced_count
  from public.invoices i
  where i.job_id = p_job_id
    and i.schedule_event_id is not null
    and i.deleted_at is null;

  if v_visit_count <= 0 then
    raise exception 'Job has no active visits' using errcode = '23514';
  end if;

  v_total := coalesce(v_job.total_cents, 0);
  v_visit_date := (v_visit.start_at at time zone coalesce(nullif(v_visit.timezone, ''), 'America/Montreal'))::date;

  -- Sous-totaux des lignes du job : toutes, et celles rattachées à une visite.
  select coalesce(sum(li.total_cents), 0),
         coalesce(sum(li.total_cents) filter (where li.visit_date is not null), 0)
    into v_all_sub, v_dated_sub
  from public.job_line_items li
  where li.job_id = p_job_id
    and li.org_id = p_org_id
    and li.deleted_at is null
    and li.included;

  if v_invoiced_count >= v_visit_count - 1 then
    -- Dernière visite non facturée : reste exact (somme = total du job).
    v_amount := greatest(v_total - v_invoiced_cents, 0);
    -- Les lignes de la visite restent affichées si elles existent (ci-dessous).
    select coalesce(sum(li.total_cents), 0) into v_visit_sub
    from public.job_line_items li
    where li.job_id = p_job_id and li.org_id = p_org_id
      and li.deleted_at is null and li.included
      and li.visit_date = v_visit_date;
    v_use_items := v_dated_sub > 0 and v_visit_sub > 0 and v_visit_sub <= v_amount;
  elsif v_dated_sub > 0 and v_all_sub > 0 then
    -- Services personnalisés par visite : part au prorata des lignes de CETTE
    -- visite (les lignes sans visite se répartissent également). Si plusieurs
    -- visites actives partagent la même date, elles se partagent son poids.
    select coalesce(sum(li.total_cents), 0) into v_visit_sub
    from public.job_line_items li
    where li.job_id = p_job_id and li.org_id = p_org_id
      and li.deleted_at is null and li.included
      and li.visit_date = v_visit_date;

    select count(*)::int into v_same_date_events
    from public.schedule_events e
    where e.job_id = p_job_id and e.org_id = p_org_id
      and e.deleted_at is null
      and (e.start_at at time zone coalesce(nullif(e.timezone, ''), 'America/Montreal'))::date = v_visit_date;

    v_weight := v_visit_sub::numeric / greatest(v_same_date_events, 1)
      + (v_all_sub - v_dated_sub)::numeric / v_visit_count;
    v_amount := least(
      round(v_total::numeric * v_weight / v_all_sub)::int,
      greatest(v_total - v_invoiced_cents, 0)
    );

    if v_amount <= 0 then
      -- Visite sans services (poids nul) : rien à facturer — on saute sans
      -- erreur pour ne pas gêner la complétion de la visite sur le terrain.
      return jsonb_build_object(
        'invoice_id', null,
        'already_exists', false,
        'skipped', true,
        'status', 'skipped'
      );
    end if;

    v_use_items := v_same_date_events = 1 and v_visit_sub > 0 and v_visit_sub <= v_amount;
  else
    -- Comportement historique : part égale du total du job.
    v_amount := round(v_total::numeric / v_visit_count)::int;
  end if;

  if v_amount <= 0 then
    raise exception 'Nothing left to invoice for this job' using errcode = '23514';
  end if;

  v_label := coalesce(nullif(trim(v_job.title), ''), 'Job')
    || ' — Visite du ' || to_char(v_visit_date, 'YYYY-MM-DD');

  v_invoice_number := public.invoice_next_number(p_org_id);

  insert into public.invoices (
    org_id,
    created_by,
    client_id,
    job_id,
    schedule_event_id,
    invoice_number,
    status,
    subject,
    issued_at,
    due_date,
    subtotal_cents,
    tax_cents,
    total_cents,
    paid_cents,
    balance_cents
  )
  values (
    p_org_id,
    v_uid,
    v_job.client_id,
    p_job_id,
    p_visit_id,
    v_invoice_number,
    case when p_send_now then 'sent' else 'draft' end,
    v_label,
    case when p_send_now then now() else null end,
    (current_date + interval '14 days')::date,
    0,
    case when v_use_items then v_amount - v_visit_sub::int else 0 end,
    0, 0, 0
  )
  returning id, status into v_invoice_id, v_invoice_status;

  if v_use_items then
    -- Les services réels de la visite ; l'écart TTC (taxes) est dans tax_cents.
    insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents, sort_order)
    select p_org_id, v_invoice_id, li.name, li.qty, li.unit_price_cents, li.total_cents,
           row_number() over (order by li.created_at)
    from public.job_line_items li
    where li.job_id = p_job_id and li.org_id = p_org_id
      and li.deleted_at is null and li.included
      and li.visit_date = v_visit_date;
  else
    insert into public.invoice_items (org_id, invoice_id, description, qty, unit_price_cents, line_total_cents)
    values (p_org_id, v_invoice_id, v_label, 1, v_amount, v_amount);
  end if;

  perform public.recalculate_invoice_totals(v_invoice_id);

  if p_send_now then
    update public.invoices
       set status = 'sent',
           issued_at = coalesce(issued_at, now()),
           updated_at = now()
     where id = v_invoice_id;
  end if;

  select status into v_invoice_status from public.invoices where id = v_invoice_id;

  if to_regclass('public.audit_events') is not null then
    execute
      'insert into public.audit_events (org_id, actor_id, event_type, metadata, created_at)
       values ($1, $2, $3, $4::jsonb, now())'
    using p_org_id, v_uid, 'invoice.created_from_visit', jsonb_build_object(
      'job_id', p_job_id,
      'visit_id', p_visit_id,
      'invoice_id', v_invoice_id,
      'send_now', p_send_now
    );
  end if;

  return jsonb_build_object(
    'invoice_id', v_invoice_id,
    'already_exists', false,
    'status', coalesce(v_invoice_status, case when p_send_now then 'sent' else 'draft' end)
  );
exception
  when unique_violation then
    select i.id, i.status
      into v_existing
    from public.invoices i
    where i.schedule_event_id = p_visit_id
      and i.deleted_at is null
    order by i.created_at desc
    limit 1;

    if found then
      return jsonb_build_object(
        'invoice_id', v_existing.id,
        'already_exists', true,
        'status', v_existing.status
      );
    end if;

    raise;
end;
$fn$;

revoke all on function public.create_invoice_from_visit(uuid, uuid, uuid, boolean) from public;
grant execute on function public.create_invoice_from_visit(uuid, uuid, uuid, boolean) to authenticated, service_role;

commit;
