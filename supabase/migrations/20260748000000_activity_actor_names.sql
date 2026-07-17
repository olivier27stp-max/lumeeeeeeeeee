-- ============================================================
-- Activity Center — acteur sur chaque événement.
--
-- Le nouveau design du centre d'activités affiche des titres
-- « acteur en premier » : « William Hébert a créé une facture »,
-- « Julie Bergeron a approuvé un devis ». Cette migration ajoute
-- notifications.actor_name et redéfinit les fonctions de
-- journalisation (20260747000000) pour le remplir :
--   • actions d'équipe (créé/modifié/envoyé/archivé/supprimé)
--     → profiles.full_name de auth.uid() (NULL si service-role) ;
--   • actions client (approuvé/refusé/modifs/paiement/avis/carte)
--     → le nom du client.
-- À appliquer APRÈS 20260747000000.
-- ============================================================

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_name text;

-- Nom de l'utilisateur connecté. NULL pour les écritures service-role
-- (webhooks Stripe, routes publiques) — l'UI retombe sur le libellé neutre.
CREATE OR REPLACE FUNCTION public.ac_actor_name()
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT nullif(trim(full_name), '') FROM public.profiles WHERE id = auth.uid();
$fn$;

-- ── ac_log_event gagne p_actor. On supprime l'ancienne signature à
-- 8 arguments pour éviter toute ambiguïté de surcharge.
DROP FUNCTION IF EXISTS public.ac_log_event(uuid, text, text, text, text, text, uuid, boolean);

CREATE OR REPLACE FUNCTION public.ac_log_event(
  p_org uuid,
  p_type text,
  p_entity text,
  p_title text,
  p_body text,
  p_link text,
  p_ref uuid,
  p_alert boolean,
  p_actor text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_org IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications
    (org_id, type, entity_type, title, body, link, reference_id, is_read, read_at, actor_name)
  VALUES (
    p_org, p_type, p_entity, p_title,
    left(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'), 300),
    p_link, p_ref,
    NOT p_alert,
    CASE WHEN p_alert THEN NULL ELSE now() END,
    nullif(trim(coalesce(p_actor, '')), '')
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_log_event(%) failed: %', p_type, SQLERRM;
END;
$fn$;

-- ── 2. Devis ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ac_track_quotes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r        record;
  v_body   text;
  v_link   text;
  v_client text;
  v_team   text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_client := public.ac_client_name(coalesce(r.client_id, r.lead_id));
  v_team   := public.ac_actor_name();
  v_body := '#' || coalesce(r.quote_number::text, '?')
         || coalesce(' · ' || v_client, '')
         || ' · ' || public.ac_fmt_dollars(r.total_cents);
  v_link := '/quotes/' || r.id;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.ac_log_event(r.org_id, 'quote_deleted', 'quote', 'Devis supprimé', v_body, NULL, r.id, false, v_team);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      IF NEW.status = 'awaiting_response' THEN
        PERFORM public.ac_log_event(NEW.org_id, 'quote_sent', 'quote', 'Devis envoyé', v_body, v_link, NEW.id, false, v_team);
      ELSE
        PERFORM public.ac_log_event(NEW.org_id, 'quote_created', 'quote', 'Devis créé', v_body, v_link, NEW.id, false, v_team);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.ac_log_event(NEW.org_id, 'quote_deleted', 'quote', 'Devis supprimé', v_body, NULL, NEW.id, false, v_team);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'awaiting_response' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_sent', 'quote', 'Devis envoyé', v_body, v_link, NEW.id, false, v_team);
    ELSIF NEW.status = 'approved' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_approved', 'quote', 'Devis approuvé', v_body, v_link, NEW.id, true, v_client);
    ELSIF NEW.status = 'declined' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_declined', 'quote', 'Devis refusé', v_body, v_link, NEW.id, true, v_client);
    ELSIF NEW.status = 'changes_requested' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_changes_requested', 'quote', 'Modifications demandées', v_body, v_link, NEW.id, true, v_client);
    ELSIF NEW.status = 'archived' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_archived', 'quote', 'Devis archivé', v_body, v_link, NEW.id, false, v_team);
    END IF;
  ELSIF (NEW.total_cents, NEW.subtotal_cents, NEW.discount_cents, NEW.tax_cents, NEW.title, NEW.valid_until)
        IS DISTINCT FROM
        (OLD.total_cents, OLD.subtotal_cents, OLD.discount_cents, OLD.tax_cents, OLD.title, OLD.valid_until) THEN
    PERFORM public.ac_log_event(NEW.org_id, 'quote_updated', 'quote', 'Devis modifié', v_body, v_link, NEW.id, false, v_team);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_quotes failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

-- ── 3. Factures ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ac_track_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r        record;
  v_body   text;
  v_link   text;
  v_client text;
  v_team   text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_client := public.ac_client_name(r.client_id);
  v_team   := public.ac_actor_name();
  v_body := '#' || coalesce(r.invoice_number, '?')
         || coalesce(' · ' || v_client, '')
         || ' · ' || public.ac_fmt_dollars(r.total_cents);
  v_link := '/invoices/' || r.id;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.ac_log_event(r.org_id, 'invoice_deleted', 'invoice', 'Facture supprimée', v_body, NULL, r.id, false, v_team);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      IF NEW.status = 'sent' THEN
        PERFORM public.ac_log_event(NEW.org_id, 'invoice_sent', 'invoice', 'Facture envoyée', v_body, v_link, NEW.id, false, v_team);
      ELSE
        PERFORM public.ac_log_event(NEW.org_id, 'invoice_created', 'invoice', 'Facture créée', v_body, v_link, NEW.id, false, v_team);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.ac_log_event(NEW.org_id, 'invoice_deleted', 'invoice', 'Facture supprimée', v_body, NULL, NEW.id, false, v_team);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'sent' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'invoice_sent', 'invoice', 'Facture envoyée', v_body, v_link, NEW.id, false, v_team);
    ELSIF NEW.status = 'paid' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'invoice_paid', 'invoice', 'Facture payée', v_body, v_link, NEW.id, true, v_client);
    ELSIF NEW.status = 'void' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'invoice_updated', 'invoice', 'Facture annulée', v_body, v_link, NEW.id, false, v_team);
    END IF;
  ELSIF (NEW.total_cents, NEW.subtotal_cents, NEW.tax_cents, NEW.subject, NEW.due_date, NEW.invoice_number)
        IS DISTINCT FROM
        (OLD.total_cents, OLD.subtotal_cents, OLD.tax_cents, OLD.subject, OLD.due_date, OLD.invoice_number) THEN
    PERFORM public.ac_log_event(NEW.org_id, 'invoice_updated', 'invoice', 'Facture modifiée', v_body, v_link, NEW.id, false, v_team);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_invoices failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

