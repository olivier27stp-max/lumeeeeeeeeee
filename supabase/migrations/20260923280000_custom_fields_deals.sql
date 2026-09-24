-- ═══════════════════════════════════════════════════════════════
-- Les champs personnalisés s'ouvrent aux deals
--
-- L'audit GoHighLevel du 2026-09-23 réclamait des champs personnalisés sur
-- l'opportunité (#38, #39) : superficie, type de surface, nombre de fenêtres
-- — le genre d'information qui décide d'un prix en service terrain et qui
-- n'a aucune raison de vivre dans une note en texte libre.
--
-- Tout existait déjà. `custom_columns` gère treize types de champs (texte,
-- nombre, monétaire, liste, case, fichier, signature…), avec valeurs par
-- défaut, ordre et suppression douce. Sa contrainte n'acceptait simplement
-- que trois entités : clients, jobs, invoices.
--
-- On ajoute `deals`. Ce n'est pas qu'un CHECK élargi : `check_custom_field_
-- orphans()` doit connaître la nouvelle entité, sinon un champ rattaché à un
-- deal supprimé deviendrait un orphelin que PERSONNE ne détecte — le
-- contrôle d'intégrité rendrait un faux « tout va bien ».
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. La contrainte d'entité
-- ───────────────────────────────────────────────────────────────
alter table public.custom_columns
  drop constraint if exists custom_columns_entity_check;

alter table public.custom_columns
  add constraint custom_columns_entity_check
  check (entity in ('clients', 'jobs', 'invoices', 'deals'));

comment on column public.custom_columns.entity is
  'Entité portant le champ : clients, jobs, invoices ou deals. Toute valeur ajoutée ici DOIT l''être aussi dans check_custom_field_orphans(), sinon ses orphelins ne sont jamais détectés.';

-- ───────────────────────────────────────────────────────────────
-- 2. Le contrôle d'orphelins apprend les deals
--
--    Sans cette branche, supprimer un deal laisserait ses valeurs de champs
--    derrière lui et le contrôle d'intégrité répondrait « aucun orphelin » —
--    un faux négatif est pire que pas de contrôle du tout.
-- ───────────────────────────────────────────────────────────────
create or replace function public.check_custom_field_orphans()
returns table (value_id uuid, org_id uuid, entity text, record_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.id, v.org_id, c.entity, v.record_id
    from public.custom_column_values v
    join public.custom_columns c on c.id = v.column_id
   where (c.entity = 'clients'
          and not exists (select 1 from public.clients t where t.id = v.record_id))
      or (c.entity = 'jobs'
          and not exists (select 1 from public.jobs t where t.id = v.record_id))
      or (c.entity = 'invoices'
          and not exists (select 1 from public.invoices t where t.id = v.record_id))
      or (c.entity = 'deals'
          and not exists (select 1 from public.deals t where t.id = v.record_id));
$$;

-- Le principe du moindre privilège : un `create or replace` repart avec les
-- DEFAULT PRIVILEGES de Supabase, qui accordent EXECUTE à anon.
revoke all on function public.check_custom_field_orphans() from public, anon, authenticated;

commit;
