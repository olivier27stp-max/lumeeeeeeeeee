-- =============================================================================
-- Migration: Pin Lead (mauve) + priorité absolue du pin Vendu
--
-- Règles produit :
--   1. Le pin représente TOUJOURS le statut du client (jamais une quote ou un
--      agreement). Client avec ≥1 job (status='active') → pin 'sale' (Vendu).
--      Client lead → pin 'lead' (mauve, cible), peu importe lead_status : la
--      présence d'une quote ne remplace jamais le pin Lead.
--   2. Le pin Vendu a toujours le dessus — seule l'assignation d'une job fait
--      passer un pin à 'sale' (trigger jobs → clients.status='active' → ici).
--   3. Désambiguïsation : le statut DB 'lead' est désormais réservé au pin
--      Lead (prospects liés à un client). Les pins « À repasser » posés à la
--      main sur la carte sont re-stockés comme 'callback' (valeur déjà admise
--      par le CHECK, déjà rendue cyan par l'UI).
--
-- Contenu :
--   1. sync_field_pin_from_client()   — mapping simplifié (active→sale,
--      lead→lead, sinon pin intact).
--   2. create_field_pin_for_client_row() — même mapping + couleur mauve.
--   3. Backfill :
--        a. houses 'lead' SANS lien client  → 'callback'  (À repasser manuels)
--        b. houses liées à un client lead avec un statut dérivé du pipeline
--           (quote_sent / no_answer / not_interested / unknown) → 'lead'
--        c. houses liées à un client actif → 'sale' (prioritaire, en dernier)
--        d. pin_color des pins 'lead' → mauve (cosmétique, l'UI rend sa
--           propre palette)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Le pin suit le statut du client — mapping simplifié.
--    Remplace la version de 20260703200000 (qui dérivait le pin de
--    lead_status : quote_sent/no_answer/not_interested). Désormais une quote
--    ou un refus de quote ne repeint plus jamais le pin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_field_pin_from_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pin_status text;
  v_pin_color  text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.lead_status IS NOT DISTINCT FROM OLD.lead_status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'active' THEN
    -- ≥1 job assignée (trigger trg_jobs_sync_client_status) → Vendu
    v_pin_status := 'sale';
  ELSIF NEW.status = 'lead' THEN
    -- Lead → pin Lead, peu importe lead_status (une quote envoyée/refusée ne
    -- change jamais le pin ; seule une job le fait passer à 'sale').
    v_pin_status := 'lead';
  ELSE
    -- Archivé / inconnu : pin intact
    RETURN NEW;
  END IF;

  v_pin_color := CASE v_pin_status
    WHEN 'sale' THEN '#22c55e'
    ELSE '#A855F7'  -- lead → mauve
  END;

  UPDATE public.field_house_profiles fhp
  SET current_status = v_pin_status, last_activity_at = now(), updated_at = now()
  WHERE fhp.org_id = NEW.org_id
    AND fhp.deleted_at IS NULL
    AND (fhp.client_id = NEW.id OR fhp.lead_id = NEW.id)
    -- Priorité Vendu : on ne rétrograde jamais vers 'lead' tant qu'UN client
    -- lié à la maison est encore actif (≥1 job). Si plus aucun client lié
    -- n'est actif (job supprimée → retour lead), la rétrogradation est légitime.
    AND (
      v_pin_status = 'sale'
      OR NOT EXISTS (
        SELECT 1 FROM public.clients cx
        WHERE cx.id IN (fhp.client_id, fhp.lead_id)
          AND cx.deleted_at IS NULL
          AND cx.status = 'active'
      )
    );

  UPDATE public.field_pins fp
  SET status = v_pin_status, pin_color = v_pin_color, updated_at = now()
  FROM public.field_house_profiles fhp
  WHERE fp.house_id = fhp.id
    AND fhp.org_id = NEW.org_id
    AND fhp.deleted_at IS NULL
    AND fhp.current_status = v_pin_status
    AND (fhp.client_id = NEW.id OR fhp.lead_id = NEW.id);

  RETURN NEW;
END;
$fn$;

-- (le trigger trg_clients_sync_field_pin existant pointe déjà sur cette fonction)

-- ---------------------------------------------------------------------------
-- 2. Auto-pin à la création du client — même mapping simplifié.
--    Seuls le bloc de mapping et la couleur changent par rapport à 20260743.
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

  -- Même mapping que sync_field_pin_from_client (20260746000000) :
  -- job assignée (active) → Vendu ; lead → Lead ; sinon unknown.
  IF c.status = 'active' THEN
    v_pin_status := 'sale';
  ELSIF c.status = 'lead' THEN
    v_pin_status := 'lead';
  ELSE
    v_pin_status := 'unknown';
  END IF;

  v_pin_color := CASE v_pin_status
    WHEN 'sale' THEN '#22c55e'
    WHEN 'lead' THEN '#A855F7'
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
-- 3a. Backfill — « À repasser » manuels : houses 'lead' SANS lien client.
--     (Les pins posés à la main étaient enregistrés 'lead' par l'ancienne UI ;
--     les vrais leads sont toujours liés à un client par les flux auto.)
-- ---------------------------------------------------------------------------
WITH manual_followups AS (
  UPDATE public.field_house_profiles
  SET current_status = 'callback', updated_at = now()
  WHERE deleted_at IS NULL
    AND current_status = 'lead'
    AND client_id IS NULL
    AND lead_id IS NULL
  RETURNING id
)
UPDATE public.field_pins fp
SET status = 'callback', pin_color = '#06b6d4', updated_at = now()
FROM manual_followups mf
WHERE fp.house_id = mf.id;

-- ---------------------------------------------------------------------------
-- 3b. Backfill — houses liées à un client lead dont le statut venait du
--     pipeline (quote envoyée / sans réponse / refus / inconnu) → Lead.
--     Les statuts manuels D2D (callback, revisit, do_not_knock…) sont gardés.
-- ---------------------------------------------------------------------------
WITH lead_houses AS (
  UPDATE public.field_house_profiles fhp
  SET current_status = 'lead', updated_at = now()
  WHERE fhp.deleted_at IS NULL
    AND fhp.current_status IN ('quote_sent', 'no_answer', 'not_interested', 'unknown')
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id IN (fhp.client_id, fhp.lead_id)
        AND c.deleted_at IS NULL
        AND c.status = 'lead'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.clients c2
      WHERE c2.id IN (fhp.client_id, fhp.lead_id)
        AND c2.deleted_at IS NULL
        AND c2.status = 'active'
    )
  RETURNING fhp.id
)
UPDATE public.field_pins fp
SET status = 'lead', pin_color = '#A855F7', updated_at = now()
FROM lead_houses lh
WHERE fp.house_id = lh.id;

-- ---------------------------------------------------------------------------
-- 3c. Backfill — priorité Vendu : houses liées à un client actif (≥1 job).
--     Exécuté en dernier pour que 'sale' l'emporte sur tout le reste.
-- ---------------------------------------------------------------------------
WITH sold_houses AS (
  UPDATE public.field_house_profiles fhp
  SET current_status = 'sale', updated_at = now()
  WHERE fhp.deleted_at IS NULL
    AND fhp.current_status <> 'sale'
    AND EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id IN (fhp.client_id, fhp.lead_id)
        AND c.deleted_at IS NULL
        AND c.status = 'active'
    )
  RETURNING fhp.id
)
UPDATE public.field_pins fp
SET status = 'sale', pin_color = '#22c55e', updated_at = now()
FROM sold_houses sh
WHERE fp.house_id = sh.id;

-- ---------------------------------------------------------------------------
-- 3d. Cosmétique — pins 'lead' restants passent à la couleur mauve.
-- ---------------------------------------------------------------------------
UPDATE public.field_pins
SET pin_color = '#A855F7', updated_at = now()
WHERE status = 'lead' AND pin_color IS DISTINCT FROM '#A855F7';

COMMIT;
