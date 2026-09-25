-- ═══════════════════════════════════════════════════════════════
-- Moindre privilège — deals_deduire_statut()
--
-- Le banc RLS a signalé : « ANON can execute SECURITY DEFINER
-- deals_deduire_statut() ». C'est le piège déjà documenté par
-- 20260729120000 et re-constaté le 2026-09-09 : un `create or replace`
-- repart avec les DEFAULT PRIVILEGES de Supabase, qui accordent EXECUTE
-- à anon. La migration 20260923200000 qui a créé cette fonction de
-- trigger a simplement omis la ligne de révocation que ses voisines ont
-- (deals_horodater_etape, deals_ecrire_historique, deals_verifier_etape…
-- sont toutes déjà à anon=false).
--
-- Exploitabilité réelle : nulle. Postgres refuse d'appeler une fonction
-- qui retourne `trigger` hors d'un contexte de trigger, donc le grant ne
-- donne rien à personne — c'est d'ailleurs pourquoi le balayage du
-- 2026-09-09 excluait les triggers de sa boucle.
--
-- On révoque quand même, pour deux raisons : le banc RLS ne fait pas
-- cette exception (et il a raison de ne pas la faire — un EXECUTE à anon
-- sur une SECURITY DEFINER n'a aucune justification), et relâcher le
-- détecteur pour faire passer un cas inoffensif est exactement la façon
-- dont un vrai cas passe plus tard sans bruit.
--
-- Rappel : `revoke ... from public` ne suffit pas. Les defaults Supabase
-- accordent nommément à anon et authenticated, il faut les nommer.
-- Idempotent, rejouable sur staging comme sur prod.
-- ═══════════════════════════════════════════════════════════════

begin;

revoke all on function public.deals_deduire_statut() from public, anon, authenticated;

comment on function public.deals_deduire_statut() is
  'Trigger : déduit le statut du deal à partir du kind de l''étape, sauf statut posé explicitement. Non exécutable directement (révoquée à anon/authenticated — moindre privilège).';

commit;
