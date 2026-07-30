-- ═══════════════════════════════════════════════════════════════
-- Audit sécurité 2026-07-30 — fermeture des écritures client
--
-- Ces correctifs ont été appliqués directement en production via
-- l'API Supabase. Cette migration les consigne pour qu'ils survivent
-- à un `db reset` et soient reproductibles sur un nouvel environnement.
-- Sans elle, une policy corrigée à chaud disparaît au prochain reset —
-- c'est exactement comme ça qu'une table repart sans protection.
--
-- Toutes les instructions sont idempotentes.
-- ═══════════════════════════════════════════════════════════════


-- ── 1. VOL DE PLAN (critique) ─────────────────────────────────
--
-- `subscriptions` portait une policy "Own data only" en FOR ALL avec
--   using (auth.uid() = user_id)  et aucun WITH CHECK.
-- FOR ALL couvre INSERT/UPDATE/DELETE : n'importe quel client connecté
-- pouvait exécuter depuis son navigateur
--   update subscriptions set plan_id='<Enterprise>', status='active',
--          extra_seats=999, current_period_end='2099-01-01'
--   where user_id = auth.uid()
-- et s'octroyer le forfait le plus cher, gratuitement, sans passer par
-- Stripe. amount_cents, extra_offices et scheduled_plan_id étaient aussi
-- modifiables. C'était le modèle d'affaires ouvert en écriture.
--
-- L'abonnement est une projection de l'état Stripe : seul le chemin
-- webhook doit l'écrire, et il utilise service_role (qui contourne la
-- RLS et n'est donc pas affecté). Vérifié avant fermeture : aucune
-- écriture depuis src/, aucune RPC front sur l'abonnement, toutes les
-- écritures serveur passent par `admin` dans server/routes/billing.ts.

drop policy if exists "Own data only" on public.subscriptions;

-- Couvre l'abonnement personnel créé avant le rattachement à une org,
-- que subscriptions_select (via has_org_membership) ne voit pas.
drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Défense en profondeur : même si une policy permissive réapparaissait,
-- le rôle n'a plus le privilège d'écrire.
revoke insert, update, delete on public.subscriptions from authenticated, anon;


-- ── 2. TENANT HOPPING via UPDATE sans WITH CHECK ──────────────
--
-- Sans WITH CHECK, Postgres réutilise USING pour valider la nouvelle
-- ligne. USING contraint la ligne AVANT modification ; il ne dit rien
-- de la ligne APRÈS. Un membre pouvait donc déplacer ses lignes vers
-- une autre organisation :
--   update scheduled_reports set org_id='<autre org>' where id='<le mien>'
--
-- Les prédicats ci-dessous reprennent exactement ceux de USING : aucun
-- accès légitime n'est retiré, seule l'écriture cross-org est fermée.

alter policy automation_rules_update_org on public.automation_rules
  with check (org_id in (
    select m.org_id from public.memberships m
    where m.user_id = (select auth.uid())
  ));

alter policy email_templates_update_org on public.email_templates
  with check (org_id in (
    select m.org_id from public.memberships m
    where m.user_id = (select auth.uid())
  ));

alter policy scheduled_reports_update_org on public.scheduled_reports
  with check (public.has_org_membership((select auth.uid()), org_id));

-- Scopée par utilisateur : la nouvelle ligne doit rester la sienne,
-- sinon on réassigne sa session de terrain à quelqu'un d'autre.
alter policy fs_field_sessions_update on public.fs_field_sessions
  with check (user_id = (select auth.uid()));

-- Ces deux tables n'ont pas d'org_id mais référencent un parent qui en a
-- un : le hop se faisait en changeant note_id / challenge_id.
alter policy notes_checklist_update on public.notes_checklist
  with check (note_id in (
    select n.id from public.notes n
    where n.org_id in (
      select m.org_id from public.memberships m
      where m.user_id = (select auth.uid())
    )
  ));

alter policy fs_challenge_participants_update on public.fs_challenge_participants
  with check (challenge_id in (
    select c.id from public.fs_challenges c
    where c.org_id in (
      select m.org_id from public.memberships m
      where m.user_id = (select auth.uid())
        and m.role = any (array['owner','admin'])
    )
  ));


-- ── 3. JETONS OAUTH ET STATUT STRIPE ──────────────────────────
--
-- `app_connections` contient encrypted_access_token, encrypted_refresh_token
-- et encrypted_credentials — les jetons QuickBooks entre autres. Un membre
-- pouvait les LIRE (chiffrés, mais exfiltrables pour cassage hors-ligne) et
-- surtout les ÉCRIRE : injecter un jeton qu'il contrôle pour détourner une
-- intégration, ou effacer ceux d'un collègue.
--
-- `connected_accounts.charges_enabled` est la projection de l'état Stripe.
-- Un admin d'org pouvait se déclarer « paiements actifs » sans avoir
-- complété l'onboarding, ce qui fait mentir la carte Stripe du marketplace
-- et laisse tenter des encaissements voués à l'échec.
--
-- Les deux tables sont servies exclusivement par l'API Express en
-- service_role — vérifié : aucun accès direct depuis src/.

revoke insert, update, delete on public.app_connections    from authenticated, anon;
revoke insert, update, delete on public.connected_accounts from authenticated, anon;

-- La RLS filtre les LIGNES, jamais les COLONNES : un GRANT SELECT au
-- niveau table couvre tout et prime sur un revoke par colonne. Il faut
-- retirer le grant global puis ré-accorder colonne par colonne.
revoke select on public.app_connections from authenticated, anon;

grant select (
  id, org_id, app_id, status, auth_type,
  connected_account_name, connected_account_id, scopes_granted,
  connected_at, disconnected_at, last_tested, last_test_result,
  last_error, error_message, token_expires_at,
  connected_by, created_at, updated_at
) on public.app_connections to authenticated;


-- ── 4. FONCTIONS SECURITY DEFINER OUVERTES À anon ─────────────
--
-- Rappel du contexte (correctif principal : 20260729120000).
-- La RLS ne s'applique pas aux fonctions : une fonction SECURITY DEFINER
-- s'exécute avec les droits de son propriétaire et voit donc toutes les
-- organisations. Supabase accorde EXECUTE par défaut sur tout nouvel objet
-- de public, si bien que 17 RPC étaient appelables SANS ÊTRE CONNECTÉ.
--
-- Le revoke doit viser PUBLIC et pas seulement anon : l'ACL de ces
-- fonctions commence par "=X/postgres", un grant au pseudo-rôle PUBLIC qui
-- englobe anon sans le nommer. Une première passe sur anon seul n'avait
-- rien changé.
--
-- Répété ici en filet : si une fonction est recréée par une migration
-- ultérieure, elle repart avec les grants par défaut.

do $$
declare fn record; n int := 0;
begin
  for fn in
    select quote_ident(n2.nspname) || '.' || quote_ident(p.proname)
             || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
    from pg_proc p
    join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public'
      and p.prosecdef
      and pg_get_function_result(p.oid) <> 'trigger'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from anon',   fn.sig);
    execute format('revoke execute on function %s from public', fn.sig);
    n := n + 1;
  end loop;
  raise notice 'EXECUTE révoqué sur % fonction(s) SECURITY DEFINER', n;
end $$;

-- Correctif structurel : sans ceci, la prochaine fonction ajoutée repart
-- exposée et le durcissement s'érode au prochain merge.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;
