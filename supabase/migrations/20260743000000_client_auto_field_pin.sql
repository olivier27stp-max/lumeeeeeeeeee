-- =============================================================================
-- Migration: Auto map pin for every client entering the CRM
--
-- Problem:
--   Map pins (field_house_profiles + field_pins) were only created for two
--   entry points: the public request form (server-side upsertLeadPinForClient)
--   and the D2D map itself. Clients created via the New Client form, quick-add
--   pickers, the AI agent or any future path never appeared on the Vente Map,
--   and existing clients had no pin at all.
--
-- Fix (DB-level so every current AND future entry point is covered):
--   1. create_field_pin_for_client_row(clients) — find-or-create the house
--      profile + pin for a client that has an address. Coordinates come from
--      clients.latitude/longitude when present (Google Places autocomplete);
--      otherwise the house is created without coords and the server's
--      field-pin-repair cron geocodes it within ~10 minutes.
--   2. AFTER INSERT trigger on clients — pin at creation time.
--   3. AFTER UPDATE OF address trigger — pin appears as soon as an address is
--      added to a previously address-less client.
--   4. Backfill — every existing non-deleted client with an address gets its
--      house + pin (idempotent, skips clients already linked).
--
--   Ongoing status changes keep being handled by trg_clients_sync_field_pin
--   (migration 20260703200000): the pin repaints when the client status moves.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Shared worker: ensure a house + pin exist for one client row.
--    Returns the house id, or NULL when the client has no usable address.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_field_pin_for_client_row(c public.clients)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_address    text;
  v_addr_norm  text;
  v_house_id   uuid;
  v_user_id    uuid;
  v_pin_status text;
  v_pin_color  text;
  v_metadata   jsonb;
