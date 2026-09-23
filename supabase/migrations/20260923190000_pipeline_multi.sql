-- ═══════════════════════════════════════════════════════════════
-- Pipeline de ventes — plusieurs pipelines par organisation
--
-- Le schéma le permettait déjà (`pipelines_ventes` accepte N lignes par org,
-- avec l'index partiel `uq_pipelines_ventes_defaut` qui n'autorise qu'UN
-- `is_default`). Il manquait deux opérations que PostgREST ne peut pas faire
-- correctement depuis le client :
--
--   1. Créer un pipeline AVEC ses étapes. `seed_pipeline_ventes` ne convient
--      pas : elle court-circuite si un pipeline par défaut existe déjà (c'est
--      voulu — elle sert au seed d'organisation, elle doit être idempotente),
--      et elle pose `is_default = true`. Un 2e pipeline ne doit ni court-
--      circuiter, ni voler le défaut.
--
--   2. Changer le pipeline par défaut. Deux `update` séparés violent l'index
--      partiel : entre les deux requêtes, l'org a soit deux défauts, soit
--      zéro. PostgREST envoyant chaque update dans SA PROPRE transaction, le
--      passage par une fonction est la seule façon d'avoir l'atomicité.
--      (Même raison que `pipeline_reordonner_etapes`.)
--
-- SECURITY INVOKER pour les deux : la RLS de `pipelines_ventes` et de
-- `pipeline_stages` réserve DÉJÀ l'écriture aux administrateurs
-- (`pipelines_ventes_admin_write` / `pipeline_stages_admin_write`, qui
-- testent `has_org_admin_role(auth.uid(), org_id)`), et les deux tables sont
-- en FORCE ROW LEVEL SECURITY. Un non-admin voit donc son `insert` ou son
-- `update` refusé par la policy, sans qu'aucune vérification ne soit à
-- écrire — ni à oublier — dans le corps de la fonction. Passer en SECURITY
-- DEFINER ajouterait un contrôle manuel à maintenir pour exactement le même
-- résultat.
--
-- `current_org_id()` fournit l'organisation de la session : `org_id` n'est
-- jamais un paramètre, sinon un admin pourrait créer un pipeline chez le
-- voisin en changeant un argument.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Créer un pipeline NON par défaut, avec ses étapes.
--
--    Le contenu des trois modèles est repris de `seed_pipeline_ventes`
--    (20260923110000) : un pipeline créé à la main ne doit pas être plus
--    pauvre que celui du seed — le client corrige un pipeline complet, il
--    ne part jamais d'une page blanche.
-- ───────────────────────────────────────────────────────────────
create or replace function public.creer_pipeline_ventes(
  p_nom    text,
  p_modele text default 'generique'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_org      uuid;
  v_pipeline uuid;
  v_nom      text;
begin
  v_org := public.current_org_id();
  if v_org is null then
    raise exception 'Aucune organisation pour la session en cours';
  end if;

  v_nom := btrim(coalesce(p_nom, ''));
  if v_nom = '' then
    raise exception 'Le nom du pipeline ne peut pas être vide';
  end if;

  if p_modele not in ('generique', 'nettoyage', 'construction') then
    raise exception 'Modèle inconnu : % (attendu generique, nettoyage ou construction)', p_modele;
  end if;

  -- `is_default` reste false : créer un pipeline ne déplace jamais le défaut.
  -- C'est `pipeline_definir_defaut` qui le fait, explicitement.
  insert into public.pipelines_ventes (org_id, name, is_default)
  values (v_org, v_nom, false)
  returning id into v_pipeline;

  if p_modele = 'construction' then
    insert into public.pipeline_stages
      (org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en, position, kind)
    values
      (v_org, v_pipeline, 'Nouveau lead', 'New lead',
       'Rappelle dans les 15 minutes : c''est là que la majorité des contrats se gagnent. Note le type de travaux et l''échéance souhaitée dès le premier appel.',
       'Call back within 15 minutes — that''s where most contracts are won. Capture the type of work and the target timeline on the first call.',
       1, 'open'),
      (v_org, v_pipeline, 'Visite planifiée', 'Site visit booked',
       'Confirme la visite la veille. Sur place, photographie tout : une estimation faite de mémoire se révise toujours à la hausse, et c''est le client qui le prend mal.',
       'Confirm the visit the day before. On site, photograph everything: an estimate made from memory always gets revised upward, and the client is the one who resents it.',
       2, 'open'),
      (v_org, v_pipeline, 'Estimation envoyée', 'Estimate sent',
       'Appelle le lendemain pour valider que le montant est compris. Une estimation envoyée sans appel de suivi se ferme deux fois moins souvent.',
       'Call the next day to confirm the amount is understood. An estimate sent without a follow-up call closes half as often.',
       3, 'open'),
      (v_org, v_pipeline, 'Négociation', 'Negotiation',
       'Ajuste le contenu avant le prix : retire une option, étale les travaux. Baisser le prix à contenu égal dévalue tout ce que tu chiffreras ensuite.',
       'Adjust scope before price: drop an option, phase the work. Cutting the price at equal scope devalues everything you quote afterwards.',
       4, 'open'),
      (v_org, v_pipeline, 'Gagné', 'Won',
       'Crée la job tout de suite pour bloquer la date. Confirme les accès, le stationnement et la gestion des débris avant le premier jour.',
       'Create the job right away to lock the date. Confirm access, parking and debris handling before day one.',
       5, 'won'),
      (v_org, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison, pas « pas intéressé » : c''est ce qui ajuste tes prix. Remets un rappel à 6 mois si le client a seulement reporté.',
       'Log the real reason, not "not interested" — that''s what tunes your pricing. Set a 6-month reminder if the client merely postponed.',
       6, 'lost');

  elsif p_modele = 'nettoyage' then
    insert into public.pipeline_stages
      (org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en, position, kind)
    values
      (v_org, v_pipeline, 'Nouveau lead', 'New lead',
       'Appelle dans les 15 minutes : c''est là que la majorité des soumissions se gagnent. Note le type de surface et la superficie approximative dès le premier contact.',
       'Call within 15 minutes — that''s where most quotes are won. Capture the surface type and rough square footage on the first contact.',
       1, 'open'),
      (v_org, v_pipeline, 'Contacté', 'Contacted',
       'Qualifie le besoin : fréquence souhaitée, budget, accès au bâtiment. Fixe tout de suite la visite, ou envoie la soumission si le besoin est standard.',
       'Qualify the need: desired frequency, budget, building access. Book the site visit right away, or send the quote if the job is standard.',
       2, 'open'),
      (v_org, v_pipeline, 'Soumission envoyée', 'Quote sent',
       'Confirme la réception par téléphone le lendemain. Une soumission ouverte sans appel de suivi se ferme deux fois moins souvent.',
       'Confirm receipt by phone the next day. An open quote with no follow-up call closes half as often.',
       3, 'open'),
      (v_org, v_pipeline, 'Relance', 'Follow-up',
       'Trois relances maximum, espacées de trois jours, puis tranche. Propose un rabais première visite ou un essai d''un mois plutôt que de baisser le prix récurrent.',
       'Three follow-ups max, three days apart, then decide. Offer a first-visit discount or a one-month trial instead of cutting the recurring price.',
       4, 'open'),
      (v_org, v_pipeline, 'Gagné', 'Won',
       'Crée la job immédiatement pour bloquer la date dans l''horaire. Confirme les accès (codes, clés, stationnement) avant la première visite.',
       'Create the job right away to lock the date in the schedule. Confirm access (codes, keys, parking) before the first visit.',
       5, 'won'),
      (v_org, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison, pas « pas intéressé » : c''est ce qui ajuste les prix. Remets un rappel à 6 mois si le client a simplement reporté.',
       'Log the real reason, not "not interested" — that''s what tunes pricing. Set a 6-month reminder if the client merely postponed.',
       6, 'lost');

  else
    insert into public.pipeline_stages
      (org_id, pipeline_id, name_fr, name_en, guidance_fr, guidance_en, position, kind)
    values
      (v_org, v_pipeline, 'Nouveau lead', 'New lead',
       'Contacte le plus vite possible : le délai de première réponse est le facteur qui pèse le plus sur le taux de closing.',
       'Reach out as fast as you can: first-response time is the single biggest factor in your closing rate.',
       1, 'open'),
      (v_org, v_pipeline, 'Contacté', 'Contacted',
       'Qualifie le besoin et le budget, puis fixe la prochaine étape avec une date. Un lead sans prochaine étape datée retombe au fond de la pile.',
       'Qualify the need and budget, then set the next step with a date. A lead with no dated next step sinks to the bottom of the pile.',
       2, 'open'),
      (v_org, v_pipeline, 'Soumission envoyée', 'Quote sent',
       'Confirme la réception, et vérifie que le prix est compris — pas seulement reçu.',
       'Confirm receipt, and check the price is understood — not just delivered.',
       3, 'open'),
      (v_org, v_pipeline, 'Relance', 'Follow-up',
       'Fixe-toi une limite de relances, puis tranche. Un deal qui traîne sans décision occupe la place d''un deal vivant.',
       'Set yourself a follow-up limit, then decide. A deal that drags with no decision takes the place of a live one.',
       4, 'open'),
      (v_org, v_pipeline, 'Gagné', 'Won',
       'Crée la job tout de suite : c''est ce qui relie la vente au travail réel et alimente tes revenus par source.',
       'Create the job right away: it links the sale to the actual work and feeds your revenue-by-source figures.',
       5, 'won'),
      (v_org, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison : c''est la seule matière qui permet d''ajuster les prix et les relances.',
       'Log the real reason: it''s the only material you have to tune pricing and follow-ups.',
       6, 'lost');
  end if;

  return v_pipeline;
end;
$fn$;

comment on function public.creer_pipeline_ventes(text, text) is
  'Crée un pipeline SUPPLÉMENTAIRE (is_default = false) avec ses étapes, dans l''organisation de la session. Contrairement à seed_pipeline_ventes, ne court-circuite pas si un pipeline existe déjà. SECURITY INVOKER : la RLS admin de pipelines_ventes et pipeline_stages fait le contrôle. Modèles : generique, nettoyage, construction.';

-- ───────────────────────────────────────────────────────────────
-- 2. Basculer le pipeline par défaut, en UNE transaction.
--
--    L'ordre compte : on retire d'abord le défaut aux autres, on le pose
--    ensuite. L'inverse violerait `uq_pipelines_ventes_defaut` — l'index
--    partiel est UNIQUE mais PAS deferrable, donc il est vérifié à chaque
--    ligne écrite, pas au COMMIT.
-- ───────────────────────────────────────────────────────────────
create or replace function public.pipeline_definir_defaut(p_pipeline_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_org uuid;
begin
  -- La RLS de lecture limite déjà à l'org de l'utilisateur : un id étranger
  -- ne remonte simplement pas.
  select org_id into v_org
  from public.pipelines_ventes
  where id = p_pipeline_id;

  if v_org is null then
    raise exception 'Pipeline introuvable';
  end if;

  update public.pipelines_ventes
  set is_default = false, updated_at = now()
  where org_id = v_org and id <> p_pipeline_id and is_default;

  update public.pipelines_ventes
  set is_default = true, updated_at = now()
  where id = p_pipeline_id and not is_default;

  -- Zéro ligne modifiée ET pipeline pas déjà par défaut = la policy d'écriture
  -- a refusé (l'appelant n'est pas administrateur). Sans ce contrôle, l'écran
  -- afficherait un succès pour une opération qui n'a rien fait.
  if not exists (
    select 1 from public.pipelines_ventes where id = p_pipeline_id and is_default
  ) then
    raise exception 'Changement refusé : seuls les administrateurs peuvent changer le pipeline par défaut';
  end if;
end;
$fn$;

comment on function public.pipeline_definir_defaut(uuid) is
  'Bascule is_default vers un pipeline en UNE transaction : PostgREST enverrait sinon deux updates séparés et l''index partiel uq_pipelines_ventes_defaut refuserait l''état intermédiaire.';

commit;
