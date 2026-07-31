-- ============================================================================
-- P0 — list_archived_items() servait les archives de N'IMPORTE QUELLE org
-- ============================================================================
--
-- Symptome : tout compte authentifie pouvait appeler
--   supabase.rpc('list_archived_items', { p_org_id: '<uuid d une autre org>' })
-- et recevoir ses clients archives (nom, compagnie, COURRIEL) et ses jobs
-- archives. src/lib/archiveApi.ts:27 passe deja l'org_id depuis le client.
--
-- Cause racine : la fonction est SECURITY DEFINER, appartient a `postgres`, et
-- filtre uniquement sur le parametre p_org_id. Aucune verification
-- d'appartenance dans le corps — pas meme un appel a auth.uid().
--
-- Pourquoi le durcissement du 30 juillet l'a manquee : 20260751101400 l'a
-- explicitement conservee au motif qu'elle « filtre par RLS en interne ».
-- C'est faux. Verifie en production :
--
--     rolname   | rolbypassrls
--     postgres  | true
--
-- SECURITY DEFINER s'execute avec les droits du proprietaire, ici `postgres`,
-- qui contourne la RLS. Celle-ci ne protege donc RIEN a l'interieur du corps.
-- C'est le meme raisonnement errone qui avait laisse passer search_global.
--
-- Chaine d'exploitation complete (chaque maillon verifie) :
--   1. un visiteur ANONYME envoie une image sur un formulaire de demande
--      public ; la reponse contenait `path` = "request-forms/<ORG_UUID>/..."
--      -> UUID du tenant cible obtenu sans authentification
--      (corrige en parallele dans server/routes/request-forms.ts)
--   2. il cree un compte Lume gratuit
--   3. il appelle list_archived_items avec cet UUID
--
-- Portee reelle au moment de la decouverte : AUCUNE org n'avait d'element
-- archive, la fuite ne restituait donc rien. Elle se serait activee au premier
-- archivage.
--
-- ATTENTION — ce correctif a d'abord ete APPLIQUE DIRECTEMENT EN PRODUCTION le
-- 2026-07-31 a 02:20 UTC (audit docs/audit/). Cette migration le consigne pour
-- qu'il survive a un `db reset`. Elle est idempotente : la reappliquer sur une
-- base deja corrigee ne change rien.
--
-- Verifie par execution apres application :
--   * utilisateur authentifie NON membre  -> ERROR 42501 « Not authorized »
--   * membre legitime sur sa propre org   -> {clients, leads, jobs} normal
--   * chemin serveur (service_role)       -> HTTP 200, inchange
-- ============================================================================

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
  -- Garde de cloisonnement. auth.uid() NULL = appel serveur en service_role :
  -- on laisse passer pour ne rien casser cote serveur (meme motif que
  -- enforce_membership_role_change). Un appel utilisateur, lui, doit prouver
  -- son appartenance a l'org demandee.
  if auth.uid() is not null
     and not public.has_org_membership(auth.uid(), p_org_id) then
    raise exception 'Not authorized for this organization.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'type', 'client',
    'name', concat_ws(' ', c.first_name, c.last_name),
    'company', c.company, 'email', c.email, 'status', c.status,
    'archived_at', c.archived_at, 'archived_by', c.archived_by
  ) order by c.archived_at desc), '[]'::jsonb)
  into v_clients
  from public.clients c
  where c.org_id = p_org_id
    and c.archived_at is not null
    and coalesce(c.status, '') <> 'lead';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'type', 'lead',
    'name', concat_ws(' ', l.first_name, l.last_name),
    'company', l.company, 'email', l.email, 'status', l.lead_status,
    'archived_at', l.archived_at, 'archived_by', l.archived_by
  ) order by l.archived_at desc), '[]'::jsonb)
  into v_leads
  from public.clients l
  where l.org_id = p_org_id
    and l.archived_at is not null
    and l.status = 'lead';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id, 'type', 'job',
    'name', coalesce(j.title, 'Job #' || j.job_number),
    'client_name', j.client_name, 'status', j.status, 'job_number', j.job_number,
    'archived_at', j.archived_at, 'archived_by', j.archived_by
  ) order by j.archived_at desc), '[]'::jsonb)
  into v_jobs
  from public.jobs j
  where j.org_id = p_org_id
    and j.archived_at is not null;

  return jsonb_build_object('clients', v_clients, 'leads', v_leads, 'jobs', v_jobs);
end;
$$;

comment on function public.list_archived_items(uuid) is
  'Archives d''une org. Garde d''appartenance OBLIGATOIRE : SECURITY DEFINER '
  's''execute sous postgres (rolbypassrls = true), la RLS ne protege pas '
  'l''interieur du corps. Ne jamais retirer cette garde.';

-- Les droits restent inchanges (authenticated conserve EXECUTE) : la page
-- Archives doit continuer de fonctionner pour les membres legitimes.
