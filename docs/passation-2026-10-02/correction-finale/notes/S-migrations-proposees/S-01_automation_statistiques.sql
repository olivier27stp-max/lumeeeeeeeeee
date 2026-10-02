-- S-01 (agent S, PROPOSÉE — appliquée à la pile LOCALE seulement)
-- Points 4 et 5 de la mission : statistiques, Historique et Journaux des automatisations.
--
-- Avant : chaque écran comptait à sa façon, dans le navigateur, en rapatriant les lignes
-- (1 000 au plus par réponse PostgREST, 200 pour les échecs et les onglets). Un bureau de prod
-- a déjà 2 961 lignes en 49 jours : sa Vue d'ensemble était fausse (constats D-01, D-02, D-09, D-15).
--
-- Ici : le compte se fait EN BASE, avec UNE définition, lue par la liste, la Vue d'ensemble,
-- l'éditeur, l'Historique, les Journaux (et, quand le coordinateur le branchera, Lumi).
--
--   automation_client_de(…)    le client d'une fiche (devis, facture, job, rendez-vous, deal…)
--   automation_evenements(…)   le flux unique : lignes du journal + états de la file sans ligne.
--                              C'est ICI, et nulle part ailleurs, que sont écrits le code d'issue
--                              d'une ligne (lignes anciennes comprises) et la catégorie comptée :
--                              envoyee | action | echouee | ignoree | annulee | reportee |
--                              en_cours | tentative
--   automation_statistiques(…) les comptes d'une période (par automatisation, par jour, par étape)
--   automation_journal(…)      les Journaux, paginés et filtrés en base, avec le total
--   automation_passages(…)     l'Historique : une ligne par passage d'un client, paginé, avec le total
--
-- Le sens des codes (catégorie, groupe, libellé) reste dans UN fichier du dépôt,
-- `src/lib/automationMotifs.ts` : le serveur passe la table code → catégorie (`p_categories`) et
-- la liste des actions qui envoient un message au client (`p_messages`). La base ne recopie pas
-- cette liste : un code ajouté au fichier est compté juste sans nouvelle migration.
--
-- SÉCURITÉ : tout est SECURITY INVOKER. La RLS de l'appelant s'applique aux tables lues
-- (`automations.read` + policy restrictive `bureau_actif`) : un membre d'un autre bureau, ou sans
-- le droit, obtient des comptes à zéro et des listes vides. `anon` n'a aucun droit d'exécution.
--
-- INDEX : aucun nouveau. Les lectures passent par ceux qui existent déjà —
--   automation_execution_logs : idx_execution_logs_org (org_id, created_at desc),
--                               idx_automation_execution_logs_org_automation_rule_id,
--                               idx_automation_execution_logs_org_scheduled_task_id ;
--   automation_scheduled_tasks : idx_automation_scheduled_tasks_org_automation_rule_id,
--                                idx_scheduled_tasks_sequence (pending).
--
-- Non destructive : cinq fonctions, aucune table, aucune donnée touchée. Idempotente.
--
-- RETOUR ARRIÈRE :
--   drop function if exists public.automation_passages(uuid, timestamptz, timestamptz, uuid, text[], uuid, text, jsonb, text[], integer, integer);
--   drop function if exists public.automation_journal(uuid, timestamptz, timestamptz, uuid, text[], text, uuid, text, jsonb, text[], integer, integer);
--   drop function if exists public.automation_statistiques(uuid, timestamptz, uuid, text, jsonb, text[]);
--   drop function if exists public.automation_evenements(uuid, timestamptz, uuid, jsonb, text[]);
--   drop function if exists public.automation_client_de(uuid, text, uuid);

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Le client d'une fiche. Un prospect EST un client (`entity_id` = clients.id).
--    Un rendez-vous n'a pas de client : il tient à un job, qui en a un.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.automation_client_de(p_org uuid, p_type text, p_id uuid)
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case
    when p_type in ('client', 'lead') then (select c.id from public.clients c where c.id = p_id and c.org_id = p_org)
    when p_type = 'quote' then (select q.client_id from public.quotes q where q.id = p_id and q.org_id = p_org)
    when p_type = 'invoice' then (select i.client_id from public.invoices i where i.id = p_id and i.org_id = p_org)
    when p_type = 'job' then (select j.client_id from public.jobs j where j.id = p_id and j.org_id = p_org)
    when p_type = 'deal' then (select d.client_id from public.deals d where d.id = p_id and d.org_id = p_org)
    when p_type in ('schedule_event', 'appointment') then (
      select j.client_id
        from public.schedule_events e
        join public.jobs j on j.id = e.job_id and j.org_id = e.org_id
       where e.id = p_id and e.org_id = p_org
    )
  end
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Le flux des événements d'une période : UNE ligne par chose arrivée.
--
--    source = 'journal' : une ligne de `automation_execution_logs`.
--    source = 'tache'   : un état de la file que AUCUNE ligne du journal ne raconte —
--                         un envoi en attente, un report (heures d'envoi, rafale) ou une
--                         annulation écrits par l'ancien moteur, qui ne journalisait pas.
--                         Si le moteur a écrit une ligne pour ce report ou cette annulation,
--                         la ligne compte et la tâche ne compte pas : jamais deux fois.
--
--    LE CODE D'ISSUE d'une ligne du journal (colonne `issue`) :
--      fait          l'action a été exécutée (message parti, tâche créée…)
--      <code>        l'envoi a été ignoré, reporté ou annulé : `result_data.saute_code`
--      en_cours      réservation du moteur, ou action plus lente que 5 s (la ligne sera complétée)
--      interrompue   réservation restée « en cours » plus de 15 minutes (processus coupé)
--      echec         échec DÉFINITIF — un seul par action, quel que soit le nombre de tentatives
--      en_reprise    échec passager, une nouvelle tentative est en file
--      echec_repris  échec suivi d'une reprise qui a abouti (ou a été annulée)
--      tentative     tentative intermédiaire d'une action qui a fini en échec définitif
--    et, pour une tâche de la file :
--      en_attente    tâche en file
--      annulee       tâche annulée sans code (ancien moteur)
--
--    Lignes ANCIENNES :
--    · « Frequency cap reached for +1… » était écrit comme un ÉCHEC (D-03) : c'est un envoi
--      ignoré, code `plafond_frequence` ;
--    · un saut sans code (entre le 2026-09-28 et le 2026-09-29, avant `saute_code`) ne pouvait
--      être qu'un désabonnement : code `desabonne`.
--
--    LA CATÉGORIE comptée (colonne `categorie`) :
--      fait → 'envoyee' si l'action envoie un message au CLIENT (`p_messages`), sinon 'action'
--             (tâche, étiquette, notification interne… : jamais un « envoi ») ;
--      echec, interrompue → 'echouee' ; en_cours, en_reprise, en_attente → 'en_cours' ;
--      tentative, echec_repris → 'tentative' (jamais comptées) ; annulee → 'annulee' ;
--      tout autre code → `p_categories` (src/lib/automationMotifs.ts), 'ignoree' s'il est inconnu.
--
--    entree : la ligne marque l'ENTRÉE d'une fiche dans l'automatisation (un déclenchement) —
--             une action immédiate, ou la première tâche posée (action différée, report, première
--             étape d'un parcours). Les étapes suivantes et les reprises n'en sont pas.
--    refus  : l'événement a été écarté AVANT d'entrer (conditions, hors ciblage, une fois par
--             client, bureau en pause) : ignoré, pas déclenché.
--    en_file : la tâche est encore en attente ou en cours.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.automation_evenements(
  p_org uuid,
  p_depuis timestamptz,
  p_rule uuid,
  p_categories jsonb,
  p_messages text[]
)
returns table (
  source text,
  id uuid,
  rule_id uuid,
  entity_type text,
  entity_id uuid,
  task_id uuid,
  step_id text,
  action_type text,
  quand timestamptz,
  issue text,
  categorie text,
  entree boolean,
  refus boolean,
  en_file boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with taches as materialized (
    select t.id, t.automation_rule_id as rule_id, t.entity_type, t.entity_id, t.status, t.step_id,
           t.created_at, t.completed_at, t.execution_key,
           coalesce(t.action_config->>'type', '') as action_type,
           nullif(t.action_config->>'motif_code', '') as motif_code,
           coalesce(t.action_config->>'reprise_immediate', '') = 'true' as reprise,
           case
             when p_categories->>nullif(t.action_config->>'motif_code', '') = 'reportee' then t.action_config->>'motif_code'
             when coalesce(t.action_config->>'report_rafale', '') = 'true' then 'rafale'
             when coalesce(t.action_config->>'report_heures_calmes', '') = 'true' then 'hors_heures'
           end as code_report,
           case when (t.sequence_context->>'franchies') ~ '^[0-9]+$'
                then (t.sequence_context->>'franchies')::integer else 1 end as franchies
      from public.automation_scheduled_tasks t
     where t.org_id = p_org
       and (p_rule is null or t.automation_rule_id = p_rule)
       and (t.status in ('pending', 'running') or t.created_at >= p_depuis or t.completed_at >= p_depuis)
  ),
  lignes as materialized (
    select l.id, l.automation_rule_id as rule_id, l.entity_type, l.entity_id, l.scheduled_task_id,
           l.action_type, l.trigger_event, l.created_at, l.execution_key,
           case
             when not l.result_success then
               case
                 when l.result_error = 'en cours' or l.result_error like '%résultat en attente%' then
                   case when l.created_at < now() - interval '15 minutes' then 'interrompue' else 'en_cours' end
                 when l.result_error ilike 'frequency cap reached%' then 'plafond_frequence'
                 else 'echec'
               end
             when nullif(l.result_data->>'saute_code', '') is not null then l.result_data->>'saute_code'
             when nullif(l.result_data->>'saute', '') is not null then 'desabonne'
             else 'fait'
           end as base
      from public.automation_execution_logs l
     where l.org_id = p_org
       and l.automation_rule_id is not null
       and (p_rule is null or l.automation_rule_id = p_rule)
       and l.created_at >= p_depuis
  ),
  -- Les ÉCHECS seulement (le reste n'a pas besoin de la file). Une action IMMÉDIATE en échec
  -- passager est reprise par une tâche (`reprise_immediate`) qui porte la même clé d'exécution,
  -- sans la tranche de 2 minutes (« @… »).
  echecs_lies as (
    select distinct on (l.id) l.id, l.scheduled_task_id, l.created_at, coalesce(l.scheduled_task_id, r.id) as tache_liee
      from lignes l
      left join taches r
        on l.scheduled_task_id is null
       and l.execution_key is not null
       and r.reprise
       and r.rule_id = l.rule_id
       and r.entity_id = l.entity_id
       and starts_with(r.execution_key, split_part(l.execution_key, '@', 1))
       and r.created_at between l.created_at - interval '1 minute' and l.created_at + interval '10 minutes'
     where l.base = 'echec'
     order by l.id, r.created_at
  ),
  echecs as (
    select e.id, e.tache_liee,
           case
             when t.id is null then 'echec'
             when t.status in ('pending', 'running') then 'en_reprise'
             when t.status = 'failed' then
               case when row_number() over (
                           partition by e.tache_liee
                           order by (e.scheduled_task_id is not null) desc, e.created_at desc, e.id desc
                         ) = 1
                    then 'echec' else 'tentative' end
             else 'echec_repris'
           end as issue
      from echecs_lies e
      left join taches t on t.id = e.tache_liee
  ),
  lignes_finales as (
    select l.id, l.rule_id, l.entity_type, l.entity_id, l.scheduled_task_id,
           coalesce(e.tache_liee, l.scheduled_task_id) as tache_liee,
           l.action_type, l.trigger_event, l.created_at, t.step_id,
           coalesce(e.issue, l.base) as issue
      from lignes l
      left join echecs e on e.id = l.id
      left join taches t on t.id = coalesce(e.tache_liee, l.scheduled_task_id)
  ),
  -- Les lignes CODÉES du nouveau moteur qui racontent un report ou une annulation.
  lignes_codees as (
    select l.rule_id, l.entity_id, l.scheduled_task_id, l.created_at, p_categories->>l.issue as categorie
      from lignes_finales l
     where p_categories->>l.issue in ('reportee', 'annulee')
  ),
  -- Un report que le journal ne raconte pas (ancien moteur) : il est lu sur la tâche.
  reports as (
    select t.id
      from taches t
     where t.code_report is not null
       and not exists (
         select 1 from lignes_codees l
          where l.rule_id = t.rule_id and l.entity_id = t.entity_id and l.categorie = 'reportee'
            and (l.scheduled_task_id = t.id
                 or l.created_at between t.created_at - interval '2 minutes' and t.created_at + interval '2 minutes')
       )
  ),
  -- Une annulation ou un échec de la file que le journal ne raconte pas.
  fins as (
    select t.id,
           case when t.status = 'cancelled' then coalesce(t.motif_code, 'annulee') else 'echec' end as issue
      from taches t
     where (t.status = 'cancelled' and not exists (
              select 1 from lignes_codees l
               where l.rule_id = t.rule_id and l.entity_id = t.entity_id and l.categorie = 'annulee'
                 and (l.scheduled_task_id = t.id
                      or l.created_at between coalesce(t.completed_at, t.created_at) - interval '2 minutes'
                                          and coalesce(t.completed_at, t.created_at) + interval '2 minutes')
            ))
        or (t.status = 'failed' and not exists (
              select 1 from echecs e where e.tache_liee = t.id and e.issue in ('echec', 'tentative')
            ))
  ),
  tout as (
    -- Les lignes du journal.
    select 'journal'::text as source, l.id, l.rule_id, l.entity_type, l.entity_id, l.tache_liee as task_id,
           l.step_id, l.action_type, l.created_at as quand, l.issue,
           -- Une entrée : une action immédiate. Jamais l'exécution d'une tâche de la file, ni la
           -- ligne qui raconte un report ou une annulation (ils concernent un envoi déjà prévu).
           (l.scheduled_task_id is null and l.trigger_event not in ('sequence', 'scheduled')
              and l.issue not in ('conditions', 'hors_ciblage', 'une_fois_par_client', 'pause_bureau')
              and coalesce(p_categories->>l.issue, '') not in ('reportee', 'annulee')) as entree,
           (l.scheduled_task_id is null
              and l.issue in ('conditions', 'hors_ciblage', 'une_fois_par_client', 'pause_bureau')) as refus,
           false as en_file
      from lignes_finales l
    union all
    -- Chaque tâche : repère d'entrée, et « en attente » tant qu'elle est en file.
    select 'tache', t.id, t.rule_id, t.entity_type, t.entity_id, t.id, t.step_id, t.action_type, t.created_at,
           case when t.status in ('pending', 'running') and r.id is null then 'en_attente' end,
           ((t.step_id is null and not t.reprise) or (t.step_id is not null and t.franchies <= 1)),
           false,
           t.status in ('pending', 'running')
      from taches t
      left join reports r on r.id = t.id
    union all
    -- Le report (ancien moteur : aucune ligne de journal).
    select 'tache', t.id, t.rule_id, t.entity_type, t.entity_id, t.id, t.step_id, t.action_type, t.created_at,
           t.code_report, false, false, t.status in ('pending', 'running')
      from taches t
      join reports r on r.id = t.id
    union all
    -- L'annulation, ou l'échec sans ligne.
    select 'tache', t.id, t.rule_id, t.entity_type, t.entity_id, t.id, t.step_id, t.action_type,
           coalesce(t.completed_at, t.created_at), f.issue, false, false, false
      from taches t
      join fins f on f.id = t.id
  )
  select e.source, e.id, e.rule_id, e.entity_type, e.entity_id, e.task_id, e.step_id, e.action_type, e.quand,
         e.issue,
         case
           when e.issue is null then null
           when e.issue = 'fait' then case when e.action_type = any (p_messages) then 'envoyee' else 'action' end
           when e.issue in ('echec', 'interrompue') then 'echouee'
           when e.issue in ('en_cours', 'en_reprise', 'en_attente') then 'en_cours'
           when e.issue in ('tentative', 'echec_repris') then 'tentative'
           when e.issue = 'annulee' then 'annulee'
           else coalesce(p_categories->>e.issue, 'ignoree')
         end,
         e.entree, e.refus, e.en_file
    from tout e
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Les statistiques d'une période, de `p_depuis` à maintenant.
--
--    DÉCLENCHÉE : une fiche est entrée dans l'automatisation. Deux entrées de la même fiche dans
--    la même automatisation à moins de 2 minutes l'une de l'autre sont UN déclenchement (c'est la
--    fenêtre anti-doublon du moteur) ; le même client qui repasse dix jours plus tard en fait deux.
--
--    Rend : { lignes: [{ rule_id, action_type, issue, categorie, n }],
--             declenchees: [{ rule_id, n }], par_jour: [{ jour, n }],
--             par_jour_categorie: [{ jour, categorie, n }],
--             en_cours: [{ rule_id, n }], dernier_echec: [...], dernier_ignore: [...],
--             etapes: [{ step_id, categorie, n }] | null, etapes_en_attente: [{ step_id, n }] | null }
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.automation_statistiques(
  p_org uuid,
  p_depuis timestamptz,
  p_rule uuid,
  p_fuseau text,
  p_categories jsonb,
  p_messages text[]
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ev as materialized (
    -- 5 minutes de marge : une entrée juste après le début de la période peut être la suite
    -- d'une entrée juste avant.
    select * from public.automation_evenements(p_org, p_depuis - interval '5 minutes', p_rule, p_categories, p_messages)
  ),
  entrees as (
    select e.rule_id, e.quand,
           lag(e.quand) over (partition by e.rule_id, e.entity_id order by e.quand, e.id) as precedente
      from ev e
     where e.entree
  ),
  debuts as materialized (
    select d.rule_id, d.quand
      from entrees d
     where (d.precedente is null or d.quand - d.precedente > interval '2 minutes')
       and d.quand >= p_depuis
  ),
  dans_la_periode as materialized (
    select e.source, e.id, e.rule_id, e.step_id, e.action_type, e.quand, e.issue, e.categorie
      from ev e
     where e.issue is not null and e.quand >= p_depuis
  ),
  dernier_echec as (
    select distinct on (e.rule_id) e.rule_id, e.quand, e.action_type, e.source, e.id
      from dans_la_periode e
     where e.categorie = 'echouee'
     order by e.rule_id, e.quand desc
  ),
  dernier_ignore as (
    select distinct on (e.rule_id) e.rule_id, e.quand, e.action_type, e.issue, e.source, e.id
      from dans_la_periode e
     where e.categorie in ('ignoree', 'annulee')
     order by e.rule_id, e.quand desc
  )
  select jsonb_build_object(
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object('rule_id', x.rule_id, 'action_type', x.action_type, 'issue', x.issue, 'categorie', x.categorie, 'n', x.n))
        from (select e.rule_id, e.action_type, e.issue, e.categorie, count(*) as n
                from dans_la_periode e group by 1, 2, 3, 4) x
    ), '[]'::jsonb),
    'declenchees', coalesce((
      select jsonb_agg(jsonb_build_object('rule_id', x.rule_id, 'n', x.n))
        from (select d.rule_id, count(*) as n from debuts d group by 1) x
    ), '[]'::jsonb),
    'par_jour', coalesce((
      select jsonb_agg(jsonb_build_object('jour', x.jour, 'n', x.n) order by x.jour)
        from (select (d.quand at time zone p_fuseau)::date as jour, count(*) as n from debuts d group by 1) x
    ), '[]'::jsonb),
    'par_jour_categorie', coalesce((
      select jsonb_agg(jsonb_build_object('jour', x.jour, 'categorie', x.categorie, 'n', x.n) order by x.jour)
        from (select (e.quand at time zone p_fuseau)::date as jour, e.categorie, count(*) as n
                from dans_la_periode e group by 1, 2) x
    ), '[]'::jsonb),
    'en_cours', coalesce((
      select jsonb_agg(jsonb_build_object('rule_id', x.rule_id, 'n', x.n))
        from (select t.automation_rule_id as rule_id, count(distinct t.entity_id) as n
                from public.automation_scheduled_tasks t
               where t.org_id = p_org and t.status in ('pending', 'running')
                 and (p_rule is null or t.automation_rule_id = p_rule)
               group by 1) x
    ), '[]'::jsonb),
    'dernier_echec', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rule_id', d.rule_id, 'quand', d.quand, 'action_type', d.action_type,
               'erreur', case when d.source = 'journal'
                              then (select l.result_error from public.automation_execution_logs l where l.id = d.id)
                              else (select t.last_error from public.automation_scheduled_tasks t where t.id = d.id) end))
        from dernier_echec d
    ), '[]'::jsonb),
    'dernier_ignore', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rule_id', d.rule_id, 'quand', d.quand, 'action_type', d.action_type, 'issue', d.issue,
               'detail', case when d.source = 'journal'
                              then (select l.result_data->>'saute' from public.automation_execution_logs l where l.id = d.id)
                              else (select t.last_error from public.automation_scheduled_tasks t where t.id = d.id) end))
        from dernier_ignore d
    ), '[]'::jsonb),
    'etapes', case when p_rule is null then null else coalesce((
      select jsonb_agg(jsonb_build_object('step_id', x.step_id, 'categorie', x.categorie, 'n', x.n))
        from (select e.step_id, e.categorie, count(*) as n
                from dans_la_periode e
               where e.step_id is not null and e.source = 'journal'
               group by 1, 2) x
    ), '[]'::jsonb) end,
    'etapes_en_attente', case when p_rule is null then null else coalesce((
      select jsonb_agg(jsonb_build_object('step_id', x.step_id, 'n', x.n))
        from (select t.step_id, count(*) as n
                from public.automation_scheduled_tasks t
               where t.org_id = p_org and t.automation_rule_id = p_rule
                 and t.step_id is not null and t.status in ('pending', 'running')
               group by 1) x
    ), '[]'::jsonb) end
  )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Les Journaux : chaque événement, le plus récent d'abord, filtré et paginé EN BASE.
