-- ============================================================
-- Activity Center tracking — journal d'événements par triggers.
--
-- Objectif : tout ce qui touche devis / factures / paiements /
-- notes / avis / cartes crée une ligne dans public.notifications,
-- quelle que soit la voie d'écriture (routes serveur, appels
-- Supabase côté client, webhooks Stripe/PayPal, SQL de recalc).
--
-- Deux familles d'événements :
--   • ALERTE  (is_read = false) — actions initiées par le client :
--     devis approuvé/refusé/modifs demandées, paiement reçu/échoué,
--     facture payée, avis reçu, carte enregistrée. Alimentent le
--     badge cloche + notifications bureau.
--   • AMBIANT (is_read = true) — actions de l'équipe : créé, modifié,
--     envoyé, archivé, supprimé. Visibles dans le fil du centre
--     d'activités, sans badge ni notification bureau.
--
-- Les titres SQL sont en français (fallback) ; l'UI mappe le type
-- vers un libellé localisé fr/en.
-- ============================================================

-- ── 0. Colonnes défensives (idempotent, déjà présentes si 20260706100000 appliquée)
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read_at timestamptz;

-- ── 1. Helpers ──────────────────────────────────────────────

-- $1,450 / $1,450.50 — le $ avant le montant, jamais « 100 $ ».
CREATE OR REPLACE FUNCTION public.ac_fmt_dollars(p_cents integer)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $fn$
  SELECT '$' || replace(to_char(coalesce(p_cents, 0) / 100.0, 'FM999,999,999,990.00'), '.00', '');
$fn$;

CREATE OR REPLACE FUNCTION public.ac_client_name(p_client uuid)
RETURNS text
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
  FROM public.clients WHERE id = p_client;
$fn$;

