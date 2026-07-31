-- ============================================================================
-- La table quote_measurement_camera n'avait jamais ete creee
-- ============================================================================
--
-- DECOUVERTE par scripts/check-db-coherence.mjs, le controle de coherence
-- code/base ecrit le 2026-07-31. Premiere prise du nouvel outil.
--
-- src/lib/measurementApi.ts:27 fait `.from('quote_measurement_camera')` et
-- `if (error) throw error` — sans repli. La page /quotes/:id/measure
-- (src/pages/QuoteMeasure.tsx:52, routee dans App.tsx:1265 et :1269) appelle
-- getQuoteCamera() via useQuery des l'ouverture. La table n'existant pas, la
-- restauration de la vue camera echouait a chaque fois.
--
-- La migration 20260406120000_quote_measurements_v2.sql cree pourtant cette
-- table. Elle n'a jamais ete appliquee. Contrairement au filtre « factures par
-- vendeur » (voir 20260751103100), ce n'est PAS une collision d'horodatage :
-- son prefixe est unique. Elle a simplement ete oubliee — ce qui montre que
-- les migrations manquantes ne se limitent pas aux collisions.
--
-- CONTROLE PREALABLE — la lecon de 20260751103100, ou j'avais applique une
-- vieille migration sans verifier ses references et casse la liste des
-- factures. Ici, toutes les dependances ont ete verifiees EN BASE avant
-- application : public.current_org_id (1), public.has_org_membership (2
-- surcharges), public.quotes (1), public.quote_measurements (1). Aucune
-- reference vers un objet disparu.
--
-- TROIS AJOUTS par rapport a l'originale, pour ne pas creuser d'ecart avec les
-- invariants poses depuis avril :
--   1. FORCE ROW LEVEL SECURITY — le durcissement du 30 juillet l'a applique
--      aux 218 tables ; sans lui, check_rls_coverage() remonterait une
--      defaillance des cette nuit ;
--   2. search_path fige sur la fonction de trigger, et droits revoques a
--      public/anon/authenticated — sinon check_exposed_trigger_functions()
--      la signalerait ;
--   3. DROP TRIGGER IF EXISTS avant CREATE TRIGGER — l'originale n'etait pas
--      rejouable, CREATE TRIGGER n'ayant pas de IF NOT EXISTS.
-- ============================================================================

-- ── Colonnes v2 sur quote_measurements ──────────────────────────────────────
alter table public.quote_measurements
  add column if not exists camera_state jsonb null,
  add column if not exists metadata     jsonb null default '{}';

-- ── Table de la vue camera, une par devis ───────────────────────────────────
create table if not exists public.quote_measurement_camera (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.current_org_id(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  address     text not null default '',
  camera      jsonb not null default '{}',
  unit_system text not null default 'imperial',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (quote_id)
);

create index if not exists idx_qmc_quote on public.quote_measurement_camera(quote_id);

alter table public.quote_measurement_camera enable row level security;
-- Ajout n°1 : la RLS doit etre FORCEE, sinon le proprietaire la contourne.
alter table public.quote_measurement_camera force row level security;

drop policy if exists qmc_select on public.quote_measurement_camera;
drop policy if exists qmc_insert on public.quote_measurement_camera;
drop policy if exists qmc_update on public.quote_measurement_camera;
drop policy if exists qmc_delete on public.quote_measurement_camera;

create policy qmc_select on public.quote_measurement_camera for select to authenticated
  using (public.has_org_membership(auth.uid(), org_id));
create policy qmc_insert on public.quote_measurement_camera for insert to authenticated
  with check (public.has_org_membership(auth.uid(), org_id));
create policy qmc_update on public.quote_measurement_camera for update to authenticated
  using (public.has_org_membership(auth.uid(), org_id))
  with check (public.has_org_membership(auth.uid(), org_id));
create policy qmc_delete on public.quote_measurement_camera for delete to authenticated
  using (public.has_org_membership(auth.uid(), org_id));

grant select, insert, update, delete on public.quote_measurement_camera to authenticated;
grant select, insert, update, delete on public.quote_measurement_camera to service_role;

-- ── Trigger updated_at ──────────────────────────────────────────────────────
create or replace function public.qmc_updated_at()
returns trigger
language plpgsql
-- Ajout n°2 : search_path fige.
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.qmc_updated_at() from public, anon, authenticated;

-- Ajout n°3 : rejouable.
drop trigger if exists qmc_updated_at_trigger on public.quote_measurement_camera;
create trigger qmc_updated_at_trigger
  before update on public.quote_measurement_camera
  for each row execute function public.qmc_updated_at();
