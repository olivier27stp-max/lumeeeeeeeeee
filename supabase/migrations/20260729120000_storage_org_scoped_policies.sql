-- ═══════════════════════════════════════════════════════════════
-- SÉCURITÉ Storage : cloisonnement par organisation.
--
-- PROBLÈME (audit 2026-07-29) : les policies de storage.objects ne
-- filtraient que sur bucket_id + « est authentifié ». N'importe quel
-- utilisateur d'une des 31 orgs pouvait LISTER, TÉLÉCHARGER, MODIFIER
-- et SUPPRIMER la totalité de `attachments` et `job-photos` des autres
-- tenants. L'upload via le relais serveur était déjà cloisonné
-- (server/routes/storage-upload.ts:33) — la protection existait en
-- écriture, pas en lecture, et pas du tout sur l'accès direct.
--
-- CONTRAINTE : les chemins existants ne sont pas uniformes.
--   • org en 1re position : job-photos/{orgId}/...
--   • org en 2e position  : measurements/{orgId}/..., request-forms/{orgId}/...
--   • AUCUNE org         : courses/, quotes/photos/, specific-notes/,
--                          note-boards/, clients/, jobs/, checklists/,
--                          job-photos/avatars/
-- Un filtre naïf sur le 1er segment rendrait ~25 fichiers légitimes
-- inaccessibles en production. On procède donc en deux temps :
--   1. (cette migration) fermer la fuite pour tout ce qui est org-scopé,
--      tolérer les préfixes legacy en LECTURE SEULE ;
--   2. remigrer les objets legacy sous {orgId}/ puis supprimer
--      public.lume_storage_is_legacy_path — voir docs/storage-legacy-paths.md.
-- L'écriture et la suppression sont fermées immédiatement, legacy compris.
--
-- NOTE service_role : les uploads serveur passent par getServiceClient(),
-- qui bypasse RLS — aucun flux d'upload existant ne casse.
-- ═══════════════════════════════════════════════════════════════

-- Extrait l'org d'un chemin, qu'elle soit en 1re ou 2e position.
-- search_path figé : la fonction est appelée depuis des policies RLS.
--
-- Un UUID trouvé ici est TOUJOURS confronté à has_org_membership() : un
-- segment qui serait un user_id (ex. `avatars/{userId}_123.jpg`) ne donne
-- donc aucun accès, il échoue simplement le test d'appartenance. Vérifié
-- sur les chemins réels de production le 2026-07-29.
create or replace function public.lume_storage_object_org(object_name text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  segments text[] := string_to_array(object_name, '/');
  candidate text;
begin
  foreach candidate in array segments[1:2] loop
    begin
      return candidate::uuid;
    exception when invalid_text_representation then
      null; -- segment non-uuid, on essaie le suivant
    end;
  end loop;
  return null;
end $$;

comment on function public.lume_storage_object_org(text) is
  'Org proprietaire d''un objet Storage, lue sur les 2 premiers segments du chemin. NULL = chemin legacy sans org.';

-- Préfixes historiques sans org, tolérés en lecture le temps de la migration.
create or replace function public.lume_storage_is_legacy_path(object_name text)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select object_name like 'courses/%'
      or object_name like 'quotes/photos/%'
      or object_name like 'specific-notes/%'
      or object_name like 'note-boards/%'
      or object_name like 'clients/%'
      or object_name like 'jobs/%'
      or object_name like 'checklists/%'
      or object_name like 'avatars/%';
$$;

comment on function public.lume_storage_is_legacy_path(text) is
  'TEMPORAIRE — chemins anterieurs au cloisonnement par org. A supprimer une fois les objets remigres sous {orgId}/.';

-- Les deux helpers vivent dans `public` et non `storage` : Supabase refuse
-- la creation de fonctions dans le schema `storage` via l'API
-- (42501: permission denied for schema storage).
grant execute on function public.lume_storage_object_org(text) to authenticated, service_role;
grant execute on function public.lume_storage_is_legacy_path(text) to authenticated, service_role;

-- ─── attachments ────────────────────────────────────────────────
drop policy if exists "Authenticated users can view attachments"   on storage.objects;
drop policy if exists "Authenticated users can update attachments" on storage.objects;
drop policy if exists "Authenticated users can delete attachments" on storage.objects;
drop policy if exists "Authenticated users can upload attachments" on storage.objects;

create policy "attachments_select_own_org"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and (
      public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
      or public.lume_storage_is_legacy_path(name)
    )
  );

create policy "attachments_insert_own_org"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

create policy "attachments_update_own_org"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  )
  with check (
    bucket_id = 'attachments'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

create policy "attachments_delete_own_org"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

-- ─── job-photos ─────────────────────────────────────────────────
drop policy if exists "Authenticated can view job photos"          on storage.objects;
drop policy if exists "Authenticated users can update job photos"  on storage.objects;
drop policy if exists "Authenticated users can delete job photos"  on storage.objects;
drop policy if exists "Authenticated users can upload job photos"  on storage.objects;
drop policy if exists "org members can upload job photos"          on storage.objects;
drop policy if exists "uploader can delete job photos"             on storage.objects;

create policy "job_photos_select_own_org"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'job-photos'
    and (
      public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
      or public.lume_storage_is_legacy_path(name)
    )
  );

create policy "job_photos_insert_own_org"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'job-photos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

create policy "job_photos_update_own_org"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'job-photos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  )
  with check (
    bucket_id = 'job-photos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

create policy "job_photos_delete_own_org"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'job-photos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

-- ─── company-logos ──────────────────────────────────────────────
-- Bucket public (logo affiché sans login dans le portail client) : la
-- LECTURE reste ouverte, c'est voulu. Mais écraser ou supprimer le logo
-- d'une AUTRE org était possible pour tout utilisateur authentifié.
drop policy if exists "Authenticated users can update company logos" on storage.objects;
drop policy if exists "Authenticated users can delete company logos" on storage.objects;
drop policy if exists "Authenticated users can upload company logos" on storage.objects;

create policy "company_logos_insert_own_org"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-logos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

create policy "company_logos_update_own_org"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-logos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  )
  with check (
    bucket_id = 'company-logos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

create policy "company_logos_delete_own_org"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'company-logos'
    and public.has_org_membership(auth.uid(), public.lume_storage_object_org(name))
  );

-- ─── attachments : plafond de taille ────────────────────────────
-- 5 Go et tous types MIME confondus sur un bucket ouvert à l'upload
-- authentifié = vecteur d'abus de stockage. 50 Mo couvre les usages
-- réels (le plus gros objet actuel est une vidéo de cours).
update storage.buckets set file_size_limit = 52428800 where id = 'attachments';
