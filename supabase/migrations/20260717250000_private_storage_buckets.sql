-- ═══════════════════════════════════════════════════════════════
-- SÉCURITÉ Storage : rendre privés les buckets qui n'ont aucune raison
-- d'être publics (audit 2026-07-17, advisor public_bucket_allows_listing).
--
-- Analyse par bucket :
--   • company-logos → PUBLIC légitime (affiché dans le portail client sans
--     login, l'onboarding, la marketplace) — inchangé.
--   • avatars → PUBLIC toléré (photos de profil, non sensibles) — inchangé.
--   • job-photos → PRIVÉ : photos de propriétés de clients. 13 fichiers,
--     AUCUN getPublicUrl dans le code (référencé nulle part à l'affichage).
--   • attachments → PRIVÉ : le code utilise DÉJÀ createSignedUrl
--     (measurementApi, « tenant-private ») — le flag public était une
--     erreur, on l'aligne sur le comportement réel.
--   • director-panel → PRIVÉ : zéro usage dans le code (bucket mort).
--
-- Les uploads passent par le service_role (server/routes/storage-upload.ts
-- + measurementApi), immunisé au flag public. Aucun flux légitime ne casse.
-- Pour afficher un fichier d'un bucket privé : createSignedUrl (TTL court).
-- ═══════════════════════════════════════════════════════════════

update storage.buckets
set public = false
where id in ('job-photos', 'attachments', 'director-panel');

-- Resserrer les policies « Anyone can view / delete » de job-photos :
-- lecture réservée aux membres authentifiés (via URL signée), pas au public.
drop policy if exists "Anyone can view job photos" on storage.objects;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='Authenticated can view job photos'
  ) then
    create policy "Authenticated can view job photos"
      on storage.objects for select to authenticated
      using (bucket_id = 'job-photos');
  end if;
end $$;
