/**
 * Audit commissions — EXACTITUDE, contre la pile Supabase locale.
 * Rejoue le tenant de test puis compare chaque chiffre à l'oracle SQL.
 * Sauté automatiquement sans pile locale (CI).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { API, DB_URL, SERVICE_KEY, brancherServeurSurLocal, pileLocaleDisponible } from './env-local';
import { ORG, U, f, FACTURES, TZ } from './fixture';
import { lireOracle, lireReel, ecarts, cleFacture, type Attendu, type Reel } from './comparer';

const disponible = await pileLocaleDisponible();
type Moteur = typeof import('../../server/lib/field-sales/commission-engine');

describe.skipIf(!disponible)('commissions — exactitude contre l’oracle', () => {
  let db: pg.Client;
  let sc: SupabaseClient;
  let moteur: Moteur;
  let attendus: Attendu[];
  let reels: Reel[];

  beforeAll(async () => {
    brancherServeurSurLocal();
    process.env.TZ = 'UTC'; // comme Railway
    const { seed } = await import('./seed');
    await seed();
    moteur = await import('../../server/lib/field-sales/commission-engine');
    sc = createClient(API, SERVICE_KEY, { auth: { persistSession: false } });
    db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    attendus = await lireOracle(db);
    reels = await lireReel(db);
  }, 180_000);
  afterAll(async () => { await db?.end(); });

  it('chaque commission = l’oracle, au cent près [RF2 exige M1]', () => {
    const e = ecarts(attendus, reels);
    expect(e.map((x) => `${x.cle}/${x.user_id.slice(-3)}: attendu ${x.attendu} (${x.etat_attendu}), moteur ${x.reel} (${x.statut_reel})`)).toEqual([]);
  });

  it('la commission est calculée AVANT taxes (base = sous-total − rabais)', async () => {
    const { rows } = await db.query(`
      select i.id, i.subtotal_cents - coalesce(i.discount_cents,0) attendu, round(e.base_amount*100)::int reel
        from fs_commission_entries e join invoices i on i.id = e.invoice_id
       where e.org_id = $1 and e.deleted_at is null`, [ORG.A]);
    const faux = rows.filter((r) => Number(r.attendu) !== Number(r.reel)).map((r) => `${cleFacture(r.id)}: base ${r.reel} ≠ ${r.attendu}`);
    expect(faux).toEqual([]);
  });

  it('un split ne dépasse jamais 100 % : Σ des parts = montant calculé', async () => {
    const { rows } = await db.query(`
      select invoice_id, sum(round(amount*100))::int parts, max((calc_breakdown->>'total_calculated_cents')::int) total
        from fs_commission_entries where org_id = $1 and invoice_id is not null and deleted_at is null
       group by invoice_id having count(*) > 1`, [ORG.A]);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.parts, cleFacture(r.invoice_id)).toBeLessThanOrEqual(r.total);
    for (const r of rows) expect(r.parts, cleFacture(r.invoice_id)).toBe(r.total);
  });

  it('total d’un rep sur la période (page) = somme de ses lignes = oracle [Fred exige M1]', async () => {
    const reps = [U.rita, U.fred, U.tina, U.sam, U.sara];
    const faux: string[] = [];
    for (const rep of reps) {
      const p = await moteur.getPayrollPreview(sc, ORG.A, rep, '2026-09-01', '2026-09-30');
      const lignes = await moteur.getCommissionEntries(sc, ORG.A, { userId: rep, dateRange: { from: '2026-09-01', to: '2026-09-30' } });
      const sommeLignes = Math.round(lignes.filter((l: any) => l.status !== 'reversed' && l.invoice_id).reduce((s: number, l: any) => s + Number(l.amount) * 100, 0));
      const oracle = attendus.filter((a) => a.user_id === rep && a.mois === '2026-09' && a.etat === 'active').reduce((s, a) => s + a.montant_cents, 0);
      const page = Math.round(Number(p.total) * 100);
      if (page !== oracle || sommeLignes !== oracle) faux.push(`${rep.slice(-3)}: page ${page}, Σ lignes ${sommeLignes}, oracle ${oracle}`);
    }
    expect(faux).toEqual([]);
  });

  it('les dates suivent le fuseau de l’entreprise (31 août 23 h 30 Toronto = août)', async () => {
    const aout = await moteur.getCommissionEntries(sc, ORG.A, { userId: U.rita, dateRange: { from: '2026-08-01', to: '2026-08-31' } });
    expect(aout.map((e: any) => cleFacture(e.invoice_id))).toContain('I6');
    const dec = await moteur.getCommissionEntries(sc, ORG.A, { userId: U.rita, dateRange: { from: '2025-12-01', to: '2025-12-31' } });
    expect(dec.map((e: any) => cleFacture(e.invoice_id))).toEqual(['Y1']);
    const jan = await moteur.getCommissionEntries(sc, ORG.A, { userId: U.rita, dateRange: { from: '2026-01-01', to: '2026-01-31' } });
    expect(jan.map((e: any) => cleFacture(e.invoice_id))).toEqual(['Y2']);
    const nov = await moteur.getCommissionEntries(sc, ORG.A, { userId: U.rita, dateRange: { from: '2026-11-01', to: '2026-11-30' } });
    expect(nov.map((e: any) => cleFacture(e.invoice_id))).toEqual(['H3']);
    expect(TZ).toBe('America/Toronto');
  });

  it('un autre tenant n’apparaît jamais', async () => {
    const tout = await moteur.getCommissionEntries(sc, ORG.A, {});
    expect(tout.some((e: any) => e.org_id !== ORG.A)).toBe(false);
    expect(tout.some((e: any) => e.invoice_id === f('B1').id)).toBe(false);
    const p = await moteur.getPayrollPreview(sc, ORG.A, U.bea, '2026-01-01', '2026-12-31');
    expect(p.count).toBe(0);
  });

  it('tenant vide : zéro partout, sans erreur', async () => {
    const e = await moteur.getCommissionEntries(sc, ORG.C, {});
    expect(e).toEqual([]);
    const p = await moteur.getPayrollPreview(sc, ORG.C, null, '2026-09-01', '2026-09-30');
    expect([p.total, p.pending, p.approved, p.paid, p.reversed, p.count]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('pas de commission : membre à l’heure, sans plan, facture sans job, paiement partiel, facture annulée', () => {
    for (const cle of ['H1', 'N1', 'X1', 'I2', 'I7']) {
      expect(reels.filter((r) => r.invoice_id === f(cle).id), cle).toEqual([]);
    }
  });

  it('une estimation (job pas encore payé, facture annulée) ne compte jamais comme gagnée', async () => {
    const p = await moteur.getPayrollPreview(sc, ORG.A, U.rita, '2026-09-01', '2026-09-30');
    const lignes = await moteur.getCommissionEntries(sc, ORG.A, { userId: U.rita, dateRange: { from: '2026-09-01', to: '2026-09-30' } });
    const confirmees = lignes.filter((e: any) => e.invoice_id && e.status !== 'reversed').reduce((s: number, e: any) => s + Math.round(Number(e.amount) * 100), 0);
    const estimations = lignes.filter((e: any) => !e.invoice_id && e.status === 'pending');
    expect(estimations.length).toBeGreaterThan(0); // job E1 + I2 (partielle) + I7 (annulée)
    expect(Math.round(Number(p.total) * 100)).toBe(confirmees);
  });

  it('idempotence : relancer le moteur (en série et en parallèle) ne crée aucun doublon', async () => {
    const avant = (await lireReel(db)).length;
    const payees = FACTURES.filter((x) => x.org === ORG.A);
    for (const x of payees) await moteur.generateCommissionsForInvoice(sc, x.org, x.id);
    await Promise.all(payees.flatMap((x) => [moteur.generateCommissionsForInvoice(sc, x.org, x.id), moteur.generateCommissionsForInvoice(sc, x.org, x.id)]));
    for (const x of payees.filter((y) => y.job)) await moteur.projectCommissionForJob(sc, x.org, x.job!);
    expect((await lireReel(db)).length).toBe(avant);
  }, 60_000);

  it('remboursement APRÈS versement : la période payée ne bouge pas, et un ajustement VISIBLE existe', async () => {
    const i5 = reels.find((r) => r.invoice_id === f('I5').id)!;
    expect(i5.status).toBe('paid'); // août reste payé tel quel
    const { rows } = await db.query(`
      select count(*)::int n from fs_commission_entries
       where org_id = $1 and user_id = $2 and deleted_at is null and invoice_id = $3 and amount < 0`, [ORG.A, U.rita, f('I5').id]);
    const { rows: alerte } = await db.query(`select reverse_reason from fs_commission_entries where id = $1`, [i5.id]);
    // Il faut SOIT une ligne de reprise négative (D4), SOIT au moins un signal lisible.
    expect({ reprise: rows[0].n > 0, signal: !!alerte[0].reverse_reason }).not.toEqual({ reprise: false, signal: false });
  });

  it('la facture refaite sur le même job (void → supprimée → nouvelle) est commissionnée [exige M1]', () => {
    expect(reels.filter((r) => r.invoice_id === f('RF2').id).length).toBe(1);
  });
});