-- ── 4. Paiements ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ac_track_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r         record;
  v_body    text;
  v_link    text;
  v_inv_num text;
  v_client  text;
  v_team    text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT invoice_number INTO v_inv_num FROM public.invoices WHERE id = r.invoice_id;
  v_client := public.ac_client_name(r.client_id);
  v_team   := public.ac_actor_name();
  v_body := public.ac_fmt_dollars(r.amount_cents)
         || coalesce(' · Facture #' || v_inv_num, '')
         || coalesce(' · ' || v_client, '');
  v_link := CASE WHEN r.invoice_id IS NOT NULL THEN '/invoices/' || r.invoice_id ELSE NULL END;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.ac_log_event(r.org_id, 'payment_deleted',
      CASE WHEN r.invoice_id IS NOT NULL THEN 'invoice' END,
      'Paiement supprimé', v_body, NULL, r.id, false, v_team);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      IF NEW.status = 'succeeded' THEN
        PERFORM public.ac_log_event(NEW.org_id, 'payment_received',
          CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
          'Paiement reçu', v_body, v_link, NEW.id, true, v_client);
      ELSIF NEW.status = 'failed' THEN
        PERFORM public.ac_log_event(NEW.org_id, 'payment_failed',
          CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
          'Paiement échoué', v_body, v_link, NEW.id, true, v_client);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.ac_log_event(NEW.org_id, 'payment_deleted',
      CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
      'Paiement supprimé', v_body, NULL, NEW.id, false, v_team);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'succeeded' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'payment_received',
        CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
        'Paiement reçu', v_body, v_link, NEW.id, true, v_client);
    ELSIF NEW.status = 'failed' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'payment_failed',
        CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
        'Paiement échoué', v_body, v_link, NEW.id, true, v_client);
    ELSIF NEW.status = 'refunded' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'payment_refunded',
        CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
        'Paiement remboursé', v_body, v_link, NEW.id, true, v_client);
    END IF;
  ELSIF (NEW.amount_cents, NEW.method, NEW.payment_date)
        IS DISTINCT FROM
        (OLD.amount_cents, OLD.method, OLD.payment_date) THEN
    PERFORM public.ac_log_event(NEW.org_id, 'payment_updated',
      CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
      'Paiement modifié', v_body, v_link, NEW.id, false, v_team);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_payments failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

