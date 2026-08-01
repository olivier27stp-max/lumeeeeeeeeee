-- ============================================================================
-- AUDIT 2026-07-31 — C1-04 : fermeture de la fuite storage cross-tenant
-- ============================================================================
-- Réf. rapport : AUDIT_REPORT.md C1-04.
--
-- PROBLÈME
--   Les policies SELECT `attachments_select_own_org` et `job_photos_select_own_org`
--   portaient une branche « OR lume_storage_is_legacy_path(name) » qui laissait
--   TOUT utilisateur authentifié de N'IMPORTE quel org lire (et lister) les objets
--   sous les préfixes non-ancrés `clients/%`, `jobs/%`, `checklists/%`,
--   `quotes/photos/%`, `avatars/%`, `specific-notes/%`, `courses/%`, `note-boards/%`.
--
-- PRÉ-REQUIS (déjà appliqué côté code, même commit)
--   Tous les flux d'upload vers les buckets PRIVÉS (attachments, job-photos)
--   écrivent désormais sous `${orgId}/…` (seg1 = org), donc résolus par la branche
--   principale has_org_membership(auth.uid(), lume_storage_object_org(name)) :
--     - src/pages/ClientDetails.tsx        clients/…       -> ${orgId}/clients/…
--     - src/pages/JobDetails.tsx           jobs/…          -> ${orgId}/jobs/…
--     - src/pages/QuoteNew.tsx             quotes/photos/… -> ${orgId}/quotes/photos/…
--     - src/components/JobChecklistsSection.tsx  checklists/… -> ${orgId}/checklists/…
--     - src/lib/specificNotesApi.ts        specific-notes/… -> ${orgId}/specific-notes/…
--     - src/pages/CourseBuilder.tsx        fallback 'courses' supprimé (org requis)
--   Déjà org-ancrés avant ce commit : measurements/${orgId}, request-forms/${orgId},
--   OnboardingWizard `${prefix}/${orgId}`, CheckoutSetup `${orgId}/logo`.
--   Les buckets PUBLICS (company-logos, avatars) n'ont pas de branche legacy et
--   ne sont pas concernés.
--
-- EFFET
--   Les ~27 objets de TEST encore sous préfixes legacy (base pré-lancement)
--   deviennent illisibles par les rôles clients (orphelins). Aucune donnée
--   n'est supprimée. Les objets org-ancrés restent lisibles normalement.
--
-- IDÉMPOTENT. ROLLBACK commenté en bas.
-- ============================================================================

begin;

-- ── attachments : retirer la branche legacy ─────────────────────────────────
drop policy if exists attachments_select_own_org on storage.objects;
create policy attachments_select_own_org
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

-- ── job-photos : retirer la branche legacy ──────────────────────────────────
drop policy if exists job_photos_select_own_org on storage.objects;
create policy job_photos_select_own_org
  on storage.objects for select to authenticated
  using (
    bucket_id = 'job-photos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

-- ── Fonction legacy devenue inutile ─────────────────────────────────────────
-- Plus référencée par aucune policy après les DROP ci-dessus.
drop function if exists public.lume_storage_is_legacy_path(text);

commit;

-- ============================================================================
-- ROLLBACK (rétablit la branche legacy — NE PAS utiliser sauf régression) :
-- ----------------------------------------------------------------------------
-- begin;
--   create or replace function public.lume_storage_is_legacy_path(object_name text)
--   returns boolean language sql immutable security invoker set search_path = '' as $$
--     select object_name like 'courses/%' or object_name like 'quotes/photos/%'
--         or object_name like 'specific-notes/%' or object_name like 'note-boards/%'
--         or object_name like 'clients/%' or object_name like 'jobs/%'
--         or object_name like 'checklists/%' or object_name like 'avatars/%';
--   $$;
--   drop policy if exists attachments_select_own_org on storage.objects;
--   create policy attachments_select_own_org on storage.objects for select to authenticated
--     using ( bucket_id = 'attachments' and (
--       public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
--       or public.lume_storage_is_legacy_path(name) ) );
--   drop policy if exists job_photos_select_own_org on storage.objects;
--   create policy job_photos_select_own_org on storage.objects for select to authenticated
--     using ( bucket_id = 'job-photos' and (
--       public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
--       or public.lume_storage_is_legacy_path(name) ) );
-- commit;
-- ============================================================================
