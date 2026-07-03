/* Capture of a production-only index that was never recorded in migrations.

   uq_clients_org_phone_notnull enforces one active client per normalized
   phone number per org. It exists in the production database (surfaced by
   23505 errors on public request-form submissions) but no migration file
   created it. Recorded here with IF NOT EXISTS so it is a no-op in prod and
   fresh environments match production behavior.

   Server code that inserts clients directly (ensureClientForLead) resolves
   phone collisions to the existing client instead of failing. */

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_org_phone_notnull
  ON public.clients (org_id, regexp_replace(phone, '[^0-9]+', '', 'g'))
  WHERE phone IS NOT NULL AND deleted_at IS NULL;
