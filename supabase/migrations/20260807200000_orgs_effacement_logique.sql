-- ═══════════════════════════════════════════════════════════════
--  Effacer une organisation — et le défaut qui l'en empêchait
--
--  Contexte : 45 des 46 orgs de la prod sont des déchets de scripts de
--  test (e2e-…, repro-…, « Test Lume Inc », « Playwright Test Org »).
--  Elles faussent tous les comptages du tableau de bord plateforme.
--
--  Les supprimer pour de vrai s'est révélé IMPOSSIBLE. Trois gardes,
--  rencontrés un par un en essai à blanc sur la prod :
--    1. audit_events est append-only (contournable par la porte prévue
--       app.audit_maintenance, faite pour les purges de rétention);
--    2. active_sessions.org_id et login_history.org_id sont en
--       ON DELETE SET NULL sur une colonne NOT NULL — insatisfiable;
--    3. un déclencheur écrit dans security_events en référençant l'org
--       en cours de suppression → violation de clé étrangère.
--
--  Forcer les trois aurait voulu dire désactiver le journal d'audit ET
--  les traces de sécurité de la production. Mauvais échange pour un
--  ménage. Le reste du projet efface logiquement (deleted_at partout);
--  `orgs` était la seule table importante à ne pas le faire.
--
--  Cette migration corrige le point 2 (défaut réel, insatisfiable par
--  construction) mais le point 3 subsiste : après correction, une org
--  avec des sessions reste impossible à supprimer. Éprouvé sur staging.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. L'effacement logique, comme partout ailleurs ──
alter table public.orgs
  add column if not exists deleted_at timestamptz;

create index if not exists idx_orgs_deleted_at
  on public.orgs (deleted_at) where deleted_at is null;

comment on column public.orgs.deleted_at is
  'Effacement logique. Non nul = org retirée des listes et des comptages. '
  'orgs ne peut pas être supprimée physiquement (audit append-only + traces '
  'de sécurité) — voir la migration 20260807200000.';

-- ── 2. Le défaut de clé étrangère ──
--
-- ON DELETE SET NULL sur une colonne NOT NULL ne peut jamais aboutir : la
-- cascade tente d'écrire NULL et se heurte à la contrainte. CASCADE est le
-- bon comportement — une session ou un historique de connexion n'a aucun sens
-- sans son organisation.
--
-- ATTENTION : cette correction ne rend PAS la suppression possible pour
-- autant. Vérifié sur staging après coup, avec une org portant sessions et
-- historique : ça bloque toujours plus loin. Un déclencheur sur `memberships`
-- écrit dans security_events pendant la cascade, en référençant l'org qu'on
-- est justement en train d'effacer. Débloquer ça demande de revoir ce
-- déclencheur (security_events.org_id est nullable — il pourrait s'en passer),
-- ce qui touche la journalisation de sécurité et sort du cadre de ce ménage.
-- On corrige ici un défaut réel; l'effacement logique plus bas reste la
-- réponse au problème.
do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'active_sessions_org_id_fkey' and confdeltype = 'n') then
    alter table public.active_sessions drop constraint active_sessions_org_id_fkey;
    alter table public.active_sessions
      add constraint active_sessions_org_id_fkey
      foreign key (org_id) references public.orgs(id) on delete cascade;
  end if;

  if exists (select 1 from pg_constraint
             where conname = 'login_history_org_id_fkey' and confdeltype = 'n') then
    alter table public.login_history drop constraint login_history_org_id_fkey;
    alter table public.login_history
      add constraint login_history_org_id_fkey
      foreign key (org_id) references public.orgs(id) on delete cascade;
  end if;
end $$;

-- ── 3. Retirer les organisations de test ──
--
-- Sélection par NOM, pas par « org vide » : une vraie entreprise qui vient de
-- s'inscrire est vide elle aussi. L'org réelle est exclue nommément, en plus
-- du filtre, pour que ce fichier reste sûr même rejoué ailleurs.
update public.orgs set deleted_at = now()
where deleted_at is null
  and id <> '4d885f6c-e076-4ed9-ab09-23637dbee6cd'  -- Coquin lavage
  and (
       name ~* '(^|[^a-z])(e2e|repro|smoke|playwright|qa)([^a-z]|$)'
    or name ~* '^(test|lume-test|verif|zz )'
    or name ~* 'test lume'
    or name ~* '^workspace [0-9a-f]{8}$'
    or name ~* '[0-9]{10,}'                          -- horodatage collé au nom
    or name in ('dfbxvvb', 'PostPay Co', 'Visionlavage', 'VisionLavage')
  );
