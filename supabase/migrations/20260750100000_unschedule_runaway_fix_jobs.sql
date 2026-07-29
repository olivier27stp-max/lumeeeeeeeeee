-- Retire 10 jobs pg_cron nommes fix_* : des migrations PONCTUELLES laissees
-- sur '* * * * *'. Chacun s'est execute 188 746 fois depuis mars 2026,
-- remplissant cron.job_run_details (1,9 M lignes / 681 MB) d'erreurs
-- "already exists". Apres nettoyage : 3 624 lignes / 656 kB.
--
-- Verifie avant suppression — le travail de chaque job etait deja applique :
--   fix_a1 policy webhook_events_service_all ....... presente
--   fix_b1 contrainte payments_app_fee_nonneg ...... presente
--   fix_b2 contrainte payments_stripe_fee_nonneg ... presente
--   fix_b3 contrainte payments_net_nonneg .......... presente
--   fix_c1 colonne webhook_events.updated_at ....... presente
--   fix_d1 index payment_requests_expires_idx ...... present
--   fix_z1 fonction exec_sql ....................... bien supprimee
--
-- fix_e1/e2/e3 sont le cas nuisible : e2 executait
--   DROP TRIGGER IF EXISTS trg_payment_status_transition ON public.payments
-- chaque minute, pendant que e1 echouait a creer la fonction du trigger
-- (guillemets doubles '' au lieu de ' dans le corps $t$ — erreur d'echappement),
-- donc e3 echouait aussi. Net : le trigger etait absent en permanence.
--
-- On arrete ici le cycle destructeur. RESTAURER le trigger est une decision
-- METIER distincte (il interdit qu'un paiement 'refunded' redevienne autre
-- chose, et qu'un 'succeeded' aille ailleurs que vers 'refunded') : laissee au
-- proprietaire, non appliquee ici.

do $$
declare
  v_name text;
begin
  foreach v_name in array array[
    'fix_a1','fix_b1','fix_b2','fix_b3','fix_c1',
    'fix_d1','fix_e1','fix_e2','fix_e3','fix_z1'
  ]
  loop
    begin
      perform cron.unschedule(v_name);
      raise notice 'Job % desactive', v_name;
    exception when others then
      raise notice 'Job % introuvable ou deja retire (%)', v_name, sqlerrm;
    end;
  end loop;
end $$;
