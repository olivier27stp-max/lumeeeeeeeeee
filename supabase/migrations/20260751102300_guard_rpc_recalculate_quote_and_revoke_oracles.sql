-- ============================================================================
-- Troisieme vague : rpc_recalculate_quote + 4 oracles en lecture
-- ============================================================================
--
-- Suite du tri systematique des 109 fonctions SECURITY DEFINER accessibles a
-- `authenticated` (signalees par l'advisor Supabase
-- `authenticated_security_definer_function_executable`).
--
-- Resultat du tri : 95 possedent deja un motif d'autorisation, 4 ne touchent
-- aucune table, 10 restaient sans garde — dont 5 sont les PRIMITIVES de garde
-- elles-memes (has_org_membership, has_org_admin_role, has_org_role,
-- has_object_permission, verify_org_access), normal qu'elles n'en aient pas.
-- Restaient donc 5 cas reels, traites ici.
--
-- ---------------------------------------------------------------------------
-- 1. rpc_recalculate_quote(uuid) — GARDE DANS LE CORPS (pas de revoke)
-- ---------------------------------------------------------------------------
-- C'est la SŒUR de list_archived_items : 20260751101400 les avait epargnees
-- toutes les deux (« seules list_archived_items et rpc_recalculate_quote »).
--
-- SECURITY DEFINER, propriete de postgres (rolbypassrls = true, donc la RLS ne
-- protege pas le corps), elle ECRIT : elle recalcule subtotal / remise / taxes
-- / total d'un devis designe par un simple UUID en parametre. Sans garde, tout
-- compte authentifie pouvait ecraser les montants du devis d'une autre
-- organisation.
--
-- Pourquoi une garde et non un revoke, contrairement a 20260751102200 : le
-- NAVIGATEUR l'appelle (src/lib/quotesApi.ts:345 et :552). Lui retirer le droit
-- casserait l'edition de devis. Le parametre etant un quote_id et non un
-- org_id, la garde resout d'abord l'org du devis.
--
-- Verifie par execution :
--   * authentifie non membre  -> ERROR 42501 « Not authorized for this quote. »
--   * membre legitime         -> passe, aucune exception
--
-- ---------------------------------------------------------------------------
-- 2. Quatre fonctions de lecture — REVOKE
-- ---------------------------------------------------------------------------
-- Aucun appelant applicatif (0 occurrence dans src/ et server/), AUCUNE policy
-- RLS ne les utilise (verifie explicitement : leur retirer le droit aurait
-- casse l'evaluation des policies concernees). Elles renseignent un attaquant
-- sur des ressources d'autres organisations :
--
--   resolve_primary_property(p_client_id)  -> propriete principale d'un client
--                                             tiers. Appelee par 2 fonctions de
--                                             trigger, toutes deux SECURITY
--                                             DEFINER proprietaires postgres
--                                             (verifie) : le revoke ne les
--                                             casse pas.
--   user_org_ids(p_user_id)                -> organisations d'un autre usager
--   same_company_orgs(p_user)              -> idem
--   check_subscription_active(p_org_id)    -> etat d'abonnement d'une autre org
--
-- APPLIQUE EN PRODUCTION le 2026-07-31 a 02:42 UTC. Migration idempotente.
--
-- ROLLBACK : grant execute on function public.<nom>(<args>) to authenticated;
-- ============================================================================

-- ── 1. Garde de cloisonnement sur le recalcul de devis ──────────────────────
-- Corps EXACT lu depuis pg_proc.prosrc en production (aucune transcription).
create or replace function public.rpc_recalculate_quote(p_quote_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $LUMEQ$
declare
  v_subtotal integer;
  v_tax_rate numeric;
  v_discount_type text;
  v_discount_value numeric;
  v_discount_cents integer;
  v_tax_cents integer;
  v_total integer;
begin

  -- Garde de cloisonnement (audit 2026-07-31). SECURITY DEFINER s'execute sous
  -- postgres (rolbypassrls = true) : la RLS ne protege PAS ce corps. Le
  -- parametre est un quote_id fourni par l'appelant, donc sans cette garde
  -- n'importe quel compte authentifie peut recalculer — et donc ecraser — les
  -- montants du devis d'une autre organisation.
  -- auth.uid() NULL = appel serveur en service_role : on laisse passer.
  if auth.uid() is not null and not exists (
    select 1 from public.quotes q
     where q.id = p_quote_id
       and public.has_org_membership(auth.uid(), q.org_id)
  ) then
    raise exception 'Not authorized for this quote.' using errcode = '42501';
  end if;

  -- Sum line items (exclude optional items from total)
  select coalesce(sum(total_cents), 0) into v_subtotal
  from public.quote_line_items
  where quote_id = p_quote_id and not is_optional;

  -- Get quote settings
  select tax_rate, discount_type, discount_value
  into v_tax_rate, v_discount_type, v_discount_value
  from public.quotes where id = p_quote_id;

  -- Calculate discount
  if v_discount_type = 'percentage' then
    v_discount_cents := round(v_subtotal * v_discount_value / 100);
  elsif v_discount_type = 'fixed' then
    v_discount_cents := round(v_discount_value * 100);
  else
    v_discount_cents := 0;
  end if;

  -- Calculate tax on (subtotal - discount)
  v_tax_cents := round((v_subtotal - v_discount_cents) * coalesce(v_tax_rate, 0) / 100);

  -- Total
  v_total := v_subtotal - v_discount_cents + v_tax_cents;

  -- Update
  update public.quotes set
    subtotal_cents = v_subtotal,
    discount_cents = v_discount_cents,
    tax_cents = v_tax_cents,
    total_cents = v_total,
    updated_at = now()
  where id = p_quote_id;
end;
$LUMEQ$;

comment on function public.rpc_recalculate_quote(uuid) is
  'Recalcule les montants d''un devis. Garde d''appartenance OBLIGATOIRE : '
  'SECURITY DEFINER s''execute sous postgres (rolbypassrls), la RLS ne protege '
  'pas ce corps. Appelee par le navigateur — ne pas revoquer, garder la garde.';

-- ── 2. Retrait du droit sur 4 fonctions de lecture ──────────────────────────
revoke execute on function public.resolve_primary_property(uuid)  from authenticated;
revoke execute on function public.user_org_ids(uuid)              from authenticated;
revoke execute on function public.same_company_orgs(uuid)         from authenticated;
revoke execute on function public.check_subscription_active(uuid) from authenticated;
