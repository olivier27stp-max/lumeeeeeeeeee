-- ═══════════════════════════════════════════════════════════════
-- Vague 3 (audit V2, « Journaux », Moyenne) — journaux d'exécution des
-- automatisations : un membre SANS droit sur les automatisations ne lit plus
-- ni les journaux qui ne concernent pas des prospects, ni les destinataires.
--
-- Constat (preuves/C/logs-sans.mjs) : un vendeur (sales_rep, `leads.read`,
-- pas `automations.read`) lisait 94 journaux send_email/send_sms de TOUT le
-- bureau, dont 31 avec l'adresse ou le téléphone du client
-- (`result_data.to`). Le bloc 4 (20261003100100) avait ouvert la table à
-- `leads.read` pour l'onglet « Relances » de la fiche d'un deal.
--
-- Une policy ne sait pas masquer une colonne selon le rôle, et le
-- propriétaire a besoin du destinataire dans l'onglet Journaux. Donc :
--   1. la table redevient réservée à « Voir les automatisations » ;
--   2. l'onglet « Relances » passe par `relances_du_deal(deal)` : seulement
--      les journaux de CE deal et de son contact (le prospect), seulement
--      des colonnes sans donnée de contact (ni action_config, ni
--      result_data), et `result_error` avec courriels et téléphones masqués.
--      Le deal doit être visible par l'appelant, avec les MÊMES conditions
--      que la policy `deals_select_org` (adhésion + pipeline visible) et
--      `bureau_actif`, plus « Voir les prospects » ou « Voir les
--      automatisations ».
--
-- Réversible : voir le bloc DOWN en fin de fichier.
-- ═══════════════════════════════════════════════════════════════

begin;

drop policy if exists automation_execution_logs_select_org on public.automation_execution_logs;
create policy automation_execution_logs_select_org
  on public.automation_execution_logs
  for select to authenticated
  using (member_has_permission((select auth.uid()), org_id, 'automations.read'::text));

create or replace function public.relances_du_deal(p_deal_id uuid)
returns table (
  id uuid,
  action_type text,
  result_success boolean,
  result_error text,
  trigger_event text,
  created_at timestamptz,
  entity_id uuid
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (
    select dl.id, dl.org_id, dl.client_id
    from public.deals dl
    where dl.id = p_deal_id
      and dl.deleted_at is null
      and public.has_org_membership(auth.uid(), dl.org_id)
      and public.peut_voir_pipeline(auth.uid(), dl.pipeline_id)
      and (
        public.member_has_permission(auth.uid(), dl.org_id, 'leads.read')
        or public.member_has_permission(auth.uid(), dl.org_id, 'automations.read')
      )
      and (public.bureau_actif_demande() is null or dl.org_id = public.bureau_actif_demande())
  )
  select
    l.id,
    l.action_type,
    l.result_success,
    -- « Frequency cap reached for x@y.com », « … +15145550101 » : le motif
    -- d'échec cite parfois le destinataire. Masqué.
    regexp_replace(
      regexp_replace(l.result_error, '[^[:space:]<>"'']+@[^[:space:]<>"'']+', '[courriel]', 'g'),
      '\+?1?[ (.-]*[0-9]{3}[ ).-]*[0-9]{3}[ .-]*[0-9]{4}', '[téléphone]', 'g'
    ) as result_error,
    l.trigger_event,
    l.created_at,
    l.entity_id
  from public.automation_execution_logs l
  join d on l.org_id = d.org_id
  where (l.entity_type = 'deal' and l.entity_id = d.id)
     or (l.entity_type in ('client', 'lead') and l.entity_id = d.client_id)
  order by l.created_at desc
  limit 50;
$$;

comment on function public.relances_du_deal(uuid) is
  'Onglet « Relances » d''un deal : journaux d''automatisation du deal et de son contact, sans donnée de contact. Audit V2 (vague 3).';

-- Supabase accorde EXECUTE à anon et authenticated sur chaque nouvelle
-- fonction : fermer anon nommément, ouvrir authenticated seulement.
revoke execute on function public.relances_du_deal(uuid) from public, anon;
grant execute on function public.relances_du_deal(uuid) to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════
-- DOWN :
--
-- begin;
-- drop function if exists public.relances_du_deal(uuid);
-- drop policy if exists automation_execution_logs_select_org on public.automation_execution_logs;
-- create policy automation_execution_logs_select_org on public.automation_execution_logs
--   for select to authenticated
--   using (
--     member_has_permission((select auth.uid()), org_id, 'automations.read'::text)
--     or member_has_permission((select auth.uid()), org_id, 'leads.read'::text)
--   );
-- commit;
-- ═══════════════════════════════════════════════════════════════
