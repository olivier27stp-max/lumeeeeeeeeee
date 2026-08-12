-- Durcissement sécurité — 3 points relevés par l'audit du 2026-08-10.
-- Aucun de ces points n'était une fuite active ; c'est de la défense en profondeur.
--
-- 1. Bucket `director-panel` : reliquat orphelin. Ses policies n'exigeaient que
--    `auth.uid() IS NOT NULL` — donc tout utilisateur connecté, TOUTE org
--    confondue, pouvait lire/écrire/supprimer. Le module director_* n'existe
--    pas en prod (aucune table `director_*`, bucket à 0 objet).
-- 2. EXECUTE accordé à `anon` sur 2 fonctions SECURITY DEFINER. Non exploitable
--    (rpc_list_invoices vérifie has_org_membership(auth.uid(), ...) qui échoue
--    avec un uid NULL ; quote_line_items_sync_org est une fonction trigger, non
--    appelable via /rpc), mais le droit n'a aucune raison d'exister.
-- 3. 5 fonctions sans search_path épinglé. Aucune n'est SECURITY DEFINER, donc
--    le risque de détournement est théorique — on aligne par cohérence avec les
--    306 autres fonctions du schéma, qui sont toutes épinglées.
--
-- Idempotent : rejouable sans effet de bord.

-- ============================================================
-- 1. Neutralisation du bucket orphelin `director-panel`
-- ============================================================
-- Retirer les policies suffit à fermer le trou : sans policy, RLS refuse tout
-- accès au bucket. La suppression du bucket lui-même NE PEUT PAS se faire en
-- SQL — `storage.protect_delete()` lève
--   "Direct deletion from storage tables is not allowed. Use the Storage API"
-- Le bucket (vide) se supprime via le dashboard Storage ou l'API Storage.
DROP POLICY IF EXISTS director_storage_select ON storage.objects;
DROP POLICY IF EXISTS director_storage_insert ON storage.objects;
DROP POLICY IF EXISTS director_storage_update ON storage.objects;
DROP POLICY IF EXISTS director_storage_delete ON storage.objects;

-- ============================================================
-- 2. Révocation de l'EXECUTE hérité de PUBLIC
-- ============================================================
-- ATTENTION : `REVOKE ... FROM anon` seul est INOPÉRANT ici. L'ACL de ces
-- fonctions était `=X/postgres`, c'est-à-dire EXECUTE accordé à PUBLIC — le
-- pseudo-rôle dont `anon` hérite. Il faut révoquer à PUBLIC, puis re-accorder
-- nommément aux seuls rôles légitimes.

-- rpc_list_invoices : l'app authentifiée en a besoin ; la fonction fait
-- elle-même son contrôle has_org_membership(auth.uid(), v_org).
REVOKE ALL ON FUNCTION public.rpc_list_invoices(
  text, text, text, text, integer, integer, date, date, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_list_invoices(
  text, text, text, text, integer, integer, date, date, uuid, uuid
) TO authenticated, service_role;

-- quote_line_items_sync_org : fonction trigger. Un trigger s'exécute sous
-- l'identité du propriétaire de la table et ne passe pas par l'ACL du rôle
-- appelant — le trigger trg_quote_line_items_sync_org reste donc fonctionnel.
REVOKE ALL ON FUNCTION public.quote_line_items_sync_org()
  FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. Épinglage du search_path
-- ============================================================
-- ALTER FUNCTION (et non CREATE OR REPLACE) : le corps, le propriétaire et les
-- privilèges sont préservés — aucun risque de réintroduire une version périmée
-- du code (cf. le bug `search_global` documenté dans CLAUDE.md).

-- Appelée par enforce_zone_exclusivity() (public). IMMUTABLE, aucun accès table.
ALTER FUNCTION public._point_in_zone_ring(double precision, double precision, jsonb)
  SET search_path = public, pg_temp;

-- Appelée par ac_track_quotes/invoices/payments() (public). SQL pur.
ALTER FUNCTION public.ac_fmt_dollars(integer)
  SET search_path = public, pg_temp;

-- Trigger actif sur quote_line_items. Ne lit que les colonnes de NEW.
ALTER FUNCTION public.quote_line_items_set_total()
  SET search_path = public, pg_temp;

-- Orphelines (0 trigger attaché — la table `leads` a été supprimée).
-- `app` est en tête car leads_force_org_id appelle app.current_org_id(), qui
-- est DISTINCTE de public.current_org_id() : épingler `public` seul la casserait.
ALTER FUNCTION app.leads_set_user_id()
  SET search_path = app, public, pg_temp;

ALTER FUNCTION app.leads_force_org_id()
  SET search_path = app, public, pg_temp;
