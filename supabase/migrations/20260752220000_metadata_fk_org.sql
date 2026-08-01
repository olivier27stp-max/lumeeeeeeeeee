-- ============================================================================
-- 02_constraints (sous-ensemble SÛR) — FK org_id manquantes vers orgs
-- Audit métadonnées, 2026-08-01
-- ============================================================================
-- L'audit a trouvé 15 colonnes *_id sans contrainte FK. Ce fichier n'applique
-- QUE les 5 FK `org_id → orgs` — 100% sûres car org_id référence toujours un
-- org réel (garanti par le modèle multi-tenant) et vérifié : 0 orphelin sauf
-- org_client_counters (6 lignes vers des orgs supprimés, TOLÉRÉES par NOT VALID).
--
-- Les 10 autres FK proposées (vers field_territories, clients/leads,
-- quote_templates, field_pins, field_sales_teams...) NE SONT PAS ici : elles
-- pourraient bloquer de futures écritures si l'app écrit un id non-conforme
-- (ex. lead_id hérité de l'ancien modèle leads). Voir DB_METADATA_AUDIT.md,
-- gardées pour revue.
--
-- NOT VALID = pas de scan de table (lock court), n'affecte pas les lignes
-- existantes, contraint seulement les écritures futures. Comportement app
-- inchangé (org_id toujours valide côté écriture).
-- ============================================================================

begin;

alter table public.lead_sources
  add constraint lead_sources_org_id_fkey
  foreign key (org_id) references public.orgs(id) on delete cascade not valid;

alter table public.org_client_counters
  add constraint org_client_counters_org_id_fkey
  foreign key (org_id) references public.orgs(id) on delete cascade not valid;

alter table public.quote_measurement_camera
  add constraint quote_measurement_camera_org_id_fkey
  foreign key (org_id) references public.orgs(id) on delete cascade not valid;

alter table public.referrals
  add constraint referrals_referrer_org_id_fkey
  foreign key (referrer_org_id) references public.orgs(id) on delete cascade not valid;

alter table public.referrals
  add constraint referrals_referred_org_id_fkey
  foreign key (referred_org_id) references public.orgs(id) on delete set null not valid;

commit;
