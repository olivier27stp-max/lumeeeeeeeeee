-- ═══════════════════════════════════════════════════════════════
-- Étiquettes de base (demande de Rafba, 2026-09-29) : chaque entreprise part avec
-- un jeu complet d'étiquettes utiles, pour éviter au client la corvée de les créer.
-- Elles s'additionnent librement sur un client (aucune exclusivité) ; le seul
-- interdit reste le doublon (UNIQUE client_id, tag déjà en place).
--
-- · etiquettes_assurer_base(org) : ajoute au catalogue `tags` celles qui manquent
--   (comparaison insensible à la casse : une « vip » déjà créée n'est pas doublée).
--   Ne pose AUCUNE étiquette sur un client, ne déclenche aucune automatisation.
-- · Toutes les entreprises existantes, puis chaque nouvelle (trigger sur orgs).
-- Modifiables et supprimables ensuite dans Réglages → Étiquettes.
--
-- ROLLBACK :
--   drop trigger if exists trg_orgs_etiquettes_base on public.orgs;
--   drop function if exists public.orgs_etiquettes_base();
--   drop function if exists public.etiquettes_assurer_base(uuid);
--   (les étiquettes créées restent : les retirer une à une dans Réglages si voulu)
-- ═══════════════════════════════════════════════════════════════

begin;

create or replace function public.etiquettes_assurer_base(p_org uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  n integer;
begin
  insert into public.tags (org_id, name, color_hex)
  select p_org, v.nom, v.couleur
    from (values
      -- Suivi du lead
      ('Jamais contacté', '#6B7280'),
      ('À relancer',      '#F59E0B'),
      ('Urgent',          '#DC2626'),
      ('Chaud',           '#EF4444'),
      ('Tiède',           '#F97316'),
      ('Froid',           '#3B82F6'),
      ('Rendez-vous pris','#8B5CF6'),
      ('Devis envoyé',    '#0EA5E9'),
      ('En réflexion',    '#EAB308'),
      -- Relation
      ('Nouveau client',  '#22C55E'),
      ('Client récurrent','#14B8A6'),
      ('VIP',             '#A855F7'),
      ('Référence',       '#10B981'),
      ('Ambassadeur',     '#EC4899'),
      ('Ancien client',   '#94A3B8'),
      -- Type de client
      ('Résidentiel',     '#84CC16'),
      ('Commercial',      '#0284C7'),
      ('Gestionnaire immobilier', '#6366F1'),
      ('Contrat annuel',  '#4F46E5'),
      ('Saisonnier',      '#06B6D4'),
      -- Attention
      ('Ne pas contacter','#1F2937'),
      ('Mauvais payeur',  '#B91C1C'),
      ('Plainte',         '#E11D48'),
      -- Avis
      ('Avis demandé',    '#FACC15'),
      ('Avis laissé',     '#16A34A')
    ) as v(nom, couleur)
   where not exists (
     select 1 from public.tags t where t.org_id = p_org and lower(t.name) = lower(v.nom)
   );
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.etiquettes_assurer_base(uuid) from public, anon, authenticated;
grant execute on function public.etiquettes_assurer_base(uuid) to service_role;

-- ── Chaque nouvelle entreprise ─────────────────────────────────────────────────
create or replace function public.orgs_etiquettes_base()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform public.etiquettes_assurer_base(new.id);
  return new;
end;
$function$;

revoke all on function public.orgs_etiquettes_base() from public, anon, authenticated;
grant execute on function public.orgs_etiquettes_base() to service_role;

drop trigger if exists trg_orgs_etiquettes_base on public.orgs;
create trigger trg_orgs_etiquettes_base after insert on public.orgs
  for each row execute function public.orgs_etiquettes_base();

-- ── Entreprises existantes ─────────────────────────────────────────────────────
select public.etiquettes_assurer_base(o.id) from public.orgs o;

commit;
