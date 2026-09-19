-- F7 — désactiver les automatisations de sollicitation commerciale
-- ─────────────────────────────────────────────────────────────────
-- Constat du 2026-09-19 en production : 919 clients, ZÉRO consentement
-- enregistré (`clients.email_consent_at` et `sms_consent_at` existent depuis
-- longtemps mais n'ont jamais été ni écrits ni lus), et cinq règles de
-- sollicitation actives dans 6 organisations.
--
-- Ces règles envoient de la publicité à des gens dont personne n'a recueilli
-- le consentement : « on offre aussi d'autres services » 30 jours après une
-- job (cross_sell_30d), une relance saisonnière à 6 mois, un réengagement de
-- lead perdu à 90 jours… Au Canada, c'est la LCAP (et la loi 25 au Québec
-- pour les renseignements personnels). L'amende est pour l'entreprise
-- cliente ; le défaut est le nôtre, puisque le seeder les activait d'office.
--
-- Cette migration ferme le robinet. Le code refuse en plus chaque envoi
-- commercial sans consentement (server/lib/actions/index.ts), mais on ne
-- laisse pas des règles actives dont on sait qu'elles ne peuvent plus rien
-- envoyer : l'entreprise les verrait « actives » et se demanderait pourquoi
-- rien ne part.
--
-- Réversible : l'entreprise peut les réactiver dans Automatisations quand
-- elle recueille le consentement. Ce n'est pas une interdiction, c'est un
-- choix qui lui revient — pris en connaissance de cause.
--
-- La trace dans `security_events` sert à prévenir chaque propriétaire.

begin;

-- 1. Désactiver, en gardant une trace de ce qui était actif.
create temporary table f7_desactivees on commit drop as
select id, org_id, preset_key, name
  from public.automation_rules
 where is_preset is true
   and is_active is true
   and preset_key in ('cross_sell_30d', 'seasonal_reminder_6m', 'lost_lead_reengagement', 'reengagement_90d', 'client_anniversary');

update public.automation_rules r
   set is_active = false,
       updated_at = now()
  from f7_desactivees d
 where r.id = d.id;

-- 2. Une trace par organisation touchée, pour l'alerte au propriétaire.
--    `details` porte la liste des règles : le courriel d'alerte les nomme.
insert into public.security_events (org_id, event_type, severity, source, details)
select d.org_id,
       'automations_sollicitation_desactivee',
       -- Valeurs conformes à celles déjà en base : severity ∈ (info, medium,
       -- high, critical) et source ∈ (db-cron, auth, api). « warning » et
       -- « system » n'existent pas ici.
       'medium',
       'db-cron',
       jsonb_build_object(
         'motif', 'consentement commercial non recueilli (LCAP / loi 25)',
         'regles', jsonb_agg(jsonb_build_object('preset_key', d.preset_key, 'nom', d.name) order by d.preset_key),
         'nombre', count(*),
         'reactivable', true,
         'migration', '20260919100000'
       )
  from f7_desactivees d
 group by d.org_id;

-- 3. Contrôle : plus aucune règle de sollicitation active nulle part.
do $$
declare
  restantes integer;
begin
  select count(*) into restantes
    from public.automation_rules
   where is_preset is true
     and is_active is true
     and preset_key in ('cross_sell_30d', 'seasonal_reminder_6m', 'lost_lead_reengagement', 'reengagement_90d', 'client_anniversary');
  if restantes > 0 then
    raise exception 'F7 : % règle(s) de sollicitation encore active(s) après la migration', restantes;
  end if;
end $$;

commit;
