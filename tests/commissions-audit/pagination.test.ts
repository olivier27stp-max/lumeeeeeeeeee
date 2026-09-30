/**
 * Pagination des totaux : jamais une ligne perdue ni comptée deux fois, même
 * quand plus d'une page (1 000) de commissions partagent le même instant.
 * Utilise l'org V (volume) et nettoie derrière lui. Pile locale requise.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { API, DB_URL, SERVICE_KEY, brancherServeurSurLocal, pileLocaleDisponible } from './env-local';
import { ORG, U } from './fixture';

const disponible = await pileLocaleDisponible();
const REGLE_V = 'cc000000-0000-4000-8000-0000000005d1';

describe.skipIf(!disponible)('pagination des totaux (instants identiques)', () => {
  let db: pg.Client;
  let pret = false;
  beforeAll(async () => {
    brancherServeurSurLocal();
    db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    const { rows } = await db.query(`select 1 from fs_commission_rules where id = $1`, [REGLE_V]);
    pret = rows.length === 1; // règle créée par volume.sql
    if (!pret) return;
    await db.query(`delete from fs_commission_entries where org_id = $1 and description = 'pagination-test'`, [ORG.V]);
    // 2 500 lignes au MÊME instant, 3 juste avant, 3 juste après, dans l'org V, en 2023.
    await db.query(`set session_replication_role = replica`);
    await db.query(`
      insert into fs_commission_entries (org_id, user_id, rule_id, invoice_id, status, amount, base_amount, description, triggered_at, created_at)
      select $1, $2, $3, gen_random_uuid(), 'approved', 0.01 * g, 1, 'pagination-test', t, t
      from (select g, case when g <= 3 then timestamptz '2023-03-15 11:59:59+00'
                           when g > 2503 then timestamptz '2023-03-15 12:00:01+00'
                           else timestamptz '2023-03-15 12:00:00+00' end t
            from generate_series(1, 2506) g) x`, [ORG.V, U.vic, REGLE_V]);
    await db.query(`set session_replication_role = origin`);
  }, 60_000);
  afterAll(async () => {
    if (pret) await db.query(`delete from fs_commission_entries where org_id = $1 and description = 'pagination-test'`, [ORG.V]);
    await db?.end();
  });

  it('les 2 506 lignes sont toutes comptées, une seule fois', async () => {
    if (!pret) return; // volume.sql pas joué
    const moteur = await import('../../server/lib/field-sales/commission-engine');
    const sc = createClient(API, SERVICE_KEY, { auth: { persistSession: false } });
    const p = await moteur.getPayrollPreview(sc, ORG.V, U.vic, '2023-03-01', '2023-03-31');
    const attendu = Array.from({ length: 2506 }, (_, i) => i + 1).reduce((s, g) => s + g, 0); // Σ g ¢
    expect(p.count).toBe(2506);
    expect(p.totals_cents.du_cents).toBe(attendu);
  }, 60_000);
});
