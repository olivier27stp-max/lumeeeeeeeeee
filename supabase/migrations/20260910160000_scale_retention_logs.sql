-- ═══════════════════════════════════════════════════════════════
-- SCALE S5 — Rétention des tables de logs à forte croissance
-- ───────────────────────────────────────────────────────────────
-- Ces tables croissent linéairement avec le nombre de tenants et ne sont jamais
-- relues au-delà de quelques semaines : sans purge, elles font exploser la
-- taille de la base et le temps d'autovacuum. On ajoute une fonction dédiée
-- (séparée de run_retention_job pour ne pas la réécrire) + un cron quotidien.
--
-- Seules les tables/colonnes VÉRIFIÉES présentes en prod sont incluses.
-- Exclues (faux positifs vérifiés) : dead_letters (pas de created_at),
-- quote_views (pas de created_at). Les purges de géoloc, audit, portal tokens,
-- failed logins existent déjà ailleurs (non dupliquées ici).
--
-- Suppression par LOTS (10k) pour ne jamais prendre un verrou long sur une
-- table déjà volumineuse.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.run_retention_logs()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb := '{}'::jsonb;
  n bigint;
  -- (table, colonne date, intervalle de rétention)
  cibles text[][] := array[
    ['automation_execution_logs', 'created_at', '90 days'],
    ['activity_log',              'created_at', '180 days'],
    ['login_history',             'created_at', '180 days'],
    ['security_events',           'created_at', '365 days'],
    ['webhook_deliveries',        'created_at', '30 days'],
    ['tracking_live_locations',   'updated_at', '7 days']
  ];
  c text[];
  total bigint;
begin
  foreach c slice 1 in array cibles loop
    total := 0;
    loop
      execute format(
        'with vieux as (select ctid from public.%I where %I < now() - interval %L order by %I limit 10000) '
        || 'delete from public.%I t using vieux where t.ctid = vieux.ctid',
        c[1], c[2], c[3], c[2], c[1]
      );
      get diagnostics n = row_count;
      total := total + n;
      exit when n < 10000;
    end loop;
    v := v || jsonb_build_object(c[1], total);
  end loop;

  -- notifications lues seulement (on garde les non-lues quel que soit l'âge)
  total := 0;
  loop
    with vieux as (
      select ctid from public.notifications
       where read_at is not null and created_at < now() - interval '90 days'
       order by created_at limit 10000
    )
    delete from public.notifications t using vieux where t.ctid = vieux.ctid;
    get diagnostics n = row_count;
    total := total + n;
    exit when n < 10000;
  end loop;
  v := v || jsonb_build_object('notifications', total);

  return v;
end $$;

-- Moindre privilège : seul le serveur/cron (service_role) l'exécute.
revoke all on function public.run_retention_logs() from public, anon, authenticated;

-- Cron quotidien à 4h20 (après le run_retention_job de 4h00).
select cron.schedule('lume_retention_logs', '20 4 * * *', 'select public.run_retention_logs()');
