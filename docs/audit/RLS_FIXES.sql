-- ============================================================================
-- RLS_FIXES.sql — CORRECTIFS PROPOSÉS. **NON APPLIQUÉS.**
--
-- Cible : projet Supabase bbzcuzqfgsdvjsymfwmr (production)
-- Généré le 2026-07-31 par l'audit docs/audit/AUDIT_FINDINGS.md
--
-- NE PAS EXÉCUTER CE FICHIER D'UN BLOC.
-- Chaque vague est indépendante et se déploie SÉPARÉMENT, dans l'ordre donné
-- (risque croissant), avec une vérification entre chaque.
--
-- Principes appliqués (techniques non destructives) :
--   * aucune policy existante n'est supprimée dans la première vague ;
--   * on AJOUTE une garde, on ne réécrit pas la logique métier ;
--   * aucun `alter column type`, aucun `drop` de colonne ;
--   * chaque bloc a son rollback immédiatement à sa suite.
--
-- AVANT TOUTE APPLICATION : confirmer que le PITR est actif et noter l'heure.
-- ============================================================================


-- ============================================================================
-- VAGUE 1 — P0-1 : fermer la lecture cross-org de list_archived_items
-- ============================================================================
-- Finding      : AUDIT_FINDINGS.md §1 P0-1
-- Risque       : TRÈS FAIBLE. On ajoute 3 lignes de garde en tête d'une
--                fonction de lecture. La signature, le type de retour et les
--                droits sont inchangés.
-- Impact app   : AUCUN sur le parcours légitime. src/lib/archiveApi.ts:27
--                appelle la fonction avec le client Supabase *de l'utilisateur*,
--                donc auth.uid() est renseigné et l'utilisateur est bien membre
--                de l'org qu'il consulte → la garde passe.
--                Va casser : tout appel authentifié portant l'org_id d'une
--                AUTRE organisation — c'est exactement l'attaque.
-- Choix assumé : quand auth.uid() est NULL (appel service_role côté serveur),
--                on laisse passer, pour ne rien casser côté serveur. Aucun
--                appel serveur n'a été trouvé aujourd'hui, mais cette forme est
--                celle déjà retenue ailleurs dans le schéma
--                (cf. enforce_membership_role_change) et évite toute régression.
--                Si l'on veut la version stricte, remplacer la condition par :
--                   if auth.uid() is null or not public.has_org_membership(...)
--
-- ⚠️ Le corps ci-dessous DOIT être la copie exacte du corps actuellement en
--    production, avec la seule garde ajoutée. Le corps de référence provient de
--    20260705000000_eliminate_leads_table.sql:739-781. **AVANT d'exécuter,
--    vérifier que la production n'a pas divergé** (voir P2-2 : has_org_role
--    existe en prod sans migration) :
--       select prosrc from pg_proc where proname = 'list_archived_items';

create or replace function public.list_archived_items(p_org_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clients jsonb;
  v_leads jsonb;
  v_jobs jsonb;
begin
  -- ── GARDE AJOUTÉE (P0-1) ────────────────────────────────────────────────
  -- Sans ceci, la fonction sert les archives de n'importe quelle organisation
  -- à quiconque connaît son UUID. SECURITY DEFINER s'exécutant sous `postgres`
  -- (rolbypassrls = true), la RLS ne protège PAS l'intérieur de ce corps.
  if auth.uid() is not null
     and not public.has_org_membership(auth.uid(), p_org_id) then
    raise exception 'Not authorized for this organization.' using errcode = '42501';
  end if;
  -- ────────────────────────────────────────────────────────────────────────

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'type', 'client',
    'name', concat_ws(' ', c.first_name, c.last_name),
    'company', c.company, 'email', c.email, 'status', c.status,
    'archived_at', c.archived_at, 'archived_by', c.archived_by
  ) order by c.archived_at desc), '[]'::jsonb)
  into v_clients
  from public.clients c
  where c.org_id = p_org_id and c.archived_at is not null and coalesce(c.status, '') <> 'lead';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'type', 'lead',
    'name', concat_ws(' ', l.first_name, l.last_name),
    'company', l.company, 'email', l.email, 'status', l.lead_status,
    'archived_at', l.archived_at, 'archived_by', l.archived_by
  ) order by l.archived_at desc), '[]'::jsonb)
  into v_leads
  from public.clients l
  where l.org_id = p_org_id and l.archived_at is not null and l.status = 'lead';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'type', 'job',
    'name', coalesce(j.title, 'Job #' || j.job_number),
    'client_name', j.client_name, 'status', j.status, 'job_number', j.job_number,
    'archived_at', j.archived_at, 'archived_by', j.archived_by
  ) order by j.archived_at desc), '[]'::jsonb)
  into v_jobs
  from public.jobs j
  where j.org_id = p_org_id and j.archived_at is not null;

  return jsonb_build_object('clients', v_clients, 'leads', v_leads, 'jobs', v_jobs);
