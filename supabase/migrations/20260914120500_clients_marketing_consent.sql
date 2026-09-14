-- Audit automatisations 2026-09-13, F7 (LCAP/CASL) — migration M5.
-- Consentement aux communications COMMERCIALES (relance de vente, réengagement,
-- saisonnier, anniversaire). Les messages transactionnels (confirmation, reçu,
-- rappel de rendez-vous, relance de facture) ne sont pas concernés.
-- Vérifié avant : `clients.sms_consent_at` / `email_consent_at` existent mais ne
-- sont écrites nulle part (0 ligne renseignée en prod, aucun écrivain dans le
-- code) ; elles restent en place, ce champ-ci porte la décision.
alter table public.clients
  add column if not exists marketing_consent text not null default 'implied'
    check (marketing_consent in ('express', 'implied', 'none')),
  add column if not exists marketing_consent_at timestamptz,
  add column if not exists marketing_consent_source text;   -- 'form', 'quote_accepted', 'manual', 'import'
comment on column public.clients.marketing_consent is
  'LCAP/CASL : express = consentement exprès ; implied = relation d''affaires en cours ; none = aucun envoi commercial. Le moteur d''automatisations refuse (échec définitif, journalisé) toute action commerciale différée quand la valeur est none.';
