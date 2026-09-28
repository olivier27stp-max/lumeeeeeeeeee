-- ═══════════════════════════════════════════════════════════════
-- « Soumission ouverte par le client » — suivi, événement, déclencheur
--
-- Mission du 2026-09-28. Cette migration ne MODIFIE AUCUNE donnée existante :
-- colonnes ajoutées, fonctions nouvelles, et le modèle de pipeline des
-- NOUVELLES entreprises. L'insertion de l'étape dans les pipelines déjà
-- existants est une migration SÉPARÉE (20260929220000), soumise à l'accord
-- de Rafba parce qu'elle décale leurs étapes.
--
-- 1. quote_views (Loi 25 : minimisation). La table stockait l'IP et le
--    navigateur EN CLAIR. Les nouvelles lignes n'en portent plus : seulement
--    des empreintes (session, navigateur) — assez pour dédoublonner, rien
--    pour identifier. Les 93 lignes anciennes ne sont pas touchées ici (voir
--    le rapport). + org_id et une règle de lecture par entreprise : les
--    lignes de SOUMISSION n'avaient aucune règle (seules celles de facture).
-- 2. `enregistrer_vue_soumission` : UNE fonction, atomique — la « première
--    vue » ne peut être attribuée qu'une fois même si deux ouvertures
--    arrivent en même temps (verrou sur la ligne du devis), et une même
--    session ne compte qu'une vue par 30 minutes.
-- 3. `pipeline_stages.role_systeme` : repérer « envoyée » / « ouverte » par
--    un rôle, pas par le nom.
-- 4. Modèle de pipeline (nouvelles entreprises) : étape « Soumission ouverte »
--    (« Estimation ouverte » en construction) entre « envoyée » et la
--    suivante, + probabilités réparties (elles étaient vides).
-- 5. Automatisations par défaut, pour chaque entreprise EXISTANTE (nouvelles
--    lignes seulement, jamais de doublon — clé `preset_key`) :
--      · quote_opened_notify     — me notifier (active)
--      · quote_opened_move_deal  — avancer le deal (active, visible, désactivable)
--
-- ROLLBACK :
--   delete from public.automation_rules where preset_key in ('quote_opened_notify','quote_opened_move_deal');
--   rejouer la définition précédente de seed_pipeline_ventes ;
--   drop function if exists public.enregistrer_vue_soumission(uuid, text, text, boolean);
--   drop index if exists public.uq_pipeline_stages_role ; alter table public.pipeline_stages drop column if exists role_systeme;
--   drop policy if exists quote_views_select_soumission on public.quote_views;
--   alter table public.deal_stage_history drop column if exists motif;
--   alter table public.quote_views drop column if exists org_id, drop column if exists is_first_view,
--     drop column if exists user_agent_hash, drop column if exists session_hash;
-- ═══════════════════════════════════════════════════════════════

begin;

-- ── 1. quote_views ──────────────────────────────────────────────
alter table public.quote_views
  add column if not exists org_id uuid references public.orgs(id) on delete cascade,
  add column if not exists is_first_view boolean,
  add column if not exists user_agent_hash text,
  add column if not exists session_hash text;

comment on column public.quote_views.ip_address is
  'OBSOLÈTE (Loi 25) : plus alimentée pour les soumissions depuis 2026-09-28.';
comment on column public.quote_views.user_agent is
  'OBSOLÈTE (Loi 25) : remplacée par user_agent_hash pour les soumissions.';

create index if not exists idx_quote_views_dedup
  on public.quote_views (quote_id, session_hash, viewed_at desc)
  where quote_id is not null;

-- Les lignes de soumission : lisibles par les membres de SON entreprise.
drop policy if exists quote_views_select_soumission on public.quote_views;
create policy quote_views_select_soumission on public.quote_views
  for select to authenticated
  using (quote_id is not null and org_id is not null
         and has_org_membership((select auth.uid()), org_id));

