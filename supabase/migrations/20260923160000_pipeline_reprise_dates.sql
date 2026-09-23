-- ═══════════════════════════════════════════════════════════════
-- Les deals repris retrouvent leurs vraies dates d'activité
--
-- La reprise (20260923150000) passait bien `last_activity_at` et
-- `stage_entered_at`, mais le trigger `deals_horodater_etape` les réécrit à
-- `now()` à chaque insertion — c'est son rôle sur un mouvement réel, et il
-- ne fait pas la différence avec une reprise d'historique.
--
-- Effet visible : un deal créé le 13 avril affichait « 162 j » d'ancienneté
-- et, juste à côté, une pastille de priorité VERTE — la priorité se calcule
-- sur l'inactivité, et l'inactivité disait « aujourd'hui ». Deux chiffres
-- contradictoires sur la même carte, dont l'un était faux.
--
-- On recale donc les deals repris sur la date de leur ancienne ligne. Le
-- garde-fou `first_contacted_at` n'est pas concerné (il reste NULL sur une
-- reprise : on ne sait pas quand ces leads ont été contactés, et l'inventer
-- fausserait la statistique de vitesse de premier contact).
--
-- Ne touche QUE les deals portant `raw_payload->>'repris_de' = 'pipeline_deals'`.
-- ═══════════════════════════════════════════════════════════════

begin;

update public.deals d
set last_activity_at = coalesce(pd.updated_at, pd.created_at),
    stage_entered_at = coalesce(pd.updated_at, pd.created_at)
from public.pipeline_deals pd
where d.external_id = pd.id::text
  and d.raw_payload ->> 'repris_de' = 'pipeline_deals'
  and d.deleted_at is null
  -- Ne rien faire si la date est déjà correcte : la migration est rejouable.
  and d.last_activity_at is distinct from coalesce(pd.updated_at, pd.created_at);

-- L'historique aussi : une entrée d'étape datée d'aujourd'hui sur un deal
-- d'avril fausserait la durée du cycle et le temps passé par étape.
update public.deal_stage_history h
set created_at = d.stage_entered_at
from public.deals d
where h.deal_id = d.id
  and d.raw_payload ->> 'repris_de' = 'pipeline_deals'
  and h.created_at is distinct from d.stage_entered_at;

commit;
