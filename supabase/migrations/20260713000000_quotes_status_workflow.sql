-- ============================================================
-- Quotes — status workflow rework
--
-- Nouveau cycle de vie des devis :
--   draft              → créé mais pas envoyé (abandonné ou en préparation)
--   awaiting_response  → envoyé au client, sans réponse
--   changes_requested  → le client a demandé des changements depuis la
--                        page publique du devis
--   approved           → approuvé (signature électronique ou manuel)
--   converted          → converti en job (ou facture)
--   archived           → rangé / archivé par le staff
--   declined / expired → conservés (refus client + expiration)
--
-- Changements :
--   * 'action_required' et 'sent' disparaissent :
--       action_required → draft, sent → awaiting_response
--   * nouveaux statuts 'changes_requested' et 'archived'
--   * défaut à la création : 'draft'
--   * nouveaux timestamps : changes_requested_at, archived_at
-- ============================================================

-- ── 1. Nouveaux timestamps de statut ────────────────────────
alter table public.quotes add column if not exists changes_requested_at timestamptz;
alter table public.quotes add column if not exists archived_at timestamptz;

-- ── 2. Contrainte de statut : retirer l'ancienne avant de migrer ──
-- Le nom auto-généré est normalement quotes_status_check, mais on repère
-- toute contrainte CHECK portant sur la colonne status (et uniquement elle,
-- pas deposit_status) pour être robuste.
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.quotes'::regclass
      and con.contype = 'c'
      and exists (
        select 1 from unnest(con.conkey) k
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k
        where a.attname = 'status'
      )
  loop
    execute format('alter table public.quotes drop constraint %I', r.conname);
  end loop;
end $$;

-- ── 3. Migration des données existantes ─────────────────────
update public.quotes set status = 'draft'             where status = 'action_required';
update public.quotes set status = 'awaiting_response' where status = 'sent';

-- ── 4. Nouvelle contrainte + défaut ─────────────────────────
alter table public.quotes
  add constraint quotes_status_check
  check (status in (
    'draft','awaiting_response','changes_requested',
    'approved','declined','expired','converted','archived'
  ));

alter table public.quotes alter column status set default 'draft';

-- ── 5. rpc_create_quote : les nouveaux devis démarrent en 'draft' ──
create or replace function public.rpc_create_quote(
  p_lead_id       uuid default null,
  p_client_id     uuid default null,
  p_title         text default '',
  p_salesperson_id uuid default null,
  p_context_type  text default 'lead',
  p_currency      text default 'CAD',
  p_valid_days    integer default 30,
  p_notes         text default null,
  p_contract      text default null,
  p_deposit_required boolean default false,
  p_require_payment_method boolean default false
)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_quote_number text;
  v_seq integer;
  v_quote_id uuid;
  v_valid_until date;
begin
  -- Resolve org
  v_org_id := public.current_org_id();
  if v_org_id is null then
    raise exception 'No organization context';
  end if;

  -- Auto-increment quote number
  insert into public.quote_sequences (org_id, last_value, updated_at)
  values (v_org_id, 1, now())
  on conflict (org_id) do update
    set last_value = quote_sequences.last_value + 1,
        updated_at = now()
  returning last_value into v_seq;

  v_quote_number := v_seq::text;
  v_valid_until := current_date + p_valid_days;

  -- Create the quote
  insert into public.quotes (
    org_id, quote_number, title, lead_id, client_id,
    status, context_type, salesperson_id, created_by,
    currency, valid_until, notes, contract_disclaimer,
    deposit_required, require_payment_method
  ) values (
    v_org_id, v_quote_number, p_title, p_lead_id, p_client_id,
    'draft', p_context_type, p_salesperson_id, auth.uid(),
    p_currency, v_valid_until, p_notes, p_contract,
    p_deposit_required, p_require_payment_method
  )
  returning id into v_quote_id;

  -- Log initial status
  insert into public.quote_status_history (quote_id, old_status, new_status, changed_by)
  values (v_quote_id, null, 'draft', auth.uid());

  return jsonb_build_object(
    'quote_id', v_quote_id,
    'quote_number', v_quote_number,
    'valid_until', v_valid_until
  );
end;
$$;

