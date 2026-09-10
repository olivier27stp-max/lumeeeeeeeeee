/**
 * LES COMMISSIONS QUI DISPARAISSAIENT SANS TRACE.
 *
 * Trois appels partent du navigateur « en arrière-plan » : projeter une
 * commission à la création d'un job, l'annuler à sa suppression, la générer
 * quand une facture est marquée payée à la main. Ils ne doivent jamais casser
 * le flux métier — c'était le bon réflexe. Mais l'échec était AVALÉ :
 *
 *   - le client ne lisait pas `res.ok` (un 500 = un succès) ;
 *   - `generate-for-invoice` exigeait un admin, donc un vendeur qui marquait
 *     sa facture payée recevait 403… en silence ;
 *   - le moteur renvoyait `{ voided: 0 }` sur une erreur d'écriture.
 *
 * Conséquence (audit 2026-09-09, C3) : un vendeur non payé, ou une commission
 * payée sur un job supprimé, et personne ne le sait avant la réclamation.
 *
 * Ces tests figent la règle : tout échec laisse une ligne dans `dead_letters`
 * (payload rejouable) ET répond 500 — le client a alors quelque chose à
 * journaliser.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';

const ORG = '11111111-2222-3333-4444-555555555555';
const USER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const deadLetters: any[] = [];
const service = {
  from: vi.fn((table: string) => ({
    insert: vi.fn(async (row: any) => {
      if (table === 'dead_letters') deadLetters.push(row);
      return { error: null };
    }),
  })),
};

vi.mock('../server/lib/supabase', () => ({
  getServiceClient: () => service,
  requireAuthedClient: async () => ({ client: {}, orgId: ORG, user: { id: USER } }),
  isOrgAdminOrOwner: async () => false, // un simple vendeur
}));

const moteur = {
  projectCommissionForJob: vi.fn(),
  voidProjectedCommissionForJob: vi.fn(),
  generateCommissionsForInvoice: vi.fn(),
};
vi.mock('../server/lib/field-sales/commission-engine', () => ({
  ...moteur,
  getCommissionEntries: vi.fn(),
  approveCommission: vi.fn(),
  reverseCommission: vi.fn(),
  getCommissionRules: vi.fn(),
  createCommissionRule: vi.fn(),
  updateCommissionRule: vi.fn(),
  getPayrollPreview: vi.fn(),
  markCommissionPaid: vi.fn(),
}));

const { default: commissionsRouter } = await import('../server/routes/commissions');

async function poster(path: string, body: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/api', commissionsRouter);
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  deadLetters.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('generate-for-invoice', () => {
  it('un simple vendeur peut déclencher la génération (plus de 403 muet)', async () => {
    moteur.generateCommissionsForInvoice.mockResolvedValue({ created: 1, skipped: null });
    const r = await poster('/commissions/generate-for-invoice', { invoiceId: 'inv-1' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ created: 1, skipped: null });
    expect(deadLetters).toHaveLength(0);
  });

  it('le moteur plante → dead_letters + 500', async () => {
    moteur.generateCommissionsForInvoice.mockRejectedValue(new Error('boom'));
    const r = await poster('/commissions/generate-for-invoice', { invoiceId: 'inv-1' });
    expect(r.status).toBe(500);
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].source).toBe('commissions:generate-for-invoice');
    expect(deadLetters[0].payload).toMatchObject({ org_id: ORG, invoice_id: 'inv-1', user_id: USER });
    expect(deadLetters[0].error_msg).toContain('boom');
  });

  it('un « skip » qui est en réalité une lecture ratée est traité comme un échec', async () => {
    // Avant : 200 { skipped: 'dup_check_failed' } — un succès pour tout le monde.
    moteur.generateCommissionsForInvoice.mockResolvedValue({ created: 0, skipped: 'dup_check_failed' });
    const r = await poster('/commissions/generate-for-invoice', { invoiceId: 'inv-1' });
    expect(r.status).toBe(500);
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].payload.skipped).toBe('dup_check_failed');
  });

  it('les skips normaux du moteur restent des 200', async () => {
    for (const skipped of ['already_generated', 'not_paid', 'no_rep', 'no_rule']) {
      moteur.generateCommissionsForInvoice.mockResolvedValue({ created: 0, skipped });
      const r = await poster('/commissions/generate-for-invoice', { invoiceId: 'inv-1' });
      expect(r.status).toBe(200);
    }
    expect(deadLetters).toHaveLength(0);
  });

  it('invoiceId manquant → 400, rien à tracer', async () => {
    const r = await poster('/commissions/generate-for-invoice', {});
    expect(r.status).toBe(400);
    expect(moteur.generateCommissionsForInvoice).not.toHaveBeenCalled();
  });
});

describe('project-for-job / void-for-job', () => {
  it('projection qui plante → dead_letters avec le job', async () => {
    moteur.projectCommissionForJob.mockRejectedValue(new Error('rules table gone'));
    const r = await poster('/commissions/project-for-job', { jobId: 'job-1' });
    expect(r.status).toBe(500);
    expect(deadLetters[0]).toMatchObject({
      source: 'commissions:project-for-job',
      payload: { org_id: ORG, job_id: 'job-1' },
    });
  });

  it('annulation qui plante → dead_letters (sinon on paie un job supprimé)', async () => {
    moteur.voidProjectedCommissionForJob.mockRejectedValue(new Error('void projected entries failed: rls'));
    const r = await poster('/commissions/void-for-job', { jobId: 'job-1' });
    expect(r.status).toBe(500);
    expect(deadLetters[0].source).toBe('commissions:void-for-job');
  });

  it('annulation réussie → 200 sans trace', async () => {
    moteur.voidProjectedCommissionForJob.mockResolvedValue({ voided: 1 });
    const r = await poster('/commissions/void-for-job', { jobId: 'job-1' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ voided: 1 });
    expect(deadLetters).toHaveLength(0);
  });
});

describe('le moteur lui-même', () => {
  it('voidProjectedCommissionForJob lève sur une erreur d écriture au lieu de renvoyer voided: 0', async () => {
    const { voidProjectedCommissionForJob } = await vi.importActual<any>('../server/lib/field-sales/commission-engine');
    const chaine: any = {};
    for (const m of ['update', 'eq', 'is']) chaine[m] = vi.fn(() => chaine);
    chaine.select = vi.fn(async () => ({ data: null, error: { message: 'permission denied' } }));
    const sb = { from: vi.fn(() => chaine) };
    await expect(voidProjectedCommissionForJob(sb as any, ORG, 'job-1')).rejects.toThrow(/permission denied/);
  });
});
