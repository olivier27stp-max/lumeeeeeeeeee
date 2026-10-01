-- ═══════════════════════════════════════════════════════════════════════
-- Journaux de Lumi : plus lisibles par tout le bureau
-- (mission Lumi 2026-10-01, phase 3 — isolation et permissions)
--
-- FUITE PROUVÉE EN PRODUCTION le 2026-10-01, bureau de test, compte au rôle
-- TECHNICIEN, lecture directe par PostgREST :
--   • lumi_traces   : 75 lignes du PROPRIÉTAIRE — l'énoncé de ses questions
--     (« fais une facture a marc gagnon »), l'action, et cost_cents (un coût
--     en dollars, que le client ne doit jamais voir : seulement des crédits) ;
--   • agent_actions : les actions de Lumi du propriétaire, résultat compris
--     (dont la note « la marge cible sur les… » qu'il a fait retenir).
-- Les deux policies de lecture disaient : « être membre actif suffit ».
--
-- Ce que ça change :
--   1. lumi_traces devient réservée au serveur. Aucun code client ne la lit
--      (ni src/, ni mobile/) : le serveur l'écrit et la lit avec la clé de
--      service. Même traitement que ai_usage (migration des crédits).
--   2. agent_actions : chacun lit SES actions ; les rôles qui peuvent modifier
--      les réglages (propriétaire, admin) lisent celles du bureau — même clé
--      `settings.update` que la mémoire de Lumi. L'outil
--      get_recent_agent_actions lit avec le jeton de l'utilisateur : un
--      technicien n'y voit plus que ce que Lumi a fait POUR LUI.
--   3. Moindre privilège : anon n'a plus aucun droit sur agent_actions, et
--      authenticated n'y garde que la lecture (les écritures passent par la
--      clé de service ; aucune policy d'écriture n'existait de toute façon).
--
-- Rien n'est supprimé ni modifié dans les données.
-- ═══════════════════════════════════════════════════════════════════════
begin;

-- 1. lumi_traces : serveur seulement ─────────────────────────────────
drop policy if exists lumi_traces_select_membre on public.lumi_traces;
revoke all on public.lumi_traces from anon, authenticated;
comment on table public.lumi_traces is
  'Journal d''analyse de Lumi (énoncé normalisé, étage, outils, coût réel). Serveur seulement : aucune lecture client.';

-- 2. agent_actions : ses propres actions, ou tout le bureau pour qui gère les réglages ──
drop policy if exists agent_actions_select_membre on public.agent_actions;
create policy agent_actions_select_soi_ou_reglages
  on public.agent_actions
  for select
  to authenticated
  using (
    public.has_org_membership((select auth.uid()), org_id)
    and (
      user_id = (select auth.uid())
      or public.member_has_permission((select auth.uid()), org_id, 'settings.update')
    )
  );
comment on policy agent_actions_select_soi_ou_reglages on public.agent_actions is
  'Chacun lit ses actions Lumi ; propriétaire et admin (settings.update) lisent celles du bureau. Fuite prouvée le 2026-10-01 : un technicien lisait celles du propriétaire.';

-- 3. Moindre privilège ───────────────────────────────────────────────
revoke all on public.agent_actions from anon;
revoke insert, update, delete, truncate, references, trigger on public.agent_actions from authenticated;

commit;
