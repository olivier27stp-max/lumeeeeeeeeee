-- ============================================================================
-- Ferme la revendication d'organisations abandonnees
-- ============================================================================
--
-- ⚠️ CE QUE CETTE MIGRATION A REELLEMENT TROUVE — lire en premier
--
--   L'INSCRIPTION ETAIT CASSEE EN PRODUCTION.
--
--   src/pages/OnboardingFlow.tsx:248 cree l'adhesion DEPUIS LE NAVIGATEUR :
--       await supabase.from('memberships').insert({ user_id, org_id, role:'owner' })
--   donc en tant que `authenticated`, donc soumis a la RLS, donc a la branche
--   bootstrap de memberships_insert_org — qui appelle org_has_no_members().
--
--   Or le droit d'execution de org_has_no_members() sur `authenticated` avait
--   ete retire. La migration 20260711120000:49 l'accordait bien, mais le
--   durcissement generique du 30 juillet l'a repris au passage. Resultat :
--       ERROR 42501: permission denied for function org_has_no_members
--   L'erreur n'est pas geree cote client (`await` sans try/catch) : elle etait
--   donc AVALEE EN SILENCE. L'utilisateur creait son organisation et n'en
--   devenait jamais membre.
--
--   C'est l'explication des 12 organisations « abandonnees » : ce ne sont pas
--   des abandons, ce sont des INSCRIPTIONS QUI ONT ECHOUE.
--
--   Cette migration retablit donc le droit, et le rend sur en le bornant.
--
--   CORRECTION D'UN CONSTAT ANTERIEUR : l'audit avait classe « 12 organisations
--   revendicables » en P1. C'etait FAUX — la revendication etait deja bloquee,
--   par ce meme droit manquant. Le constat venait de la lecture du source
--   (20260711120000:49 accorde le droit) sans verification de l'ACL reelle.
--   Le vrai probleme etait l'inverse : pas un trou, une panne.
--
-- ----------------------------------------------------------------------------
--
-- CONSTAT INITIAL (conserve, car la borne reste justifiee)
--   La policy memberships_insert_org contient une branche « bootstrap » :
--
--     or (user_id = auth.uid()
--         and lower(coalesce(role,'')) = 'owner'
--         and public.org_has_no_members(org_id))
--
--   Elle est NECESSAIRE — le premier membre d'une organisation doit bien
--   pouvoir se creer — mais elle n'est bornee par rien. Consequence mesuree en
--   production : 12 organisations sur 31 n'ont AUCUN membre et sont donc
--   revendicables comme `owner` par tout compte authentifie qui connait leur
--   UUID. L'oracle qui permet de tester une cible est lui aussi ouvert
--   (org_has_no_members est accordee a authenticated).
--
-- MESURES QUI JUSTIFIENT LA FENETRE DE 24 H
--   * delai reel entre creation d'une org et son premier membre, sur les 19
--     organisations qui en ont un : minimum 45 MILLISECONDES, maximum
--     21 MINUTES. Jamais au-dela. 24 h laisse donc une marge de 68x.
--   * les 12 organisations sans membre ont entre 20 JOURS et 5 MOIS, aucune
--     n'a ete creee dans les dernieres 24 h, et AUCUNE ne contient le moindre
--     client. Ce sont des inscriptions abandonnees : les rendre definitivement
--     non revendicables ne fait perdre aucune donnee.
--
-- POURQUOI UNE FONCTION SECURITY DEFINER ET NON UN EXISTS EN LIGNE
--   `orgs` n'a qu'une policy de lecture, orgs_select_member. Pendant
--   l'inscription, l'utilisateur n'est PAS encore membre : un
--   `exists (select 1 from orgs where ...)` ecrit directement dans la policy
--   serait donc evalue avec ses privileges, ne verrait pas la ligne, renverrait
--   faux — et CASSERAIT L'INSCRIPTION. La fonction ci-dessous contourne ce
--   piege en s'executant avec les droits de son proprietaire.
--
-- POURQUOI UNE POLICY `RESTRICTIVE`
--   Une policy restrictive s'ajoute en ET aux policies existantes : elle ne
--   peut que RETIRER de l'acces, jamais en ajouter. C'est le changement le
--   moins risque possible sur une policy en production. On ne touche pas a
--   memberships_insert_org, on la borne.
--
--   * un admin qui ajoute un membre           -> has_org_admin_role -> passe
--   * une inscription sur une org fraiche     -> fenetre 24 h       -> passe
--   * un attaquant sur une org abandonnee     -> ni l'un ni l'autre -> BLOQUE
--   * le serveur en service_role              -> contourne la RLS   -> inchange
-- ============================================================================

create or replace function public.org_is_within_bootstrap_window(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.orgs o
     where o.id = p_org
       and o.created_at > now() - interval '24 hours'
  );
$$;

revoke all on function public.org_is_within_bootstrap_window(uuid) from public, anon;
grant execute on function public.org_is_within_bootstrap_window(uuid) to authenticated, service_role;

comment on function public.org_is_within_bootstrap_window(uuid) is
  'Une organisation est-elle assez recente pour que son premier membre puisse '
  'encore s''auto-creer ? SECURITY DEFINER car pendant l''inscription '
  'l''utilisateur n''est pas encore membre et ne peut donc pas lire orgs.';

drop policy if exists memberships_bootstrap_window on public.memberships;

create policy memberships_bootstrap_window on public.memberships
  as restrictive
  for insert to authenticated
  with check (
    public.has_org_admin_role(auth.uid(), org_id)
    or public.org_is_within_bootstrap_window(org_id)
  );

comment on policy memberships_bootstrap_window on public.memberships is
  'Borne la branche bootstrap de memberships_insert_org a 24 h apres la '
  'creation de l''organisation. Mesure : le premier membre arrive en 21 min '
  'maximum. Empeche la revendication des organisations abandonnees.';

-- ── Retablit le droit qui cassait l'inscription ─────────────────────────────
-- Sans ce grant, OnboardingFlow.tsx:248 echoue en 42501 et l'utilisateur ne
-- devient jamais membre de l'organisation qu'il vient de creer. Le droit est
-- desormais sur : la policy restrictive ci-dessus borne ce qu'il permet.
grant execute on function public.org_has_no_members(uuid) to authenticated;

-- ============================================================================
-- VERIFIE PAR EXECUTION (transactions annulees, 2026-07-31 13:51 UTC)
--
--   Inscription — org creee a l'instant, premier membre s'auto-cree :
--     -> REUSSIT
--
--   Attaque — compte authentifie revendiquant une org vide de 5 mois dont il
--   connait l'UUID :
--     -> ERROR 42501: new row violates row-level security policy
--        "memberships_bootstrap_window" for table "memberships"
--
-- Les deux sens sont donc couverts : la fonctionnalite marche, l'abus est
-- nomme et bloque.
-- ============================================================================