end;
$$;

comment on function public.list_archived_items(uuid) is
  'P0-1 (audit 2026-07-31) — garde d''appartenance obligatoire : SECURITY DEFINER '
  's''exécute sous postgres (rolbypassrls), la RLS ne protège pas l''intérieur.';

-- VÉRIFICATION (à faire immédiatement après, connecté comme un utilisateur normal) :
--   select public.list_archived_items('<son propre org_id>');   -- doit fonctionner
--   select public.list_archived_items('<un autre org_id>');     -- doit lever 42501

-- ROLLBACK VAGUE 1 : réappliquer le corps sans le bloc « GARDE AJOUTÉE ».
-- (Conserver au préalable la sortie de :
--    select prosrc from pg_proc where proname = 'list_archived_items';)


-- ============================================================================
-- VAGUE 2 — P1-1 : borner la revendication d'une organisation sans membre
-- ============================================================================
-- Finding    : AUDIT_FINDINGS.md §1 P1-1 (12 orgs sur 31 revendicables)
-- Risque     : MOYEN — touche le parcours d'inscription. À tester d'abord sur
--              une branche Supabase, avec une inscription complète de bout en bout.
-- Impact app : la branche « bootstrap » reste nécessaire (le premier membre
--              doit pouvoir se créer). On ne la supprime pas : on la BORNE dans
--              le temps. Va casser : la revendication d'une organisation créée
--              il y a plus de 24 h — c'est-à-dire l'attaque, mais AUSSI la
--              récupération d'une inscription abandonnée, qui devra passer par
--              le support.
--
-- ⚠️ PRÉREQUIS À MESURER AVANT D'APPLIQUER :
--    a) le délai réel entre la création d'une org et l'insertion du premier
--       membre dans le parcours d'inscription (si > 24 h, ajuster l'intervalle) ;
--    b) le sort des 12 organisations actuellement sans membre : ce correctif
--       les rend définitivement non revendicables. Décider AVANT s'il faut les
--       purger ou les rattacher.
--       Requête de décompte (lecture seule) :
--         select count(*) from public.orgs o
--          where not exists (select 1 from public.memberships m where m.org_id = o.id);

-- Étape 2a — backstop RESTRICTIVE : n'ÉLARGIT rien, ne fait que restreindre.
-- Une policy `as restrictive` s'ajoute en ET aux policies existantes : c'est le
-- changement le plus sûr possible, il ne peut qu'enlever de l'accès.
create policy memberships_bootstrap_window on public.memberships
  as restrictive
  for insert to authenticated
  with check (
    -- Cas normal : un admin de l'org ajoute un membre → non concerné.
    public.has_org_admin_role(auth.uid(), org_id)
    -- Cas bootstrap : toléré uniquement sur une organisation récente.
    or exists (
      select 1 from public.orgs o
       where o.id = org_id
         and o.created_at > now() - interval '24 hours'
    )
  );

-- VÉRIFICATION : créer un compte de bout en bout sur une branche Supabase et
-- confirmer que l'inscription aboutit toujours.

-- ROLLBACK VAGUE 2 :
--   drop policy if exists memberships_bootstrap_window on public.memberships;