-- ── 6. Triggers pipeline auto (20260513200000) : nouveaux statuts ───
-- Les anciennes versions mappaient 'sent'/'viewed' → 'proposal' et
-- 'accepted'/'signed' → 'won' : statuts de devis désormais impossibles ET
-- stages invalides depuis 20260508000000 (pipeline_deals_stage_check
-- n'accepte que new_prospect/no_response/quote_sent/closed_won/closed_lost).
CREATE OR REPLACE FUNCTION public.auto_pipeline_deal_from_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_stage text;
  v_value_cents integer;
BEGIN
  IF NEW.salesperson_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- A quote that's still a draft stays out of pipeline
  v_stage := CASE
    WHEN NEW.status = 'approved' THEN 'closed_won'
    WHEN NEW.status IN ('awaiting_response', 'changes_requested') THEN 'quote_sent'
    WHEN NEW.status = 'declined' THEN 'closed_lost'
    ELSE NULL  -- draft / archived / expired / converted / unknown
  END;

  IF v_stage IS NULL THEN
    RETURN NEW;
  END IF;

  v_value_cents := COALESCE(NEW.total_cents, 0);

  -- Reuse deal for the same lead
  IF NEW.lead_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM pipeline_deals
    WHERE org_id = NEW.org_id
      AND lead_id = NEW.lead_id
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE pipeline_deals
       SET quote_id = COALESCE(quote_id, NEW.id),
           rep_id = COALESCE(rep_id, NEW.salesperson_id),
           stage = v_stage,
           value_cents = GREATEST(value_cents, v_value_cents),
           value = GREATEST(value, v_value_cents / 100.0),
           title = COALESCE(NULLIF(title, ''), NEW.title, 'Quote'),
           won_at = CASE WHEN v_stage = 'closed_won' AND won_at IS NULL THEN now() ELSE won_at END,
           lost_at = CASE WHEN v_stage = 'closed_lost' AND lost_at IS NULL THEN now() ELSE lost_at END,
           updated_at = now()
     WHERE id = v_existing_id;
    RETURN NEW;
  END IF;

  -- Create a new deal (no existing for this lead)
  IF EXISTS (SELECT 1 FROM pipeline_deals WHERE quote_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO pipeline_deals (
    org_id, lead_id, client_id, quote_id, rep_id,
    stage, title, value, value_cents, currency,
    source, created_by, won_at, lost_at
  ) VALUES (
    NEW.org_id, NEW.lead_id, NEW.client_id, NEW.id, NEW.salesperson_id,
    v_stage,
    COALESCE(NEW.title, 'Quote'),
    v_value_cents / 100.0, v_value_cents, COALESCE(NEW.currency, 'CAD'),
    'quote', NEW.salesperson_id,
    CASE WHEN v_stage = 'closed_won' THEN now() ELSE NULL END,
    CASE WHEN v_stage = 'closed_lost' THEN now() ELSE NULL END
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_pipeline_deal_from_quote_impl(NEW public.quotes)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_stage text;
  v_value_cents integer;
BEGIN
  IF NEW.salesperson_id IS NULL THEN RETURN; END IF;
  v_stage := CASE
    WHEN NEW.status = 'approved' THEN 'closed_won'
    WHEN NEW.status IN ('awaiting_response', 'changes_requested') THEN 'quote_sent'
    WHEN NEW.status = 'declined' THEN 'closed_lost'
    ELSE NULL
  END;
  IF v_stage IS NULL THEN RETURN; END IF;
  v_value_cents := COALESCE(NEW.total_cents, 0);

  -- Try to find by quote_id first (we set this on insert if no lead deal)
  SELECT id INTO v_existing_id FROM pipeline_deals
   WHERE org_id = NEW.org_id AND quote_id = NEW.id AND deleted_at IS NULL LIMIT 1;

  IF v_existing_id IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM pipeline_deals
     WHERE org_id = NEW.org_id AND lead_id = NEW.lead_id AND deleted_at IS NULL
     ORDER BY created_at ASC LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE pipeline_deals
       SET quote_id = COALESCE(quote_id, NEW.id),
           rep_id = COALESCE(rep_id, NEW.salesperson_id),
           stage = v_stage,
           value_cents = GREATEST(value_cents, v_value_cents),
           value = GREATEST(value, v_value_cents / 100.0),
           won_at = CASE WHEN v_stage = 'closed_won' AND won_at IS NULL THEN now() ELSE won_at END,
           lost_at = CASE WHEN v_stage = 'closed_lost' AND lost_at IS NULL THEN now() ELSE lost_at END,
           updated_at = now()
     WHERE id = v_existing_id;
  END IF;
END;
$$;

-- ── 7. RPC insights : prévision de revenus (20260324000004) ─────────
-- L'ancienne version filtrait le pipeline avec ('draft','sent','action_required').
CREATE OR REPLACE FUNCTION public.rpc_insights_revenue_forecast(p_org uuid default null)
RETURNS TABLE (month_start date, projected_cents bigint, source text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_avg bigint; v_pipeline bigint; v_rate numeric;
BEGIN
  v_org := coalesce(p_org, current_org_id());
  IF v_org IS NULL THEN RAISE EXCEPTION 'Unable to resolve org_id'; END IF;
  IF auth.uid() IS NOT NULL AND NOT has_org_membership(auth.uid(), v_org) THEN RAISE EXCEPTION 'Not allowed'; END IF;

  SELECT coalesce(sum(i.total_cents)/greatest(count(distinct date_trunc('month',coalesce(i.paid_at,i.issued_at))),1),0)::bigint INTO v_avg
  FROM invoices i WHERE i.org_id=v_org AND i.deleted_at IS NULL AND i.status='paid' AND i.paid_at>=(current_date-interval '6 months');

  SELECT coalesce(sum(q.total_cents),0)::bigint INTO v_pipeline
  FROM quotes q WHERE q.org_id=v_org AND q.deleted_at IS NULL AND q.status IN ('draft','awaiting_response','changes_requested');

  SELECT CASE WHEN count(*)>0 THEN (count(*) FILTER (WHERE q.status='approved'))::numeric/count(*) ELSE 0.3 END INTO v_rate
  FROM quotes q WHERE q.org_id=v_org AND q.deleted_at IS NULL AND q.created_at>=(current_date-interval '6 months');

  RETURN QUERY
  SELECT (date_trunc('month',current_date)+(n||' months')::interval)::date, (v_avg*0.7+(v_pipeline*v_rate*(1.0/(n+1)))*0.3)::bigint, 'blended'::text
  FROM generate_series(1,3) AS n;
END;
$$;
