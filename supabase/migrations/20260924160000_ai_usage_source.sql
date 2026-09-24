-- ─────────────────────────────────────────────────────────────────────────
-- Savoir ce que l'IA coûte, par entreprise ET par usage.
--
-- `ai_usage` existe depuis Lumi et compte déjà les tokens, le modèle et le
-- coût. Ce qu'elle ne dit pas : QUEL usage a dépensé. Aujourd'hui, seul Lumi
-- y écrit ; l'assistant de support appelle Sonnet en boucle d'outils, calcule
-- son coût… et le jette dans un compteur en mémoire, perdu au redémarrage.
-- Autrement dit : on ne sait pas ce que le support coûte, ni par client, ni
-- au total.
--
-- Cette migration est ADDITIVE : une colonne avec une valeur par défaut, et
-- une vue de lecture. Rien n'est renommé, rien n'est supprimé, le code qui
-- écrit aujourd'hui continue de fonctionner sans changement.
--
-- Loi 25 : on ne stocke que des COMPTEURS. Aucun prompt, aucune réponse,
-- aucune donnée personnelle — la table n'a pas de colonne pour en recevoir.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. D'où vient la dépense.
--
-- `lumi` par défaut : toutes les lignes existantes viennent de là, et
-- `journaliserUsage` n'avait pas d'autre écrivain. Le défaut évite de
-- réécrire l'historique et garde l'insert compatible tant que le code n'est
-- pas déployé.
alter table public.ai_usage
  add column if not exists source text not null default 'lumi';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_usage'::regclass and conname = 'ai_usage_source_check'
  ) then
    alter table public.ai_usage
      add constraint ai_usage_source_check
      check (source in ('lumi', 'support', 'migration', 'briefing', 'routeur', 'cache'));
  end if;
end $$;

comment on column public.ai_usage.source is
  'Quel usage a dépensé : lumi (assistant dans l''app et par texto), support '
  '(assistant du chat d''aide), migration (bot d''import), routeur, cache. '
  'Sert à répondre « le support me coûte combien ? » sans deviner.';

-- Le coût par entreprise se lit presque toujours par période : l'index porte
-- donc la date, et la source pour les découpages par usage.
create index if not exists idx_ai_usage_org_date_source
  on public.ai_usage (org_id, created_at desc, source);

-- 2. Le coût des 30 derniers jours, par entreprise et par usage.
--
-- `security_invoker` : la vue applique la RLS de celui qui la lit, pas celle
-- de son créateur. Sans ça, n'importe quel membre verrait la dépense de
-- TOUTES les entreprises — la fuite inter-org du 2026-09-06, à ne pas refaire.
create or replace view public.cout_ia_par_org_30j
with (security_invoker = true) as
select
  u.org_id,
  o.name                                   as org,
  u.source,
  count(*)                                 as appels,
  sum(u.input_tokens)                      as tokens_entree,
  sum(u.cache_read_input_tokens)           as tokens_cache_lu,
  sum(u.cache_creation_input_tokens)       as tokens_cache_ecrit,
  sum(u.output_tokens)                     as tokens_sortie,
  round(sum(u.cost_cents), 2)              as cout_cents,
  round(sum(u.cost_cents) / 100.0, 2)      as cout_dollars,
  -- Le coût moyen d'un appel dit, d'un coup d'œil, si le cache a décroché :
  -- 0,2 ¢ à chaud, plus de 2 ¢ à froid (mesuré le 2026-09-16).
  round(sum(u.cost_cents) / nullif(count(*), 0), 4) as cents_par_appel,
  min(u.created_at)                        as premier_appel,
  max(u.created_at)                        as dernier_appel
from public.ai_usage u
join public.orgs o on o.id = u.org_id
where u.created_at >= now() - interval '30 days'
group by u.org_id, o.name, u.source;

comment on view public.cout_ia_par_org_30j is
  'Coût IA des 30 derniers jours, par entreprise et par usage. Lecture soumise '
  'à la RLS de ai_usage : un admin voit son org, le service_role voit tout.';
