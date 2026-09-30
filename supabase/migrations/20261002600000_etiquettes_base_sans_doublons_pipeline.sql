-- ═══════════════════════════════════════════════════════════════
-- Étiquettes de base : retrait des doublons de ce qui est DÉJÀ automatique dans la
-- pipeline (Rafba, 2026-09-29 : « jamais contacté et non assigné sont déjà mis sur
-- certains deals, ils devraient être liés à autre chose ») :
--   · « Jamais contacté » = la pastille automatique de la carte (aucun premier
--     contact) et l'étape « Nouveau lead » ;
--   · « À relancer »      = la pastille automatique (5 j sans activité) et l'étape
--     « Relance » ;
--   · « Devis envoyé »    = l'étape « Soumission envoyée », où le deal passe tout
--     seul à l'envoi du devis.
-- Une étiquette posée à la main ne suivrait jamais la réalité du deal.
--
-- 1. etiquettes_assurer_base ne les crée plus (nouvelles entreprises).
-- 2. Retirées des catalogues existants SEULEMENT si aucun client ne les porte
--    (aucune ne l'est au moment d'écrire ; une entreprise qui s'en sert la garde).
--
-- ROLLBACK : rejouer 20261002500000_etiquettes_de_base.sql.
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
      ('Urgent',          '#DC2626'),
      ('Chaud',           '#EF4444'),
      ('Tiède',           '#F97316'),
      ('Froid',           '#3B82F6'),
      ('Rendez-vous pris','#8B5CF6'),
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


delete from public.tags t
 where lower(t.name) in ('jamais contacté', 'à relancer', 'devis envoyé')
   and not exists (
     select 1 from public.client_tags ct
       join public.clients c on c.id = ct.client_id
      where c.org_id = t.org_id and lower(ct.tag) = lower(t.name)
   );

commit;
