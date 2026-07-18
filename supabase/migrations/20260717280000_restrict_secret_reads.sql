-- ═══════════════════════════════════════════════════════════════
-- SÉCURITÉ : restreindre la LECTURE de deux tables porteuses de secrets
-- à owner/admin (audit 2026-07-17, testé : un sales_rep pouvait lire).
--
--   • request_forms.api_key       → clé pour soumettre des leads au nom de
--     la compagnie (usurpation possible)
--   • webhook_endpoints.secret    → secret de signature ; permet de forger
--     de faux événements webhook « valides »
--
-- Les clés Stripe/PayPal (payment_provider_secrets.*_enc) sont chiffrées ET
-- déjà admin-only — non concernées. Ici on aligne juste la lecture sur
-- l'écriture (qui était déjà admin pour webhook_endpoints).
--
-- Note : le SERVEUR lit ces tables via service_role (immunisé aux policies),
-- donc les formulaires publics et la livraison de webhooks continuent de
-- fonctionner. Seul l'accès CLIENT direct est resserré.
-- ═══════════════════════════════════════════════════════════════

-- request_forms : la policy ALL « org_member » ouvrait tout aux membres.
-- On la remplace par : écriture/gestion admin, et lecture admin (l'api_key
-- ne doit pas fuiter vers les reps). Les soumissions publiques passent par
-- le serveur (service_role), pas par cette policy.
drop policy if exists request_forms_org_member on public.request_forms;

create policy request_forms_admin_all on public.request_forms
  for all to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id))
  with check (public.has_org_admin_role((select auth.uid()), org_id));

-- webhook_endpoints : l'écriture était déjà admin ; on resserre la LECTURE
-- (le secret de signature ne doit pas être visible des reps).
drop policy if exists wh_endpoints_org_read on public.webhook_endpoints;

create policy wh_endpoints_admin_read on public.webhook_endpoints
  for select to authenticated
  using (public.has_org_admin_role((select auth.uid()), org_id));