BEGIN
  IF c.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  v_address := nullif(btrim(coalesce(c.address, '')), '');
  IF v_address IS NULL THEN
    RETURN NULL;
  END IF;
  v_addr_norm := lower(v_address);

  -- Already linked to a house? Just make sure the pin row exists.
  SELECT fhp.id INTO v_house_id
  FROM public.field_house_profiles fhp
  WHERE fhp.org_id = c.org_id
    AND fhp.deleted_at IS NULL
    AND (fhp.client_id = c.id OR fhp.lead_id = c.id)
  LIMIT 1;

  -- Same status → pin mapping as sync_field_pin_from_client (20260703200000)
  IF c.status = 'active' THEN
    v_pin_status := 'sale';
  ELSIF c.status = 'lead' THEN
    v_pin_status := CASE coalesce(c.lead_status, 'new_prospect')
      WHEN 'new_prospect'  THEN 'lead'
      WHEN 'new'           THEN 'lead'
      WHEN 'qualified'     THEN 'lead'
      WHEN 'no_response'   THEN 'no_answer'
      WHEN 'follow_up_1'   THEN 'no_answer'
      WHEN 'contacted'     THEN 'no_answer'
      WHEN 'quote_sent'    THEN 'quote_sent'
      WHEN 'follow_up_2'   THEN 'quote_sent'
      WHEN 'follow_up_3'   THEN 'quote_sent'
      WHEN 'estimate_sent' THEN 'quote_sent'
      WHEN 'closed_won'    THEN 'sale'
      WHEN 'closed'        THEN 'sale'
      WHEN 'won'           THEN 'sale'
      WHEN 'closed_lost'   THEN 'not_interested'
      WHEN 'lost'          THEN 'not_interested'
      ELSE 'lead'
    END;
  ELSE
    v_pin_status := 'unknown';
  END IF;

  v_pin_color := CASE v_pin_status
    WHEN 'lead'           THEN '#3b82f6'
    WHEN 'no_answer'      THEN '#9ca3af'
    WHEN 'quote_sent'     THEN '#a855f7'
    WHEN 'sale'           THEN '#22c55e'
    WHEN 'not_interested' THEN '#ef4444'
    ELSE '#6b7280'
  END;

  -- field_pins.user_id is NOT NULL: creator, else org owner, else any member
  SELECT m.user_id INTO v_user_id
  FROM public.memberships m
  WHERE m.org_id = c.org_id
  ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
  LIMIT 1;
  v_user_id := coalesce(c.created_by, v_user_id);

  IF v_house_id IS NULL THEN
    v_metadata := jsonb_strip_nulls(jsonb_build_object(
      'source', 'crm_client',
      'client_id', c.id,
      'customer_name', nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
      'customer_phone', c.phone,
      'customer_email', c.email
    ));
    IF c.latitude IS NULL OR c.longitude IS NULL THEN
      v_metadata := v_metadata || jsonb_build_object('geocode_status', 'pending');
    END IF;

    -- Find-or-create by normalized address (unique per org). When another
    -- client already owns the house at this address, keep its link — same
    -- merge semantics as the server-side upsertLeadPinForClient.
    INSERT INTO public.field_house_profiles AS fhp (
      org_id, address, address_normalized, lat, lng,
      current_status, client_id, assigned_user_id,
      visit_count, last_activity_at, metadata
    ) VALUES (
      c.org_id, v_address, v_addr_norm, c.latitude, c.longitude,
      v_pin_status, c.id, v_user_id,
      0, now(), v_metadata
    )
    ON CONFLICT (org_id, address_normalized) WHERE deleted_at IS NULL
    DO UPDATE SET
      client_id        = coalesce(fhp.client_id, EXCLUDED.client_id),
      lat              = coalesce(fhp.lat, EXCLUDED.lat),
      lng              = coalesce(fhp.lng, EXCLUDED.lng),
      last_activity_at = now(),
      updated_at       = now()
    RETURNING fhp.id INTO v_house_id;
  END IF;

  IF v_house_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Pin (UNIQUE (org_id, house_id)); never repaint an existing D2D pin here —
  -- status changes are the job of trg_clients_sync_field_pin.
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.field_pins (org_id, house_id, user_id, status, pin_color)
    VALUES (c.org_id, v_house_id, v_user_id, v_pin_status, v_pin_color)
    ON CONFLICT (org_id, house_id) DO NOTHING;
  END IF;

  INSERT INTO public.field_pin_entity_links (org_id, house_id, entity_type, entity_id)
  VALUES (c.org_id, v_house_id, 'client', c.id)
  ON CONFLICT (org_id, house_id, entity_type, entity_id) DO NOTHING;

  RETURN v_house_id;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Trigger wrapper — pin creation must never break the client write.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_field_pin_for_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.create_field_pin_for_client_row(NEW);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ensure_field_pin_for_client failed for client %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_clients_ensure_field_pin_insert ON public.clients;
CREATE TRIGGER trg_clients_ensure_field_pin_insert
  AFTER INSERT ON public.clients
  FOR EACH ROW
  WHEN (NEW.address IS NOT NULL AND btrim(NEW.address) <> '')
  EXECUTE FUNCTION public.ensure_field_pin_for_client();

-- Address added or changed later (e.g. client created without address):
-- the worker no-ops when the client already has a linked house.
DROP TRIGGER IF EXISTS trg_clients_ensure_field_pin_address ON public.clients;
CREATE TRIGGER trg_clients_ensure_field_pin_address
  AFTER UPDATE OF address, latitude, longitude ON public.clients
  FOR EACH ROW
  WHEN (NEW.address IS NOT NULL AND btrim(NEW.address) <> '')
  EXECUTE FUNCTION public.ensure_field_pin_for_client();

-- ---------------------------------------------------------------------------
-- 3. Backfill: every existing client with an address gets its pin.
--    Houses created without coords are geocoded by the field-pin-repair cron
--    (server/index.ts, every 10 min) or by scripts/backfill-client-pins.mjs.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  c public.clients%rowtype;
  v_done int := 0;
BEGIN
  FOR c IN
    SELECT * FROM public.clients
    WHERE deleted_at IS NULL
      AND address IS NOT NULL
      AND btrim(address) <> ''
  LOOP
    BEGIN
      IF public.create_field_pin_for_client_row(c) IS NOT NULL THEN
        v_done := v_done + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'pin backfill failed for client %: %', c.id, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'pin backfill: % client(s) processed', v_done;
END;
$backfill$;

COMMIT;