-- ── 2. Enregistrer une vue, atomiquement ────────────────────────
create or replace function public.enregistrer_vue_soumission(
  p_quote_id uuid,
  p_session_hash text,
  p_user_agent_hash text,
  p_compter boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_q record;
  v_premiere boolean;
  v_nb integer;
begin
  -- Verrou : deux ouvertures simultanées ne peuvent pas être « la première ».
  select id, org_id, coalesce(client_id, lead_id) as contact, is_viewed, view_count
    into v_q
  from public.quotes
  where id = p_quote_id and deleted_at is null
  for update;

  if v_q.id is null then
    return jsonb_build_object('enregistree', false, 'raison', 'introuvable');
  end if;
  if not p_compter then
    return jsonb_build_object('enregistree', false, 'raison', 'exclue');
  end if;

  -- Même session, moins de 30 minutes : un rechargement n'est pas une vue.
  if p_session_hash is not null and exists (
    select 1 from public.quote_views
    where quote_id = p_quote_id and session_hash = p_session_hash
      and viewed_at > now() - interval '30 minutes'
  ) then
    return jsonb_build_object('enregistree', false, 'raison', 'doublon');
  end if;

  v_premiere := not coalesce(v_q.is_viewed, false);
  v_nb := coalesce(v_q.view_count, 0) + 1;

  update public.quotes
  set is_viewed = true,
      viewed_at = case when v_premiere then now() else viewed_at end,
      last_viewed_at = now(),
      view_count = v_nb
  where id = p_quote_id;

  insert into public.quote_views (quote_id, client_id, org_id, viewed_at, is_first_view, user_agent_hash, session_hash)
  values (p_quote_id, v_q.contact, v_q.org_id, now(), v_premiere, p_user_agent_hash, p_session_hash);

  return jsonb_build_object(
    'enregistree', true, 'premiere', v_premiere, 'nb_vues', v_nb,
    'org_id', v_q.org_id, 'contact_id', v_q.contact);
end;
$fn$;
-- Réservée au serveur (clé de service) : la page publique passe par l'API.
revoke all on function public.enregistrer_vue_soumission(uuid, text, text, boolean) from public, anon, authenticated;

-- ── 3. Rôle système d'une étape ─────────────────────────────────
alter table public.pipeline_stages add column if not exists role_systeme text;
alter table public.pipeline_stages drop constraint if exists pipeline_stages_role_systeme_check;
alter table public.pipeline_stages add constraint pipeline_stages_role_systeme_check
  check (role_systeme is null or role_systeme in ('soumission_envoyee', 'soumission_ouverte'));
create unique index if not exists uq_pipeline_stages_role
  on public.pipeline_stages (pipeline_id, role_systeme)
  where role_systeme is not null and archived_at is null;
comment on column public.pipeline_stages.role_systeme is
  'Rôle système (survit au renommage) : soumission_envoyee, soumission_ouverte. Lu par l''action « avancer le deal ».';

-- ── 3b. Le POURQUOI d'un déplacement, dans l'historique du deal ──
-- « Déplacée automatiquement — le client a ouvert la soumission ». Sans
-- lui, un déplacement fait par une règle apparaît comme « Système ».
alter table public.deal_stage_history add column if not exists motif text;
comment on column public.deal_stage_history.motif is
  'Pourquoi l''étape a changé, quand ce n''est pas un geste à l''écran (automatisation).';

-- ── 4. Modèle de pipeline des NOUVELLES entreprises ─────────────
CREATE OR REPLACE FUNCTION public.seed_pipeline_ventes(p_org_id uuid, p_modele text DEFAULT 'generique'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pipeline uuid;
begin
  select id into v_pipeline
  from public.pipelines_ventes
  where org_id = p_org_id and is_default
  limit 1;

  if v_pipeline is not null then
    return v_pipeline;
  end if;

  insert into public.pipelines_ventes (org_id, name, is_default)
  values (p_org_id, 'Pipeline de ventes', true)
  returning id into v_pipeline;

  if p_modele = 'construction' then
    insert into public.pipeline_stages
      (org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en, position, kind)
    values
      (p_org_id, v_pipeline, 'Nouveau lead', 'New lead',
       'Rappelle dans les 15 minutes : c''est là que la majorité des contrats se gagnent. Note le type de travaux et l''échéance souhaitée dès le premier appel.',
       'Call back within 15 minutes — that''s where most contracts are won. Capture the type of work and the target timeline on the first call.',
       1, 'open'),
      (p_org_id, v_pipeline, 'Visite planifiée', 'Site visit booked',
       'Confirme la visite la veille. Sur place, photographie tout : une estimation faite de mémoire se révise toujours à la hausse, et c''est le client qui le prend mal.',
       'Confirm the visit the day before. On site, photograph everything: an estimate made from memory always gets revised upward, and the client is the one who resents it.',
       2, 'open'),
      (p_org_id, v_pipeline, 'Estimation envoyée', 'Estimate sent',
       'Appelle le lendemain pour valider que le montant est compris. Une estimation envoyée sans appel de suivi se ferme deux fois moins souvent.',
       'Call the next day to confirm the amount is understood. An estimate sent without a follow-up call closes half as often.',
       3, 'open'),
      (p_org_id, v_pipeline, 'Estimation ouverte', 'Estimate opened',
       'Le client vient d''ouvrir le document : appelle maintenant, pendant qu''il a le prix sous les yeux. C''est le moment où une question se règle en deux minutes.',
       'The client just opened it: call now, while the price is in front of them. This is when a question gets settled in two minutes.',
       4, 'open'),
      (p_org_id, v_pipeline, 'Négociation', 'Negotiation',
       'Ajuste le contenu avant le prix : retire une option, étale les travaux. Baisser le prix à contenu égal dévalue tout ce que tu chiffreras ensuite.',
       'Adjust scope before price: drop an option, phase the work. Cutting the price at equal scope devalues everything you quote afterwards.',
       5, 'open'),
      (p_org_id, v_pipeline, 'Gagné', 'Won',
       'Crée la job tout de suite pour bloquer la date. Confirme les accès, le stationnement et la gestion des débris avant le premier jour.',
       'Create the job right away to lock the date. Confirm access, parking and debris handling before day one.',
       6, 'won'),
      (p_org_id, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison, pas « pas intéressé » : c''est ce qui ajuste tes prix. Remets un rappel à 6 mois si le client a seulement reporté.',
       'Log the real reason, not "not interested" — that''s what tunes your pricing. Set a 6-month reminder if the client merely postponed.',
       7, 'lost');

  elsif p_modele = 'nettoyage' then
    insert into public.pipeline_stages
      (org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en, position, kind)
    values
      (p_org_id, v_pipeline, 'Nouveau lead', 'New lead',
       'Appelle dans les 15 minutes : c''est là que la majorité des soumissions se gagnent. Note le type de surface et la superficie approximative dès le premier contact.',
       'Call within 15 minutes — that''s where most quotes are won. Capture the surface type and rough square footage on the first contact.',
       1, 'open'),
      (p_org_id, v_pipeline, 'Contacté', 'Contacted',
       'Qualifie le besoin : fréquence souhaitée, budget, accès au bâtiment. Fixe tout de suite la visite, ou envoie la soumission si le besoin est standard.',
       'Qualify the need: desired frequency, budget, building access. Book the site visit right away, or send the quote if the job is standard.',
       2, 'open'),
      (p_org_id, v_pipeline, 'Soumission envoyée', 'Quote sent',
       'Confirme la réception par téléphone le lendemain. Une soumission ouverte sans appel de suivi se ferme deux fois moins souvent.',
       'Confirm receipt by phone the next day. An open quote with no follow-up call closes half as often.',
       3, 'open'),
      (p_org_id, v_pipeline, 'Soumission ouverte', 'Quote opened',
       'Le client vient d''ouvrir le document : appelle maintenant, pendant qu''il a le prix sous les yeux. C''est le moment où une question se règle en deux minutes.',
       'The client just opened it: call now, while the price is in front of them. This is when a question gets settled in two minutes.',
       4, 'open'),
      (p_org_id, v_pipeline, 'Relance', 'Follow-up',
       'Trois relances maximum, espacées de trois jours, puis tranche. Propose un rabais première visite ou un essai d''un mois plutôt que de baisser le prix récurrent.',
       'Three follow-ups max, three days apart, then decide. Offer a first-visit discount or a one-month trial instead of cutting the recurring price.',
       5, 'open'),
      (p_org_id, v_pipeline, 'Gagné', 'Won',
       'Crée la job immédiatement pour bloquer la date dans l''horaire. Confirme les accès (codes, clés, stationnement) avant la première visite.',
       'Create the job right away to lock the date in the schedule. Confirm access (codes, keys, parking) before the first visit.',
       6, 'won'),
      (p_org_id, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison, pas « pas intéressé » : c''est ce qui ajuste les prix. Remets un rappel à 6 mois si le client a simplement reporté.',
       'Log the real reason, not "not interested" — that''s what tunes pricing. Set a 6-month reminder if the client merely postponed.',
       7, 'lost');

  else
    insert into public.pipeline_stages
      (org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en, position, kind)
    values
      (p_org_id, v_pipeline, 'Nouveau lead', 'New lead',
       'Contacte le plus vite possible : le délai de première réponse est le facteur qui pèse le plus sur le taux de closing.',
       'Reach out as fast as you can: first-response time is the single biggest factor in your closing rate.',
       1, 'open'),
      (p_org_id, v_pipeline, 'Contacté', 'Contacted',
       'Qualifie le besoin et le budget, puis fixe la prochaine étape avec une date. Un lead sans prochaine étape datée retombe au fond de la pile.',
       'Qualify the need and budget, then set the next step with a date. A lead with no dated next step sinks to the bottom of the pile.',
       2, 'open'),
      (p_org_id, v_pipeline, 'Soumission envoyée', 'Quote sent',
       'Confirme la réception, et vérifie que le prix est compris — pas seulement reçu.',
       'Confirm receipt, and check the price is understood — not just delivered.',
       3, 'open'),
      (p_org_id, v_pipeline, 'Soumission ouverte', 'Quote opened',
       'Le client vient d''ouvrir le document : appelle maintenant, pendant qu''il a le prix sous les yeux. C''est le moment où une question se règle en deux minutes.',
       'The client just opened it: call now, while the price is in front of them. This is when a question gets settled in two minutes.',
       4, 'open'),
      (p_org_id, v_pipeline, 'Relance', 'Follow-up',
       'Fixe-toi une limite de relances, puis tranche. Un deal qui traîne sans décision occupe la place d''un deal vivant.',
       'Set yourself a follow-up limit, then decide. A deal that drags with no decision takes the place of a live one.',
       5, 'open'),
      (p_org_id, v_pipeline, 'Gagné', 'Won',
       'Crée la job tout de suite : c''est ce qui relie la vente au travail réel et alimente tes revenus par source.',
       'Create the job right away: it links the sale to the actual work and feeds your revenue-by-source figures.',
       6, 'won'),
      (p_org_id, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison : c''est la seule matière qui permet d''ajuster les prix et les relances.',
       'Log the real reason: it''s the only material you have to tune pricing and follow-ups.',
       7, 'lost');
  end if;

  -- Rôles système : l'étape « envoyée » et l'étape « ouverte » sont repérées
  -- par leur RÔLE, pas par leur nom — l'entreprise peut les renommer, la
  -- règle « avancer le deal quand le client ouvre » suit toujours.
  update public.pipeline_stages set role_systeme = 'soumission_envoyee'
  where pipeline_id = v_pipeline and position = 3;
  update public.pipeline_stages set role_systeme = 'soumission_ouverte'
  where pipeline_id = v_pipeline and position = 4;

  -- Probabilités réparties comme à la création d'un pipeline (sans ça, une
  -- entreprise neuve recevait un pipeline aux probabilités vides).
  with rangs as (
    select id, kind,
           row_number() over (partition by kind order by position) as rang,
           count(*) over (partition by kind) as nb
    from public.pipeline_stages
    where pipeline_id = v_pipeline and archived_at is null
  )
  update public.pipeline_stages s
  set probability = case r.kind when 'won' then 100 when 'lost' then 0
                      else round(r.rang * 100.0 / (r.nb + 1), 2) end
  from rangs r
  where s.id = r.id and s.probability is null;

  return v_pipeline;
end;
$function$;


-- ── 5. Automatisations par défaut, entreprises existantes ───────
-- (les nouvelles les reçoivent par ensureAutomationPresets, même contenu)
insert into public.automation_rules
  (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
select o.id,
  'Me notifier quand un client ouvre sa soumission',
  'Notification (et push) au responsable de la soumission — à défaut, au propriétaire — dès la première ouverture.',
  'quote.viewed',
  '{"ouverture": "premiere"}'::jsonb,
  0,
  jsonb_build_array(jsonb_build_object(
    'type', 'create_notification',
    'config', jsonb_build_object(
      'destinataire', 'responsable',
      'title', '👀 {{client.nom}} vient d''ouvrir la soumission #{{soumission.numero}} ({{soumission.total}}). Bon moment pour appeler.',
      'body', 'Ouverte le {{soumission.ouverte_le}} · {{soumission.nb_vues}} vue(s)',
      'lien', '{{soumission.lien_interne}}'))),
  true, true, 'quote_opened_notify'
from public.orgs o
where not exists (select 1 from public.automation_rules r where r.org_id = o.id and r.preset_key = 'quote_opened_notify');

insert into public.automation_rules
  (org_id, name, description, trigger_event, conditions, delay_seconds, actions, is_active, is_preset, preset_key)
select o.id,
  'Avancer le deal quand le client ouvre sa soumission',
  'À la première ouverture, le deal lié passe de « Soumission envoyée » à « Soumission ouverte ». Jamais de retour en arrière.',
  'quote.viewed',
  '{"ouverture": "premiere"}'::jsonb,
  0,
  jsonb_build_array(jsonb_build_object(
    'type', 'move_deal_stage',
    'config', jsonb_build_object('cible', 'role', 'depuis_role', 'soumission_envoyee', 'vers_role', 'soumission_ouverte'))),
  true, true, 'quote_opened_move_deal'
from public.orgs o
where not exists (select 1 from public.automation_rules r where r.org_id = o.id and r.preset_key = 'quote_opened_move_deal');

commit;