--    Rend { total, actions: [types présents], lignes: [...] }. Au plus 200 lignes par page.
--
--    Filtres : automatisation (`p_rule`), dates, catégories (`p_statuts`), type d'action,
--    client (`p_client`) ou recherche par nom (`p_recherche` : prénom, nom, entreprise).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.automation_journal(
  p_org uuid,
  p_depuis timestamptz,
  p_jusqua timestamptz,
  p_rule uuid,
  p_statuts text[],
  p_action text,
  p_client uuid,
  p_recherche text,
  p_categories jsonb,
  p_messages text[],
  p_limite integer,
  p_decalage integer
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with clients_trouves as materialized (
    select c.id
      from public.clients c
     where c.org_id = p_org
       and (p_client is not null or nullif(btrim(coalesce(p_recherche, '')), '') is not null)
       and (p_client is null or c.id = p_client)
       and (nullif(btrim(coalesce(p_recherche, '')), '') is null
            or (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '') || ' ' || coalesce(c.company, ''))
               ilike '%' || replace(replace(replace(btrim(p_recherche), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     limit 500
  ),
  -- Toutes les fiches de ces clients : le journal cite une facture, un devis, un job…
  fiches as materialized (
    select id from clients_trouves
    union all select q.id from public.quotes q where q.org_id = p_org and q.client_id in (select id from clients_trouves)
    union all select i.id from public.invoices i where i.org_id = p_org and i.client_id in (select id from clients_trouves)
    union all select j.id from public.jobs j where j.org_id = p_org and j.client_id in (select id from clients_trouves)
    union all select d.id from public.deals d where d.org_id = p_org and d.client_id in (select id from clients_trouves)
    union all select e.id from public.schedule_events e
               join public.jobs j on j.id = e.job_id and j.org_id = e.org_id
              where e.org_id = p_org and j.client_id in (select id from clients_trouves)
  ),
  ev as materialized (
    select e.source, e.id, e.rule_id, e.entity_type, e.entity_id, e.task_id, e.step_id, e.action_type,
           e.quand, e.issue, e.categorie
      from public.automation_evenements(p_org, p_depuis, p_rule, p_categories, p_messages) e
     where e.issue is not null
       and e.quand >= p_depuis
       and (p_jusqua is null or e.quand <= p_jusqua)
       and ((p_client is null and nullif(btrim(coalesce(p_recherche, '')), '') is null)
            or e.entity_id in (select id from fiches))
  ),
  filtres as materialized (
    select * from ev e
     where (p_statuts is null or e.categorie = any (p_statuts))
       and (p_action is null or e.action_type = p_action)
  ),
  page as materialized (
    select * from filtres e
     order by e.quand desc, e.id desc, e.issue
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
    offset greatest(coalesce(p_decalage, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtres),
    'actions', coalesce((
      select jsonb_agg(x.action_type order by x.action_type)
        from (select distinct e.action_type from ev e where e.action_type <> '') x
    ), '[]'::jsonb),
    'lignes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'source', p.source, 'id', p.id, 'issue', p.issue, 'categorie', p.categorie, 'quand', p.quand,
               'rule_id', p.rule_id, 'rule_nom', r.name,
               'entity_type', p.entity_type, 'entity_id', p.entity_id,
               'client_id', c.id,
               'client_nom', nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
               'task_id', p.task_id, 'step_id', p.step_id, 'action_type', p.action_type,
               'trigger_event', coalesce(l.trigger_event, t.action_config->>'trigger_event'),
               'result_error', l.result_error,
               'result_data', l.result_data,
               'action_config', coalesce(l.action_config, t.action_config),
               'duration_ms', l.duration_ms,
               'execution_key', coalesce(l.execution_key, t.execution_key),
               'tache', case when t.id is null then null else jsonb_build_object(
                 'status', t.status, 'execute_at', t.execute_at, 'attempts', t.attempts,
                 'last_error', t.last_error, 'completed_at', t.completed_at) end
             ) order by p.quand desc, p.id desc, p.issue)
        from page p
        left join public.automation_rules r on r.id = p.rule_id
        left join public.automation_execution_logs l on p.source = 'journal' and l.id = p.id
        left join public.automation_scheduled_tasks t on t.id = p.task_id
        left join public.clients c
               on c.id = public.automation_client_de(p_org, p.entity_type, p.entity_id) and c.deleted_at is null
    ), '[]'::jsonb)
  )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. L'Historique : UNE ligne par passage d'un client dans une automatisation, le plus récent
--    d'abord, filtré et paginé EN BASE. Rend { total, passages: [...] }.
--
--    Un passage = une entrée (même définition que « déclenchée ») et tout ce qui la suit pour la
--    même fiche : étapes du parcours, reprises, annulation. Un événement écarté avant d'entrer
--    (hors ciblage…) a sa propre ligne : c'est la réponse à « pourquoi ce client n'a rien reçu ».
--    Un passage commencé avant la période et encore en file est montré aussi (envois à venir).
--
--    resultat : en_cours (une tâche est encore en file) > echouee > envoyee > action > annulee
--               > ignoree > reportee.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.automation_passages(
  p_org uuid,
  p_depuis timestamptz,
  p_jusqua timestamptz,
  p_rule uuid,
  p_statuts text[],
  p_client uuid,
  p_recherche text,
  p_categories jsonb,
  p_messages text[],
  p_limite integer,
  p_decalage integer
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with clients_trouves as materialized (
    select c.id
      from public.clients c
     where c.org_id = p_org
       and (p_client is not null or nullif(btrim(coalesce(p_recherche, '')), '') is not null)
       and (p_client is null or c.id = p_client)
       and (nullif(btrim(coalesce(p_recherche, '')), '') is null
            or (coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '') || ' ' || coalesce(c.company, ''))
               ilike '%' || replace(replace(replace(btrim(p_recherche), '\', '\\'), '%', '\%'), '_', '\_') || '%')
     limit 500
  ),
  fiches as materialized (
    select id from clients_trouves
    union all select q.id from public.quotes q where q.org_id = p_org and q.client_id in (select id from clients_trouves)
    union all select i.id from public.invoices i where i.org_id = p_org and i.client_id in (select id from clients_trouves)
    union all select j.id from public.jobs j where j.org_id = p_org and j.client_id in (select id from clients_trouves)
    union all select d.id from public.deals d where d.org_id = p_org and d.client_id in (select id from clients_trouves)
    union all select e.id from public.schedule_events e
               join public.jobs j on j.id = e.job_id and j.org_id = e.org_id
              where e.org_id = p_org and j.client_id in (select id from clients_trouves)
  ),
  ev as materialized (
    select * from public.automation_evenements(p_org, p_depuis - interval '5 minutes', p_rule, p_categories, p_messages) e
     where (p_client is null and nullif(btrim(coalesce(p_recherche, '')), '') is null)
        or e.entity_id in (select id from fiches)
  ),
  avec_precedente as (
    select e.*,
           max(e.quand) filter (where e.entree) over (
             partition by e.rule_id, e.entity_id
             order by e.quand, (not e.entree), e.id, e.issue nulls first
             rows between unbounded preceding and 1 preceding
           ) as precedente
      from ev e
  ),
  -- rang : le numéro du passage de cette fiche dans cette automatisation (0 = commencé avant la
  -- période lue). Un refus à l'entrée a sa propre ligne (`refus_id`).
  groupes as materialized (
    select a.source, a.id, a.rule_id, a.entity_type, a.entity_id, a.task_id, a.step_id, a.action_type,
           a.quand, a.issue, a.categorie, a.entree, a.en_file,
           case when a.refus then a.id end as refus_id,
           sum(case when a.entree and (a.precedente is null or a.quand - a.precedente > interval '2 minutes') then 1 else 0 end) over (
             partition by a.rule_id, a.entity_id
             order by a.quand, (not a.entree), a.id, a.issue nulls first
             rows unbounded preceding
           ) as rang
      from avec_precedente a
  ),
  passages as (
    select g.rule_id, g.entity_id, g.rang, g.refus_id,
           min(g.entity_type) as entity_type,
           coalesce(min(g.quand) filter (where g.entree), min(g.quand)) as debut,
           max(g.quand) as fin,
           bool_or(g.en_file) as en_file,
           bool_or(g.entree) as declenche,
           case
             when bool_or(g.en_file) then 'en_cours'
             when bool_or(g.categorie = 'echouee') then 'echouee'
             when bool_or(g.categorie = 'envoyee') then 'envoyee'
             when bool_or(g.categorie = 'action') then 'action'
             when bool_or(g.categorie = 'annulee') then 'annulee'
             when bool_or(g.categorie = 'ignoree') then 'ignoree'
             when bool_or(g.categorie = 'reportee') then 'reportee'
             when bool_or(g.categorie = 'en_cours') then 'en_cours'
             else 'tentative'
           end as resultat
      from groupes g
     group by g.rule_id, g.entity_id, g.rang, g.refus_id
    having bool_or(g.issue is not null)
  ),
  filtres as materialized (
    select p.* from passages p
     where (p.debut >= p_depuis or p.en_file)
       and (p_jusqua is null or p.debut <= p_jusqua)
       and (p_statuts is null or p.resultat = any (p_statuts))
  ),
  page as materialized (
    select * from filtres p
     order by p.debut desc, p.rule_id, p.entity_id, p.rang, p.refus_id
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
    offset greatest(coalesce(p_decalage, 0), 0)
  ),
  -- Le détail des passages de la PAGE seulement (jointure, pas une relecture par passage).
  evenements_page as (
    select g.rule_id, g.entity_id, g.rang, g.refus_id,
           jsonb_agg(jsonb_build_object(
             'source', g.source, 'id', g.id, 'issue', g.issue, 'categorie', g.categorie, 'quand', g.quand,
             'action_type', g.action_type, 'step_id', g.step_id, 'en_file', g.en_file,
             'trigger_event', coalesce(l.trigger_event, t.action_config->>'trigger_event'),
             'detail', case when g.source = 'journal' then coalesce(l.result_data->>'saute', l.result_error) else t.last_error end,
             'execute_at', t.execute_at, 'attempts', t.attempts
           ) order by g.quand, (not g.entree), g.id, g.issue) as evenements
      from groupes g
      join page p
        on p.rule_id = g.rule_id and p.entity_id = g.entity_id and p.rang = g.rang
       and p.refus_id is not distinct from g.refus_id
      left join public.automation_execution_logs l on g.source = 'journal' and l.id = g.id
      left join public.automation_scheduled_tasks t on t.id = g.task_id
     where g.issue is not null
     group by g.rule_id, g.entity_id, g.rang, g.refus_id
  )
  select jsonb_build_object(
    'total', (select count(*) from filtres),
    'passages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cle', coalesce('r:' || p.refus_id::text, 'p:' || p.rule_id::text || ':' || p.entity_id::text || ':' || p.rang::text),
               'rule_id', p.rule_id, 'rule_nom', r.name,
               'entity_type', p.entity_type, 'entity_id', p.entity_id,
               'client_id', c.id,
               'client_nom', nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
               'debut', p.debut, 'fin', p.fin, 'en_file', p.en_file, 'declenche', p.declenche, 'resultat', p.resultat,
               'evenements', coalesce(e.evenements, '[]'::jsonb)
             ) order by p.debut desc, p.rule_id, p.entity_id, p.rang, p.refus_id)
        from page p
        left join evenements_page e
               on e.rule_id = p.rule_id and e.entity_id = p.entity_id and e.rang = p.rang
              and e.refus_id is not distinct from p.refus_id
        left join public.automation_rules r on r.id = p.rule_id
        left join public.clients c
               on c.id = public.automation_client_de(p_org, p.entity_type, p.entity_id) and c.deleted_at is null
    ), '[]'::jsonb)
  )
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Droits : les membres connectés (la RLS décide de ce qu'ils voient) et le serveur.
-- `anon` et PUBLIC n'exécutent rien — révoqués NOMMÉMENT (les droits par défaut de Supabase
-- donnent EXECUTE à anon sur toute nouvelle fonction).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.automation_client_de(uuid, text, uuid)',
    'public.automation_evenements(uuid, timestamptz, uuid, jsonb, text[])',
    'public.automation_statistiques(uuid, timestamptz, uuid, text, jsonb, text[])',
    'public.automation_journal(uuid, timestamptz, timestamptz, uuid, text[], text, uuid, text, jsonb, text[], integer, integer)',
    'public.automation_passages(uuid, timestamptz, timestamptz, uuid, text[], uuid, text, jsonb, text[], integer, integer)'
  ] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

comment on function public.automation_statistiques(uuid, timestamptz, uuid, text, jsonb, text[]) is
  'Statistiques des automatisations d''un bureau depuis p_depuis : une seule définition, comptée en base (SECURITY INVOKER : la RLS de l''appelant s''applique).';
comment on function public.automation_journal(uuid, timestamptz, timestamptz, uuid, text[], text, uuid, text, jsonb, text[], integer, integer) is
  'Journaux des automatisations : événements filtrés et paginés en base, avec le total (SECURITY INVOKER).';
comment on function public.automation_passages(uuid, timestamptz, timestamptz, uuid, text[], uuid, text, jsonb, text[], integer, integer) is
  'Historique des automatisations : une ligne par passage d''un client, paginé en base, avec le total (SECURITY INVOKER).';

commit;