-- Insert exception-safe : un échec de journalisation ne doit JAMAIS
-- faire échouer l'écriture métier qui l'a déclenché.
CREATE OR REPLACE FUNCTION public.ac_log_event(
  p_org uuid,
  p_type text,
  p_entity text,
  p_title text,
  p_body text,
  p_link text,
  p_ref uuid,
  p_alert boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_org IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications
    (org_id, type, entity_type, title, body, link, reference_id, is_read, read_at)
  VALUES (
    p_org, p_type, p_entity, p_title,
    left(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'), 300),
    p_link, p_ref,
    NOT p_alert,
    CASE WHEN p_alert THEN NULL ELSE now() END
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_log_event(%) failed: %', p_type, SQLERRM;
END;
$fn$;

-- ── 2. Devis ────────────────────────────────────────────────
-- créés, modifiés, envoyés, approuvés, refusés, modifs demandées,
-- archivés, supprimés (soft et hard).

CREATE OR REPLACE FUNCTION public.ac_track_quotes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  v_body text;
  v_link text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_body := '#' || coalesce(r.quote_number::text, '?')
         || coalesce(' · ' || public.ac_client_name(coalesce(r.client_id, r.lead_id)), '')
         || ' · ' || public.ac_fmt_dollars(r.total_cents);
  v_link := '/quotes/' || r.id;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.ac_log_event(r.org_id, 'quote_deleted', 'quote', 'Devis supprimé', v_body, NULL, r.id, false);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      IF NEW.status = 'awaiting_response' THEN
        PERFORM public.ac_log_event(NEW.org_id, 'quote_sent', 'quote', 'Devis envoyé', v_body, v_link, NEW.id, false);
      ELSE
        PERFORM public.ac_log_event(NEW.org_id, 'quote_created', 'quote', 'Devis créé', v_body, v_link, NEW.id, false);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.ac_log_event(NEW.org_id, 'quote_deleted', 'quote', 'Devis supprimé', v_body, NULL, NEW.id, false);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'awaiting_response' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_sent', 'quote', 'Devis envoyé', v_body, v_link, NEW.id, false);
    ELSIF NEW.status = 'approved' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_approved', 'quote', 'Devis approuvé', v_body, v_link, NEW.id, true);
    ELSIF NEW.status = 'declined' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_declined', 'quote', 'Devis refusé', v_body, v_link, NEW.id, true);
    ELSIF NEW.status = 'changes_requested' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_changes_requested', 'quote', 'Modifications demandées', v_body, v_link, NEW.id, true);
    ELSIF NEW.status = 'archived' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'quote_archived', 'quote', 'Devis archivé', v_body, v_link, NEW.id, false);
    END IF;
    -- draft / expired / converted : silencieux (converted est déjà
    -- couvert par la création du job).
  ELSIF (NEW.total_cents, NEW.subtotal_cents, NEW.discount_cents, NEW.tax_cents, NEW.title, NEW.valid_until)
        IS DISTINCT FROM
        (OLD.total_cents, OLD.subtotal_cents, OLD.discount_cents, OLD.tax_cents, OLD.title, OLD.valid_until) THEN
    PERFORM public.ac_log_event(NEW.org_id, 'quote_updated', 'quote', 'Devis modifié', v_body, v_link, NEW.id, false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_quotes failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ac_track_quotes ON public.quotes;
CREATE TRIGGER trg_ac_track_quotes
  AFTER INSERT OR UPDATE OR DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.ac_track_quotes();

-- ── 3. Factures ─────────────────────────────────────────────
-- créées, modifiées, envoyées, payées, supprimées.
-- NB : paid_cents / balance_cents changent à chaque paiement (recalc SQL)
-- et ne comptent PAS comme « facture modifiée ».

CREATE OR REPLACE FUNCTION public.ac_track_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  v_body text;
  v_link text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_body := '#' || coalesce(r.invoice_number, '?')
         || coalesce(' · ' || public.ac_client_name(r.client_id), '')
         || ' · ' || public.ac_fmt_dollars(r.total_cents);
  v_link := '/invoices/' || r.id;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.ac_log_event(r.org_id, 'invoice_deleted', 'invoice', 'Facture supprimée', v_body, NULL, r.id, false);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      IF NEW.status = 'sent' THEN
        PERFORM public.ac_log_event(NEW.org_id, 'invoice_sent', 'invoice', 'Facture envoyée', v_body, v_link, NEW.id, false);
      ELSE
        PERFORM public.ac_log_event(NEW.org_id, 'invoice_created', 'invoice', 'Facture créée', v_body, v_link, NEW.id, false);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.ac_log_event(NEW.org_id, 'invoice_deleted', 'invoice', 'Facture supprimée', v_body, NULL, NEW.id, false);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'sent' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'invoice_sent', 'invoice', 'Facture envoyée', v_body, v_link, NEW.id, false);
    ELSIF NEW.status = 'paid' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'invoice_paid', 'invoice', 'Facture payée', v_body, v_link, NEW.id, true);
    ELSIF NEW.status = 'void' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'invoice_updated', 'invoice', 'Facture annulée', v_body, v_link, NEW.id, false);
    END IF;
    -- draft / partial : silencieux (partial = déjà couvert par payment_received).
  ELSIF (NEW.total_cents, NEW.subtotal_cents, NEW.tax_cents, NEW.subject, NEW.due_date, NEW.invoice_number)
        IS DISTINCT FROM
        (OLD.total_cents, OLD.subtotal_cents, OLD.tax_cents, OLD.subject, OLD.due_date, OLD.invoice_number) THEN
    PERFORM public.ac_log_event(NEW.org_id, 'invoice_updated', 'invoice', 'Facture modifiée', v_body, v_link, NEW.id, false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_invoices failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ac_track_invoices ON public.invoices;
CREATE TRIGGER trg_ac_track_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.ac_track_invoices();

-- ── 4. Paiements ────────────────────────────────────────────
-- encaissés, échoués (autopay Stripe inclus — le webhook insère la
-- ligne status='failed'), remboursés, modifiés, supprimés.

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
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT invoice_number INTO v_inv_num FROM public.invoices WHERE id = r.invoice_id;
  v_body := public.ac_fmt_dollars(r.amount_cents)
         || coalesce(' · Facture #' || v_inv_num, '')
         || coalesce(' · ' || public.ac_client_name(r.client_id), '');
  v_link := CASE WHEN r.invoice_id IS NOT NULL THEN '/invoices/' || r.invoice_id ELSE NULL END;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.ac_log_event(r.org_id, 'payment_deleted',
      CASE WHEN r.invoice_id IS NOT NULL THEN 'invoice' END,
      'Paiement supprimé', v_body, NULL, r.id, false);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      IF NEW.status = 'succeeded' THEN
        PERFORM public.ac_log_event(NEW.org_id, 'payment_received',
          CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
          'Paiement reçu', v_body, v_link, NEW.id, true);
      ELSIF NEW.status = 'failed' THEN
        PERFORM public.ac_log_event(NEW.org_id, 'payment_failed',
          CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
          'Paiement échoué', v_body, v_link, NEW.id, true);
      END IF;
      -- pending : silencieux, on attend la transition de statut.
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.ac_log_event(NEW.org_id, 'payment_deleted',
      CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
      'Paiement supprimé', v_body, NULL, NEW.id, false);
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'succeeded' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'payment_received',
        CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
        'Paiement reçu', v_body, v_link, NEW.id, true);
    ELSIF NEW.status = 'failed' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'payment_failed',
        CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
        'Paiement échoué', v_body, v_link, NEW.id, true);
    ELSIF NEW.status = 'refunded' THEN
      PERFORM public.ac_log_event(NEW.org_id, 'payment_refunded',
        CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
        'Paiement remboursé', v_body, v_link, NEW.id, true);
    END IF;
  ELSIF (NEW.amount_cents, NEW.method, NEW.payment_date)
        IS DISTINCT FROM
        (OLD.amount_cents, OLD.method, OLD.payment_date) THEN
    PERFORM public.ac_log_event(NEW.org_id, 'payment_updated',
      CASE WHEN NEW.invoice_id IS NOT NULL THEN 'invoice' END,
      'Paiement modifié', v_body, v_link, NEW.id, false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_payments failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ac_track_payments ON public.payments;
CREATE TRIGGER trg_ac_track_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.ac_track_payments();

-- ── 5. Notes ────────────────────────────────────────────────
-- activity_notes (panneau EVENTS, soft delete) et specific_notes
-- (notes avec pièces jointes, hard delete).

CREATE OR REPLACE FUNCTION public.ac_note_context(p_entity_type text, p_entity_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_entity_type = 'client' THEN
    RETURN public.ac_client_name(p_entity_id);
  ELSIF p_entity_type = 'job' THEN
    RETURN (SELECT 'Job #' || coalesce(job_number::text, '?') FROM public.jobs WHERE id = p_entity_id);
  ELSIF p_entity_type = 'quote' THEN
    RETURN (SELECT 'Devis #' || coalesce(quote_number::text, '?') FROM public.quotes WHERE id = p_entity_id);
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.ac_track_activity_notes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  v_body text;
  v_link text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_body := coalesce(public.ac_note_context(r.entity_type, r.entity_id) || ' — ', '')
         || coalesce(nullif(left(r.body, 140), ''), '(vide)');
  v_link := CASE r.entity_type
              WHEN 'client' THEN '/clients/' || r.entity_id
              WHEN 'job'    THEN '/jobs/' || r.entity_id
            END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.deleted_at IS NULL THEN
      PERFORM public.ac_log_event(NEW.org_id, 'note_created', NULL, 'Note ajoutée', v_body, v_link, NEW.id, false);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      PERFORM public.ac_log_event(NEW.org_id, 'note_deleted', NULL, 'Note supprimée', v_body, NULL, NEW.id, false);
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE
  PERFORM public.ac_log_event(r.org_id, 'note_deleted', NULL, 'Note supprimée', v_body, NULL, r.id, false);
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_activity_notes failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ac_track_activity_notes ON public.activity_notes;
CREATE TRIGGER trg_ac_track_activity_notes
  AFTER INSERT OR UPDATE OR DELETE ON public.activity_notes
  FOR EACH ROW EXECUTE FUNCTION public.ac_track_activity_notes();

CREATE OR REPLACE FUNCTION public.ac_track_specific_notes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r      record;
  v_body text;
  v_link text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  v_body := coalesce(public.ac_note_context(r.entity_type, r.entity_id) || ' — ', '')
         || coalesce(nullif(left(r.text, 140), ''), 'Pièce jointe');
  v_link := CASE r.entity_type
              WHEN 'client' THEN '/clients/' || r.entity_id
              WHEN 'job'    THEN '/jobs/' || r.entity_id
              WHEN 'quote'  THEN '/quotes/' || r.entity_id
            END;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.ac_log_event(NEW.org_id, 'note_created', NULL, 'Note ajoutée', v_body, v_link, NEW.id, false);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.ac_log_event(r.org_id, 'note_deleted', NULL, 'Note supprimée', v_body, NULL, r.id, false);
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_specific_notes failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ac_track_specific_notes ON public.specific_notes;
CREATE TRIGGER trg_ac_track_specific_notes
  AFTER INSERT OR DELETE ON public.specific_notes
  FOR EACH ROW EXECUTE FUNCTION public.ac_track_specific_notes();

-- ── 6. Avis clients ─────────────────────────────────────────
-- Tous les avis (pas seulement les mauvais) : la soumission d'un
-- sondage de satisfaction remplit rating / submitted_at.

CREATE OR REPLACE FUNCTION public.ac_track_survey_reviews()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_body text;
  v_link text;
BEGIN
  IF (OLD.submitted_at IS NULL AND NEW.submitted_at IS NOT NULL)
     OR (OLD.rating IS NULL AND NEW.rating IS NOT NULL) THEN
    v_body := 'Note ' || coalesce(NEW.rating::text, '?') || '/5'
           || coalesce(' · ' || public.ac_client_name(NEW.client_id), '')
           || coalesce(' — ' || nullif(left(NEW.feedback, 140), ''), '');
    v_link := CASE
                WHEN NEW.job_id IS NOT NULL THEN '/jobs/' || NEW.job_id
                WHEN NEW.client_id IS NOT NULL THEN '/clients/' || NEW.client_id
              END;
    PERFORM public.ac_log_event(NEW.org_id, 'review_received', NULL, 'Avis client reçu', v_body, v_link, NEW.id, true);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_survey_reviews failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ac_track_survey_reviews ON public.satisfaction_surveys;
CREATE TRIGGER trg_ac_track_survey_reviews
  AFTER UPDATE ON public.satisfaction_surveys
  FOR EACH ROW EXECUTE FUNCTION public.ac_track_survey_reviews();

-- ── 7. Cartes enregistrées ──────────────────────────────────
-- Le flux « save card » n'existe pas encore côté serveur (la
-- requirement payment_method_on_file est créée mais jamais
-- satisfaite). Le tracking est posé d'avance : dès que le flux
-- marquera la requirement paid/authorized, l'événement partira.

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
      'Carte enregistrée', coalesce(v_name, ''), v_link, NEW.entity_id, true);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ac_track_card_saved failed: %', SQLERRM;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ac_track_card_saved ON public.payment_requirements;
CREATE TRIGGER trg_ac_track_card_saved
  AFTER UPDATE ON public.payment_requirements
  FOR EACH ROW EXECUTE FUNCTION public.ac_track_card_saved();