-- ── 5. Notes ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ac_track_activity_notes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r       record;
  v_body  text;
  v_link  text;
  v_actor text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT nullif(trim(full_name), '') INTO v_actor FROM public.profiles WHERE id = r.actor_id;
  IF v_actor IS NULL THEN v_actor := public.ac_actor_name(); END IF;
  v_body := coalesce(public.ac_note_context(r.entity_type, r.entity_id) || ' — ', '')
         || coalesce(nullif(left(r.body, 140), ''), '(vide)');
  v_link := CASE r.entity_type
              WHEN 'client' THEN '/clients/' || r.entity_id
              WHEN 'job'    THEN '/jobs/' || r.entity_id
            END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      PERFORM public.ac_log_event(NEW.org_id, 'note_created', NULL, 'Note ajoutée', v_body, v_link, NEW.id, false, v_actor);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      PERFORM public.ac_log_event(NEW.org_id, 'note_deleted', NULL, 'Note supprimée', v_body, NULL, NEW.id, false, v_actor);
    END IF;
    RETURN NEW;
  END IF;
  PERFORM public.ac_log_event(r.org_id, 'note_deleted', NULL, 'Note supprimée', v_body, NULL, r.id, false, v_actor);
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_activity_notes failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ac_track_specific_notes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r       record;
  v_body  text;
  v_link  text;
  v_actor text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT nullif(trim(full_name), '') INTO v_actor FROM public.profiles WHERE id = r.created_by;
  IF v_actor IS NULL THEN v_actor := public.ac_actor_name(); END IF;
  v_body := coalesce(public.ac_note_context(r.entity_type, r.entity_id) || ' — ', '')
         || coalesce(nullif(left(r.text, 140), ''), 'Pièce jointe');
  v_link := CASE r.entity_type
              WHEN 'client' THEN '/clients/' || r.entity_id
              WHEN 'job'    THEN '/jobs/' || r.entity_id
              WHEN 'quote'  THEN '/quotes/' || r.entity_id
            END;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.ac_log_event(NEW.org_id, 'note_created', NULL, 'Note ajoutée', v_body, v_link, NEW.id, false, v_actor);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.ac_log_event(r.org_id, 'note_deleted', NULL, 'Note supprimée', v_body, NULL, r.id, false, v_actor);
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_specific_notes failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

-- ── 6. Avis clients ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ac_track_survey_reviews()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_body   text;
  v_link   text;
  v_client text;
BEGIN
  IF (OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL)
     OR (OLD.rating IS NULL AND NEW.rating IS NOT NULL) THEN
    v_client := public.ac_client_name(NEW.client_id);
    v_body := 'Note ' || coalesce(NEW.rating::text, '?') || '/5'
           || coalesce(' · ' || v_client, '')
           || coalesce(' — ' || nullif(left(NEW.feedback, 140), ''), '');
    v_link := CASE
                WHEN NEW.job_id IS NOT NULL THEN '/jobs/' || NEW.job_id
                WHEN NEW.client_id IS NOT NULL THEN '/clients/' || NEW.client_id
              END;
    PERFORM public.ac_log_event(NEW.org_id, 'review_received', NULL, 'Avis client reçu', v_body, v_link, NEW.id, true, v_client);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_survey_reviews failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

-- ── 7. Cartes enregistrées ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.ac_track_card_saved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_name text;
  v_link text;
BEGIN
  IF NEW.requirement_type = 'payment_method_on_file'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('paid', 'authorized') THEN
    IF NEW.entity_type = 'quote' THEN
      SELECT public.ac_client_name(coalesce(q.client_id, q.lead_id)) INTO v_name
      FROM public.quotes q WHERE q.id = NEW.entity_id;
      v_link := '/quotes/' || NEW.entity_id;
    END IF;
    PERFORM public.ac_log_event(NEW.org_id, 'card_saved',
      CASE WHEN NEW.entity_type = 'quote' THEN 'quote' END,
      'Carte enregistrée', coalesce(v_name, ''), v_link, NEW.entity_id, true, v_name);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_card_saved failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;
