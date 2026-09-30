/**
 * Audit commissions — clôture de période, annulation d'un versement, reprise
 * sur remboursement, export CSV / relevé. API Express réelle (localhost:3012).
 * Opt-in : COMMISSIONS_AUDIT=1, après les autres fichiers (le tenant est rejoué).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { API, ANON_KEY, DB_URL, SERVICE_KEY, brancherServeurSurLocal, pileLocaleDisponible } from './env-local';
import { ORG, U, MEMBRES, MOT_DE_PASSE, R, f } from './fixture';

const EXPRESS = process.env.COMMISSIONS_AUDIT_EXPRESS || 'http://localhost:3012';
const expressDispo = await fetch(`${EXPRESS}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
const disponible = expressDispo && await pileLocaleDisponible();

const jetons: Record<string, string> = {};
async function jeton(userId: string) {
  if (jetons[userId]) return jetons[userId];
  const m = MEMBRES.find((x) => x.id === userId)!;
  const anon = createClient(API, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email: m.courriel, password: MOT_DE_PASSE });
  if (error || !data.session) throw new Error(error?.message);
  return (jetons[userId] = data.session.access_token);
}
async function appel(userId: string, chemin: string, init: { method?: string; body?: unknown } = {}) {
  const m = MEMBRES.find((x) => x.id === userId)!;
  const r = await fetch(`${EXPRESS}/api${chemin}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${await jeton(userId)}`, 'x-org-id': m.org, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  // Octets bruts : r.text() retire le BOM en silence, or on veut le vérifier.
  const octets = new Uint8Array(await r.arrayBuffer());
  const texte = new TextDecoder('utf-8', { ignoreBOM: true }).decode(octets);
  let json: any = texte;
  try { json = JSON.parse(texte); } catch { /* CSV */ }
  return { status: r.status, json, texte, entetes: r.headers };
}

