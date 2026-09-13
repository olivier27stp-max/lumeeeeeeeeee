-- ═══════════════════════════════════════════════════════════════════
-- Trace unifiée des agents : un tour = une ligne
-- ───────────────────────────────────────────────────────────────────
-- ⚠️ NON APPLIQUÉE par l'agent qui l'a écrite (règle R9 de la mission
-- « architecture déterministe » : aucune migration exécutée sans go).
-- À appliquer par un humain, staging puis prod :
--   npm run db:apply -- supabase/migrations/20260913000000_lumi_traces.sql
--   npm run db:apply:prod -- supabase/migrations/20260913000000_lumi_traces.sql
-- Le code (server/lib/lumi/traces.ts) tolère l'absence de la table : il
-- journalise un avertissement une fois et continue. Rien ne casse avant.
--
-- Pourquoi : quatre tables racontaient chacune un bout de l'histoire
-- (ai_usage = tokens et coût par appel API ; agent_actions = écritures,
-- purgées à 24 h ; security_events = incidents ; lumi_messages = texte).
-- Aucune ne dit, pour UN tour : d'où vient le message (bouton, texte,
-- micro, carte), quel étage a répondu (raccourci sans modèle, modèle),
-- quels outils ont tourné, combien ça a coûté et en combien de temps.
-- Sans ça, la part de trafic absorbable sans modèle, le calibrage d'un
-- routeur et le coût par entrée d'interface sont « non mesurables »
-- (COST_AUDIT.md). Cette table est la mesure.
--
-- ai_usage reste la source du budget mensuel (etatBudget) : une ligne
-- par appel API. lumi_traces est une ligne par TOUR (plusieurs appels).
-- Les appels Gemini (agent public, transcription) n'avaient aucune
-- journalisation : ils entrent ici avec org_id NULL quand il n'y a pas
-- de tenant (page publique).
--
-- N'AJOUTE qu'une table neuve. Aucune autre table, vue, politique ou
-- fonction n'est touchée. Pas de purge pour l'instant (volume : quelques
-- lignes par jour) ; à brancher sur oauth_menage() quand le volume le
-- justifiera.
-- ═══════════════════════════════════════════════════════════════════
create table if not exists public.lumi_traces (
  id               uuid primary key default gen_random_uuid(),
  -- NULL = canal sans tenant (page publique). Jamais fourni par le modèle :
  -- toujours le contexte serveur (requireAuthedClient / clé API).
  org_id           uuid references public.orgs(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete cascade,
  conversation_id  uuid references public.lumi_conversations(id) on delete set null,
  canal            text not null check (canal in ('lumi', 'public', 'agent', 'transcription', 'migration')),
  -- D'où vient le message : texte libre, suggestion cliquée, micro,
  -- carte (Confirmer / Annuler), repli (Réessayer), lien profond, API.
  origine          text not null default 'texte' check (origine in ('texte', 'suggestion', 'voix', 'carte', 'repli', 'lien', 'api')),
  -- Énoncé normalisé (minuscules, sans accents ni ponctuation, 200 car.
  -- max) : c'est ce qui alimente la table des énoncés exacts (étage 1) et
  -- le golden set. Le texte intégral reste dans lumi_messages.
  enonce_normalise text,
  -- Étage de la couche zéro-appel qui a répondu : 0 interface, 1 énoncé
  -- exact, 2 raccourci, 3 cache de réponse, 4 cache sémantique, 5 routeur,
  -- 6 agent complet. NULL pour les canaux sans étages (transcription).
  etage            smallint check (etage between 0 and 6),
  topic            text,
  action           text,
  params           jsonb,
  outils           text[] not null default '{}',
  resultat         text not null check (resultat in ('ok', 'refus', 'erreur', 'proposition')),
  model            text,
  prompt_version   text,
  input_tokens     integer not null default 0,
  cache_5m         integer not null default 0,
  cache_1h         integer not null default 0,
  cache_lu         integer not null default 0,
  output_tokens    integer not null default 0,
  -- NULL = tokens connus mais tarif inconnu (Gemini : pas de grille dans
  -- tarifs.ts). Jamais un chiffre inventé.
  cost_cents       numeric(10, 4),
  duree_ms         integer,
  feedback         text,
  created_at       timestamptz not null default now()
);
comment on table public.lumi_traces is
  'Une ligne par tour d''agent (Lumi, agent public, transcription) : origine du '
  'message, étage qui a répondu, outils, tokens, coût, latence. Sert l''audit '
  '(qui a demandé quoi, avec quel résultat), la mesure de coût par entrée '
  'd''interface et le calibrage des étages sans modèle. Écrite par le serveur.';

create index if not exists lumi_traces_org_date_idx
  on public.lumi_traces (org_id, created_at desc);
create index if not exists lumi_traces_conversation_idx
  on public.lumi_traces (conversation_id)
  where conversation_id is not null;
create index if not exists lumi_traces_etage_idx
  on public.lumi_traces (canal, etage, created_at desc);

-- ── RLS ─────────────────────────────────────────────────────────────
-- Écrite par le serveur uniquement (service_role, org_id du contexte).
-- Les membres d'une org peuvent LIRE les traces de leur org ; les lignes
-- sans org (page publique) ne sont lisibles par personne côté client.
alter table public.lumi_traces enable row level security;

create policy lumi_traces_select_membre on public.lumi_traces
  as permissive for select to authenticated
  using (
    org_id is not null
    and exists (
      select 1 from public.memberships m
       where m.org_id = lumi_traces.org_id
         and m.user_id = (select auth.uid())
         and m.status = 'active'
    )
  );

-- Défauts Supabase : `authenticated` reçoit ALL sur une table neuve. On
-- ne laisse que la lecture (voir SECURITY DEFINER moindre privilège,
-- mémoire projet) ; `anon` n'a rien à y faire.
revoke all on public.lumi_traces from anon;
revoke insert, update, delete, truncate, references, trigger on public.lumi_traces from authenticated;
grant select on public.lumi_traces to authenticated;

-- ── Vérification ────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'lumi_traces') then
    raise exception 'lumi_traces manquante';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lumi_traces' and policyname = 'lumi_traces_select_membre') then
    raise exception 'policy lumi_traces_select_membre manquante';
  end if;
end $$;