-- ============================================================================
-- VAGUE 3 — P2-1 : ne plus divulguer l'UUID d'organisation publiquement
-- ============================================================================
-- ⚠️ CE CORRECTIF N'EST PAS DU SQL. Il est ici pour mémoire car il casse la
--    racine commune de P0-1 et P1-1.
--
-- Fichier   : server/routes/request-forms.ts:351
-- Actuel    : return res.json({ url: pub.publicUrl, path });
-- Proposé   : return res.json({ url: pub.publicUrl });
-- Impact    : vérifier d'abord si un appelant utilise `path`. Recherche à faire
--             dans src/ (composant de formulaire public) avant de retirer le champ.
-- Risque    : FAIBLE si `path` est inutilisé côté client ; sinon, remplacer par
--             un identifiant opaque.


-- ============================================================================
-- VAGUE 4 — P3-3 : restreindre les colonnes de `plans` exposées à `anon`
-- ============================================================================
-- Risque     : FAIBLE. La RLS ne filtre QUE des lignes, jamais des colonnes :
--              il faut donc passer par les privilèges de colonne.
-- Impact app : va casser toute page publique qui lirait les colonnes retirées.
--              À VÉRIFIER AVANT : rechercher l'usage de max_clients /
--              max_jobs_per_month / stripe_intro_coupon_id_* dans src/.
--              Les plafonds sont vraisemblablement affichés sur la page
--              tarifaire — dans ce cas, ne retirer QUE les coupons.

-- revoke select on public.plans from anon;
-- grant select (
--   id, slug, name, name_fr,
--   monthly_price_usd, monthly_price_cad, yearly_price_usd, yearly_price_cad,
--   features, is_active, sort_order, seats_included,
--   extra_seat_price_usd, extra_seat_price_cad,
--   includes_sms, includes_ai, includes_d2d, includes_courses, includes_api,
--   includes_automations, includes_timesheets, includes_request_forms,
--   includes_marketplace,
--   stripe_product_id,
--   stripe_monthly_price_id_usd, stripe_monthly_price_id_cad,
--   stripe_yearly_price_id_usd, stripe_yearly_price_id_cad,
--   included_offices, extra_office_price_usd, extra_office_price_cad,
--   intro_months, intro_price_monthly_usd, intro_price_monthly_cad,
--   intro_price_yearly_usd, intro_price_yearly_cad
-- ) on public.plans to anon;

-- ROLLBACK VAGUE 4 :
--   revoke select on public.plans from anon;
--   grant select on public.plans to anon;


-- ============================================================================
-- VAGUE 5 — P2-3 : brancher les sondes d'invariants (elles ne tournent jamais)
-- ============================================================================
-- Constat : les 7 sondes check_* créées le 30 juillet n'ont AUCUN appelant dans
--           le dépôt. Leur exécution pendant cet audit est vraisemblablement la
--           première. Une sonde non planifiée ne détecte rien.
-- Risque  : FAIBLE — ajoute une tâche de lecture seule.
-- Prérequis : confirmer que pg_cron est disponible et que la fonction de
--             notification existe. À NE PAS appliquer tel quel sans avoir
--             décidé OÙ part l'alerte (sinon on recrée un cron muet, exactement
--             le problème que check_failing_cron_jobs est censé détecter).

-- select cron.schedule(
--   'invariants-nightly', '17 4 * * *',
--   $$ select * from public.check_all_invariants() where failures > 0 $$
-- );

-- ROLLBACK VAGUE 5 :
--   select cron.unschedule('invariants-nightly');


-- ============================================================================
-- NON PROPOSÉ ICI — délibérément
-- ============================================================================
-- * Doublons clients (P3-1) : aucune requête de fusion n'est fournie. Fusionner
--   deux fiches engage jobs, devis, factures et paiements : c'est une décision
--   métier, pas un UPDATE. Toute requête automatique ici ferait des dégâts.
--
-- * Retrait des 113 tables vides de l'exposition PostgREST (P3-2) : nécessite
--   de savoir lesquelles sont des fonctionnalités à venir et lesquelles sont
--   mortes. Décision produit.
--
-- * Correctifs sur les policies, les vues sans security_invoker, les
--   contraintes NOT VALID : IMPOSSIBLE À RÉDIGER de façon sûre tant que le
--   catalogue n'a pas été lu (voir AUDIT_FINDINGS.md §4). Écrire du SQL
--   correctif contre un schéma qu'on n'a pas pu observer est précisément la
--   manière de casser la production.
