-- ============================================================================
-- Le desabonnement des courriels etait CASSE — 42P01 sur une table supprimee
-- ============================================================================
--
-- record_email_opt_out() se terminait par :
--     update public.leads set email_opt_out_at = now() ...
-- Or la table `leads` a ete SUPPRIMEE du schema (fusionnee dans `clients` avec
-- status='lead', migration 20260705000000_eliminate_leads_table).
--
-- La fonction echouait donc systematiquement :
--     ERROR 42P01: relation "public.leads" does not exist
-- et AUCUN desabonnement n'etait enregistre. C'est un sujet de conformite
-- anti-pourriel : un destinataire qui clique « se desabonner » doit etre
-- retire, et il ne l'etait pas.
--
-- Detail aggravant : l'echec survenait APRES l'insertion dans email_opt_outs
-- et la mise a jour de clients. Comme tout se joue dans une seule transaction
-- implicite, l'erreur annulait AUSSI ces deux ecritures. Rien n'etait conserve.
--
-- CORRECTIF : retirer le bloc mort. La mise a jour de `clients` couvre deja les
-- leads, qui y vivent desormais avec status='lead'.
--
-- APPLIQUE EN PRODUCTION le 2026-07-31. Verifie par execution en transaction
-- annulee : 1 desabonnement enregistre, la ou la fonction levait 42P01.
--
-- TROUVE PAR un balayage des objets CASSES — ceux qui existent mais echouent a
-- l'usage. C'est une classe d'erreurs distincte des objets absents, et elle
-- echappait a tous les controles precedents.
-- ROLLBACK : reajouter le bloc `update public.leads`, ce qui recasserait la
-- fonction. Il n'y a aucune raison de le faire.
-- ============================================================================

create or replace function public.record_email_opt_out(p_email text, p_org_id uuid default null::uuid, p_reason text default null::text)
returns void
language sql
volatile
security definer
set search_path = public, pg_temp
as $LUMEOO$

  insert into public.email_opt_outs(org_id, email, reason)
  values (p_org_id, lower(trim(p_email)), p_reason)
  on conflict (org_id, email) do update set opted_out_at = now(), reason = excluded.reason;
  update public.clients set email_opt_out_at = now(), email_opt_out_reason = p_reason
   where lower(email) = lower(trim(p_email)) and (p_org_id is null or org_id = p_org_id);
$LUMEOO$;
