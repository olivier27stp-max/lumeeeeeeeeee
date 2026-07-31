-- ============================================================================
-- Retire `authenticated` de 3 fonctions SECURITY DEFINER non gardees
-- ============================================================================
--
-- Meme famille que list_archived_items (20260751102100) : des fonctions
-- SECURITY DEFINER, propriete de `postgres` (rolbypassrls = true, donc la RLS
-- ne s'applique PAS dans leur corps), qui agissent sur l'organisation passee
-- en PARAMETRE, sans verifier que l'appelant en est membre. Toutes etaient
-- appelables directement depuis le navigateur via PostgREST.
--
--   create_minimal_job_for_deal(p_org_id, ...)  -> insert into jobs
--   record_consent(..., p_org_id)               -> insert into consents
--                                                  (falsification d'un registre
--                                                   de consentement Loi 25)
--   crm_next_invoice_number(p_org_id)           -> consomme la sequence de
--                                                  facturation d'une autre org
--
-- POURQUOI UN REVOKE PLUTOT QU'UNE GARDE DANS LE CORPS
-- ----------------------------------------------------
-- Aucune de ces fonctions n'est appelee depuis le navigateur (verifie : 0
-- occurrence dans src/). Elles ne sont atteintes que par :
--   * le serveur, en service_role — conserve son droit ;
--   * d'autres fonctions SQL, toutes SECURITY DEFINER et propriete de
--     `postgres` (verifie) — leur corps s'execute donc avec les droits de
--     postgres, et le droit de l'appelant n'entre pas en jeu.
-- Retirer le droit supprime la surface d'attaque sans toucher a une seule
-- ligne de logique metier. C'est le changement le moins risque possible.
--
-- Appelants verifies (tous prosecdef = true, owner = postgres) :
--   create_minimal_job_for_deal <- create_client_and_deal, create_deal_with_job,
--                                  create_lead_and_deal
--   crm_next_invoice_number     <- crm_invoices_ensure_number,
--                                  create_or_get_invoice_from_job
--   record_consent              <- server/routes/dsr.ts (service_role)
--
-- APPLIQUE DIRECTEMENT EN PRODUCTION le 2026-07-31 a 02:36 UTC.
-- Cette migration le consigne pour survivre a un `db reset`. Idempotent.
--
-- Verifie par execution : un utilisateur authentifie appelant directement
-- create_minimal_job_for_deal recoit desormais
--   ERROR 42501: permission denied for function create_minimal_job_for_deal
--
-- ROLLBACK : re-accorder le droit
--   grant execute on function public.<nom>(<args>) to authenticated;
-- ============================================================================

revoke execute on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text)
  from authenticated;

revoke execute on function public.record_consent(
  text, uuid, text, boolean, text, text, inet, text, text, uuid
) from authenticated;

revoke execute on function public.crm_next_invoice_number(uuid)
  from authenticated;

comment on function public.create_minimal_job_for_deal(uuid, uuid, uuid, text) is
  'Interne. L''org vient d''un parametre et n''est PAS verifiee : ne jamais '
  'redonner le droit d''execution a authenticated. Appelee uniquement par des '
  'fonctions SECURITY DEFINER proprietaires postgres.';

comment on function public.crm_next_invoice_number(uuid) is
  'Interne. Consomme la sequence de facturation de l''org passee en parametre, '
  'sans verifier l''appartenance : ne jamais rouvrir a authenticated.';

-- ============================================================================
-- NON CORRIGE ICI — constate pendant l'audit, hors perimetre securite
-- ============================================================================
-- create_minimal_client_for_deal() est CASSEE en production. Son corps fait :
--     cols text[] := array[]::text[];
--     cols := cols || 'org_id';
-- PostgreSQL resout `text[] || <litteral non type>` vers `anyarray || anyarray`
-- et tente donc de parser 'org_id' comme un litteral de tableau :
--     ERROR 22P02: malformed array literal: "org_id"
-- Consequence : create_client_and_deal() echoue systematiquement, et avec elle
-- create_lead_and_deal() / create_deal_with_job() qui en dependent.
-- Correctif attendu : typer explicitement (`cols || 'org_id'::text`), ou mieux,
-- abandonner la construction SQL dynamique par introspection
-- d'information_schema, qui n'a plus lieu d'etre maintenant que le schema est
-- stable. Aucun appelant applicatif ne les utilise aujourd'hui (0 occurrence
-- dans src/ et server/), l'impact est donc nul a court terme.
