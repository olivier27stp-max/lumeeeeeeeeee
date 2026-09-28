-- ═══════════════════════════════════════════════════════════════
-- Facture consultée par le client — même mécanique que la soumission
-- (20260929210000_soumission_ouverte.sql, `enregistrer_vue_soumission`).
--
-- ADDITIF SEULEMENT : une fonction et un index. Aucune colonne ajoutée,
-- modifiée ou retirée ; les colonnes de vue existent déjà sur `invoices`
-- (is_viewed, viewed_at, last_viewed_at, view_count) et `quote_views`
-- porte déjà invoice_id, org_id, is_first_view, user_agent_hash,
-- session_hash.
--
-- Appelée par server/lib/vuesFacture.ts, et seulement pour une entreprise
-- qui a le drapeau `auto_consultation_documents`. Sans lui, la route garde
-- l'ancien suivi (qui compte chaque chargement).
--
-- Loi 25 : aucune IP, aucun navigateur en clair — deux empreintes.
-- ═══════════════════════════════════════════════════════════════

begin;

-- Le dédoublonnage « même session, 30 minutes » lit cet index.
create index if not exists idx_quote_views_dedup_facture
  on public.quote_views (invoice_id, session_hash, viewed_at desc)
  where invoice_id is not null;

/*
 * Enregistre UNE vue d'une facture, atomiquement (verrou de ligne) :
 *   · 'introuvable' si la facture n'existe pas (ou est supprimée) ;
 *   · 'exclue' si l'appelant a déjà écarté la vue (p_compter = false) ;
 *   · 'doublon' si la même session l'a ouverte il y a moins de 30 min ;
 *   · sinon : compteurs mis à jour, ligne de vue écrite, et on rend si
 *     c'est la PREMIÈRE vue et le nombre total.
 */
create or replace function public.enregistrer_vue_facture(
  p_invoice_id uuid,
  p_session_hash text,
  p_user_agent_hash text,
  p_compter boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_f record;
  v_premiere boolean;
  v_nb integer;
begin
  select id, org_id, client_id, is_viewed, view_count
    into v_f
  from public.invoices
  where id = p_invoice_id and deleted_at is null
  for update;

  if v_f.id is null then
    return jsonb_build_object('enregistree', false, 'raison', 'introuvable');
  end if;
  if not p_compter then
    return jsonb_build_object('enregistree', false, 'raison', 'exclue');
  end if;

  if p_session_hash is not null and exists (
    select 1 from public.quote_views
    where invoice_id = p_invoice_id and session_hash = p_session_hash
      and viewed_at > now() - interval '30 minutes'
  ) then
    return jsonb_build_object('enregistree', false, 'raison', 'doublon');
  end if;

  v_premiere := not coalesce(v_f.is_viewed, false);
  v_nb := coalesce(v_f.view_count, 0) + 1;

  update public.invoices
  set is_viewed = true,
      viewed_at = case when v_premiere then now() else viewed_at end,
      last_viewed_at = now(),
      view_count = v_nb
  where id = p_invoice_id;

  insert into public.quote_views (invoice_id, client_id, org_id, viewed_at, is_first_view, user_agent_hash, session_hash)
  values (p_invoice_id, v_f.client_id, v_f.org_id, now(), v_premiere, p_user_agent_hash, p_session_hash);

  return jsonb_build_object(
    'enregistree', true, 'premiere', v_premiere, 'nb_vues', v_nb,
    'org_id', v_f.org_id, 'contact_id', v_f.client_id);
end;
$fn$;

-- SECURITY DEFINER : réservée au serveur (service_role). Révoquer PUBLIC ne
-- suffit pas avec les défauts Supabase — anon et authenticated nommément.
revoke all on function public.enregistrer_vue_facture(uuid, text, text, boolean) from public, anon, authenticated;

commit;
