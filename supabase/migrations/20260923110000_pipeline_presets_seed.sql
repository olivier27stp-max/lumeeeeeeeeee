-- ═══════════════════════════════════════════════════════════════
-- Pipeline de ventes — presets et seed (Phase 3)
--
-- Le client ne part pas d'une page blanche : il reçoit un pipeline complet
-- (étapes + conseils), qu'il corrige au lieu de configurer. C'est la
-- différence entre « voici un outil, débrouille-toi » et « voici ton
-- pipeline, ajuste ce qui ne te convient pas ».
--
-- Trois modèles :
--   · generique    — Nouveau lead → Contacté → Soumission → Relance → Gagné/Perdu
--   · nettoyage    — même ossature, conseils propres au nettoyage
--   · construction — Visite planifiée et Estimation remplacent Soumission
--
-- Les CONSEILS (guidance) sont le « Path » de Salesforce : une phrase utile
-- affichée au vendeur dans la fiche du deal, à l'étape où il travaille. Ils
-- sont écrits en FR et EN, et le client peut tout réécrire.
--
-- Ce fichier NE crée AUCUNE action d'automatisation : les recettes de
-- workflow arrivent avec l'écran qui permet de les activer (Phase 5). Semer
-- des règles que personne ne peut voir ni éteindre serait pire que rien.
--
-- Ce fichier NE touche PAS `pipeline_deals` : l'ancien board D2D continue de
-- tourner. Son retrait vient après le rebranchement de la Vente Map et des
-- Commissions.
-- ═══════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────
-- 1. Semer un pipeline pour une organisation.
--    Idempotent : si l'org a déjà un pipeline par défaut, on ne fait rien.
--    C'est ce qui permet de relancer la fonction sans dupliquer.
-- ───────────────────────────────────────────────────────────────
create or replace function public.seed_pipeline_ventes(
  p_org_id uuid,
  p_modele text default 'generique'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
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
      (p_org_id, v_pipeline, 'Négociation', 'Negotiation',
       'Ajuste le contenu avant le prix : retire une option, étale les travaux. Baisser le prix à contenu égal dévalue tout ce que tu chiffreras ensuite.',
       'Adjust scope before price: drop an option, phase the work. Cutting the price at equal scope devalues everything you quote afterwards.',
       4, 'open'),
      (p_org_id, v_pipeline, 'Gagné', 'Won',
       'Crée la job tout de suite pour bloquer la date. Confirme les accès, le stationnement et la gestion des débris avant le premier jour.',
       'Create the job right away to lock the date. Confirm access, parking and debris handling before day one.',
       5, 'won'),
      (p_org_id, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison, pas « pas intéressé » : c''est ce qui ajuste tes prix. Remets un rappel à 6 mois si le client a seulement reporté.',
       'Log the real reason, not "not interested" — that''s what tunes your pricing. Set a 6-month reminder if the client merely postponed.',
       6, 'lost');

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
      (p_org_id, v_pipeline, 'Relance', 'Follow-up',
       'Trois relances maximum, espacées de trois jours, puis tranche. Propose un rabais première visite ou un essai d''un mois plutôt que de baisser le prix récurrent.',
       'Three follow-ups max, three days apart, then decide. Offer a first-visit discount or a one-month trial instead of cutting the recurring price.',
       4, 'open'),
      (p_org_id, v_pipeline, 'Gagné', 'Won',
       'Crée la job immédiatement pour bloquer la date dans l''horaire. Confirme les accès (codes, clés, stationnement) avant la première visite.',
       'Create the job right away to lock the date in the schedule. Confirm access (codes, keys, parking) before the first visit.',
       5, 'won'),
      (p_org_id, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison, pas « pas intéressé » : c''est ce qui ajuste les prix. Remets un rappel à 6 mois si le client a simplement reporté.',
       'Log the real reason, not "not interested" — that''s what tunes pricing. Set a 6-month reminder if the client merely postponed.',
       6, 'lost');

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
      (p_org_id, v_pipeline, 'Relance', 'Follow-up',
       'Fixe-toi une limite de relances, puis tranche. Un deal qui traîne sans décision occupe la place d''un deal vivant.',
       'Set yourself a follow-up limit, then decide. A deal that drags with no decision takes the place of a live one.',
       4, 'open'),
      (p_org_id, v_pipeline, 'Gagné', 'Won',
       'Crée la job tout de suite : c''est ce qui relie la vente au travail réel et alimente tes revenus par source.',
       'Create the job right away: it links the sale to the actual work and feeds your revenue-by-source figures.',
       5, 'won'),
      (p_org_id, v_pipeline, 'Perdu', 'Lost',
       'Note la vraie raison : c''est la seule matière qui permet d''ajuster les prix et les relances.',
       'Log the real reason: it''s the only material you have to tune pricing and follow-ups.',
       6, 'lost');
  end if;

  return v_pipeline;
end;
$fn$;

revoke all on function public.seed_pipeline_ventes(uuid, text) from public, anon, authenticated;

comment on function public.seed_pipeline_ventes(uuid, text) is
  'Sème un pipeline complet (étapes + conseils) pour une organisation. Idempotent : ne fait rien si un pipeline par défaut existe déjà. Modèles : generique, nettoyage, construction.';

-- ───────────────────────────────────────────────────────────────
-- 2. Les organisations existantes
-- ───────────────────────────────────────────────────────────────
do $$
declare
  v_org uuid;
  v_n integer := 0;
begin
  for v_org in select id from public.orgs loop
    perform public.seed_pipeline_ventes(v_org, 'generique');
    v_n := v_n + 1;
  end loop;
  raise notice 'Pipeline semé pour % organisation(s)', v_n;
end
$$;

-- ───────────────────────────────────────────────────────────────
-- 3. Les organisations à venir — même point d'accroche que les
--    automatisations, et même garde-fou : un échec de seed ne doit
--    JAMAIS empêcher la création d'une organisation.
-- ───────────────────────────────────────────────────────────────
create or replace function public.handle_org_created_seed_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_automation_presets(new.id);
  perform public.apply_automation_presets_fr(new.id);
  perform public.apply_appointment_contract_link(new.id);
  perform public.seed_agreement_signed_preset(new.id);
  perform public.seed_pipeline_ventes(new.id, 'generique');
  return new;
exception when others then
  raise warning 'seed automations failed for org %: %', new.id, sqlerrm;
  return new;
end;
$$;

commit;