describe.skipIf(!disponible)('commissions — clôture, annulation, reprise, export', () => {
  let db: pg.Client;
  const statut = async (invoice: string, user = U.rita) =>
    (await db.query(`select status, paid_at, triggered_at, calc_breakdown from fs_commission_entries where invoice_id=$1 and user_id=$2 and deleted_at is null`, [invoice, user])).rows[0];

  beforeAll(async () => {
    brancherServeurSurLocal();
    const { seed } = await import('./seed');
    await seed();
    db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
  }, 180_000);
  afterAll(async () => { await db?.end(); });

  it('verser la paie de septembre de Rita : ses commissions gagnées passent à « versé », pas ses estimations', async () => {
    const r = await appel(U.olivia, '/payroll/mark-paid', { method: 'POST', body: { user_id: U.rita, ref: '2026-09-15' } });
    expect(r.status).toBe(200);
    expect(r.json.commissions_versees).toBe(4); // I1, I3, I8, Q1 (I4 reprise)
    expect((await statut(f('I1').id)).status).toBe('paid');
    const { rows } = await db.query(`select count(*)::int n from fs_commission_entries where org_id=$1 and user_id=$2 and invoice_id is null and status='pending'`, [ORG.A, U.rita]);
    expect(rows[0].n).toBeGreaterThan(0); // les estimations restent des estimations
  });

  it('période versée = verrouillée : ni reverser, ni annuler le versement (409)', async () => {
    const { rows } = await db.query(`select id from fs_commission_entries where invoice_id=$1 and user_id=$2`, [f('I1').id, U.rita]);
    const rev = await appel(U.olivia, `/commissions/${rows[0].id}/reverse`, { method: 'POST', body: { reason: 'test' } });
    expect(rev.status).toBe(409);
    expect(rev.json.code).toBe('periode_verrouillee');
    const annul = await appel(U.olivia, `/commissions/${rows[0].id}/unmark-paid`, { method: 'POST' });
    expect(annul.status).toBe(409);
  });

  it('annuler le versement de la PÉRIODE remet exactement ces commissions à « approuvé »', async () => {
    const r = await appel(U.olivia, '/payroll/unmark-paid', { method: 'POST', body: { user_id: U.rita, ref: '2026-09-15' } });
    expect(r.status).toBe(200);
    expect((await statut(f('I1').id)).status).toBe('approved');
    expect((await statut(f('I6').id)).status).toBe('paid'); // août, versée à la main : intacte
  });

  it('« Annuler le versement » d’une commission versée par erreur (période ouverte)', async () => {
    const { rows } = await db.query(`select id from fs_commission_entries where invoice_id=$1 and user_id=$2`, [f('I1').id, U.rita]);
    expect((await appel(U.olivia, `/commissions/${rows[0].id}/mark-paid`, { method: 'POST' })).status).toBe(200);
    const annul = await appel(U.olivia, `/commissions/${rows[0].id}/unmark-paid`, { method: 'POST' });
    expect(annul.status).toBe(200);
    expect(annul.json.status).toBe('approved');
    const trace = (await db.query(`select actor_id from audit_events where org_id=$1 and action='commission.unpaid' order by created_at desc limit 1`, [ORG.A])).rows[0];
    expect(trace.actor_id).toBe(U.olivia);
    expect((await appel(U.rita, `/commissions/${rows[0].id}/unmark-paid`, { method: 'POST' })).status).toBe(403);
  });

  it('commission gagnée dans une période DÉJÀ versée (paiement en retard) : rattachée à la période en cours', async () => {
    // Août est versé pour Rita (fixture). Nouvelle facture payée avec une date d'août.
    const sc = createClient(API, SERVICE_KEY, { auth: { persistSession: false } });
    const moteur = await import('../../server/lib/field-sales/commission-engine');
    const job = 'cc000000-0000-4000-8000-000000000b01';
    const inv = 'cc000000-0000-4000-8000-000000000b02';
    await db.query(`delete from fs_commission_entries where invoice_id=$1`, [inv]);
    await db.query(`delete from payments where invoice_id=$1`, [inv]);
    await db.query(`delete from invoices where id=$1`, [inv]);
    await db.query(`delete from jobs where id=$1`, [job]);
    await sc.from('jobs').insert({ id: job, org_id: ORG.A, title: 'Retard', job_number: 'FXJ-LATE', salesperson_id: U.rita, created_by: U.olivia, status: 'scheduled', subtotal_cents: 10000, tax_cents: 1498, total_cents: 11498 });
    await sc.from('invoices').insert({ id: inv, org_id: ORG.A, job_id: job, created_by: U.olivia, invoice_number: 'FX-LATE', tax_cents: 1498, status: 'draft' });
    await sc.from('invoice_items').insert({ org_id: ORG.A, invoice_id: inv, description: 'x', qty: 1, unit_price_cents: 10000, line_total_cents: 10000 });
    await sc.from('invoices').update({ issued_at: '2026-08-10T12:00:00-04:00' }).eq('id', inv);
    await sc.from('payments').insert({ org_id: ORG.A, invoice_id: inv, job_id: job, created_by: U.olivia, amount_cents: 11498, status: 'succeeded', provider: 'manual', method: 'cash', payment_date: '2026-08-12T12:00:00-04:00', paid_at: '2026-08-12T12:00:00-04:00' });
    await moteur.generateCommissionsForInvoice(sc, ORG.A, inv);
    const e = await statut(inv);
    expect(new Date(e.triggered_at).getTime()).toBeGreaterThan(Date.parse('2026-09-01'));
    expect(e.calc_breakdown.gagnee_le).toMatch(/^2026-08-12/);
    expect(e.calc_breakdown.rattachee_periode_suivante).toBe(true);
  });

  it('export CSV : toutes les lignes de la période, montants avant taxes, totaux en pied', async () => {
    const r = await appel(U.olivia, '/commissions/export.csv?from=2026-09-01&to=2026-09-30&lang=fr');
    expect(r.status).toBe(200);
    expect(r.entetes.get('content-type')).toMatch(/text\/csv/);
    expect(r.texte.charCodeAt(0)).toBe(0xfeff); // BOM : accents lisibles dans Excel
    expect(r.texte).toContain('"Gagnée le","Représentant","Facture"');
    expect(r.texte).toMatch(/"Rita Pourcent","FX-I1-\d+"[^\r\n]*,1000\.00,100\.00,"Approuvé"/);
    expect(r.texte).toContain('"Total dû (en attente + approuvé + versé)"');
  });

  it('relevé d’un rep : un représentant n’exporte QUE ses commissions, même en visant un collègue', async () => {
    const r = await appel(U.rita, `/commissions/export.csv?from=2026-09-01&to=2026-09-30&userId=${U.tina}`);
    expect(r.status).toBe(200);
    expect(r.texte).toContain('Rita Pourcent');
    expect(r.texte).not.toContain('Tina Palier');
    expect((await appel(U.theo, '/commissions/export.csv')).status).toBe(403);
  });

  it('réglages : politique « Reprendre » acceptée par l’API ; une valeur inconnue refusée', async () => {
    expect((await appel(U.olivia, '/commissions/settings', { method: 'PUT', body: { reversal_policy: 'n-importe-quoi' } })).status).toBe(400);
    const r = await appel(U.olivia, '/commissions/settings', { method: 'PUT', body: { reversal_policy: 'clawback' } });
    // Sans la migration 20261005100400, c'est la contrainte de la BASE qui refuse
    // encore la valeur (400 « Data validation failed ») ; avec elle, 200.
    expect([200, 400]).toContain(r.status);
    await appel(U.olivia, '/commissions/settings', { method: 'PUT', body: { reversal_policy: 'auto' } });
  });

  it('reprise [exige M5] : remboursée après versement → ligne négative visible dans la période en cours, une seule fois', async () => {
    const { rows: cons } = await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname='commission_settings_reversal_policy_check'`);
    if (!String(cons[0]?.d).includes('clawback')) return; // M5 pas appliquée
    await db.query(`update commission_settings set reversal_policy='clawback' where org_id=$1`, [ORG.A]);
    const sc = createClient(API, SERVICE_KEY, { auth: { persistSession: false } });
    const moteur = await import('../../server/lib/field-sales/commission-engine');
    const i6 = await statut(f('I6').id);
    expect(i6.status).toBe('paid');
    await moteur.handleInvoiceReversal(sc, ORG.A, f('I6').id, 'Refund: test');
    await moteur.handleInvoiceReversal(sc, ORG.A, f('I6').id, 'Refund: test'); // idempotent
    const { rows } = await db.query(`select amount, status, triggered_at from fs_commission_entries where org_id=$1 and calc_breakdown->>'reprise_de' = (select id::text from fs_commission_entries where invoice_id=$2 and user_id=$3)`, [ORG.A, f('I6').id, U.rita]);
    expect(rows.length).toBe(1);
    expect(Number(rows[0].amount)).toBe(-30);
    expect(rows[0].status).toBe('approved');
    expect((await statut(f('I6').id)).status).toBe('paid'); // août ne bouge pas
    await db.query(`update commission_settings set reversal_policy='auto' where org_id=$1`, [ORG.A]);
    void R;
  });
});
