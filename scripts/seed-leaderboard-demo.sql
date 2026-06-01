-- ============================================================================
-- SEED: 10 imaginary sales reps for the Leaderboard  (DEMO / TEST DATA)
-- ----------------------------------------------------------------------------
-- Run this in the Supabase SQL editor. It is idempotent (safe to re-run).
--
-- How the leaderboard works (server/lib/field-sales/leaderboard-engine.ts):
--   reps + revenue come from pipeline_deals WHERE stage = 'closed_won',
--   grouped by rep_id (FK -> auth.users), names from memberships.full_name.
-- So each fake rep needs: an auth.users row + a membership + closed_won deals.
--
-- All seeded rows are tagged seed='leaderboard_demo' for easy cleanup
-- (see the CLEANUP block at the bottom).
-- ============================================================================

DO $$
DECLARE
  v_org   uuid;
  v_uid   uuid;
  v_email text;
  v_names text[] := ARRAY[
    'Alex Tremblay','Maya Côté','Liam Gagnon','Sofia Roy','Noah Bergeron',
    'Emma Lavoie','Lucas Fortin','Olivia Bouchard','William Pelletier','Charlotte Girard'
  ];
  v_teams text[] := ARRAY[
    'Équipe Nord','Équipe Nord','Équipe Sud','Équipe Sud','Équipe Nord',
    'Équipe Sud','Équipe Nord','Équipe Sud','Équipe Nord','Équipe Sud'
  ];
  i       int;
  j       int;
  v_closes int;
  v_val    numeric;
BEGIN
  -- --- Resolve the target organization -------------------------------------
  -- Defaults to the owner's org. If you have several orgs, hard-code v_org.
  SELECT m.org_id INTO v_org
  FROM public.memberships m
  JOIN auth.users u ON u.id = m.user_id
  WHERE lower(u.email) = lower('beatsafterimage@gmail.com')
    AND m.role IN ('owner','admin')
  ORDER BY m.created_at NULLS LAST
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Could not resolve org_id. Set v_org manually at the top of the DO block.';
  END IF;

  FOR i IN 1..10 LOOP
    v_email := 'demo.rep' || i || '@leaderboard.demo';

    -- 1) auth user (no password -> cannot sign in) -------------------------
    SELECT id INTO v_uid FROM auth.users WHERE email = v_email;
    IF v_uid IS NULL THEN
      v_uid := gen_random_uuid();
      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) VALUES (
        v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        v_email, '', now(), now(), now(),
        '{"provider":"email","providers":["email"],"seed":"leaderboard_demo"}'::jsonb,
        jsonb_build_object('full_name', v_names[i], 'seed', 'leaderboard_demo'),
        '', '', '', ''
      );
    END IF;

    -- 2) membership (provides the displayed name) --------------------------
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships WHERE user_id = v_uid AND org_id = v_org
    ) THEN
      INSERT INTO public.memberships (user_id, org_id, role, full_name, team_name, status, created_at)
      VALUES (v_uid, v_org, 'sales_rep', v_names[i], v_teams[i], 'active', now());
    ELSE
      UPDATE public.memberships
         SET full_name = v_names[i], team_name = v_teams[i]
       WHERE user_id = v_uid AND org_id = v_org;
    END IF;

    -- 3) closed_won deals (closes + revenue) -------------------------------
    --    Skip if this rep already has seeded deals (idempotent).
    IF NOT EXISTS (
      SELECT 1 FROM public.pipeline_deals
      WHERE org_id = v_org AND rep_id = v_uid AND stage = 'closed_won' AND deleted_at IS NULL
    ) THEN
      v_closes := 11 - i;  -- rep #1 = 10 closes (top), rep #10 = 1 close
      FOR j IN 1..v_closes LOOP
        v_val := 2000 + ((i * 137 + j * 311) % 6000);  -- varied $2k–$8k
        INSERT INTO public.pipeline_deals
          (org_id, rep_id, created_by, stage, value, value_cents, won_at, deleted_at)
        VALUES
          (v_org, v_uid, v_uid, 'closed_won', v_val, (v_val * 100)::int,
           now() - (j * interval '7 minutes'), NULL);
      END LOOP;
    END IF;
  END LOOP;

  RAISE NOTICE 'Seeded 10 demo reps into org %', v_org;
END $$;

-- ============================================================================
-- CLEANUP (run to remove all seeded demo data):
-- ----------------------------------------------------------------------------
-- DELETE FROM public.pipeline_deals
--   WHERE rep_id IN (SELECT id FROM auth.users
--                    WHERE raw_app_meta_data->>'seed' = 'leaderboard_demo');
-- DELETE FROM public.memberships
--   WHERE user_id IN (SELECT id FROM auth.users
--                     WHERE raw_app_meta_data->>'seed' = 'leaderboard_demo');
-- DELETE FROM auth.users
--   WHERE raw_app_meta_data->>'seed' = 'leaderboard_demo';
-- ============================================================================
