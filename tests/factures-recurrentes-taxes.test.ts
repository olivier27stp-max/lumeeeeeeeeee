/**
 * FACTURES RÉCURRENTES — elles portent les taxes du client, et « envoi
 * automatique » envoie vraiment.
 *
 * Défauts corrigés (trouvés en construisant le catalogue de tâches Lumi) :
 *  1. `runOneSchedule` créait la facture avec tax_cents = 0 ; le recalcul ne
 *     fait que relire la taxe stockée → aucune TPS/TVQ sur les factures
 *     récurrentes d'une entreprise québécoise.
 *  2. `auto_send` posait seulement le statut « sent » : aucun courriel ne
 *     partait, mais les relances de retard visaient le client.
 *
 * On exécute le VRAI moteur contre un faux client Supabase qui journalise
 * chaque écriture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const envoi = vi.hoisted(() => ({ resultat: { success: true } as { success: boolean; error?: string }, appels: 0 }));
vi.mock('../server/lib/actions', () => ({
  resolveEntityVariables: async () => ({ invoice_link: 'https://exemple.test/invoice/x', invoice_number: '2001' }),
  executeEnvoyerFacture: async () => { envoi.appels++; return envoi.resultat; },
}));
vi.mock('../server/lib/eventBus', () => ({ eventBus: { emit: vi.fn() } }));

import { runOneSchedule, type RecurringSchedule } from '../server/lib/recurringInvoicesEngine';
import { eventBus } from '../server/lib/eventBus';

type Ecriture = { table: string; op: 'insert' | 'update'; valeurs: any };

/** Faux client : renvoie `donnees[table]` aux lectures, journalise les écritures. */
function fauxClient(donnees: Record<string, any>) {
  const ecritures: Ecriture[] = [];
  const requete = (table: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let valeurs: any = null;
    const q: any = {
      select: () => q, eq: () => q, is: () => q, lte: () => q, order: () => q, limit: () => q, not: () => q, in: () => q,
      insert: (v: any) => { op = 'insert'; valeurs = v; ecritures.push({ table, op, valeurs: v }); return q; },
      update: (v: any) => { op = 'update'; valeurs = v; ecritures.push({ table, op, valeurs: v }); return q; },
      maybeSingle: async () => ({ data: Array.isArray(donnees[table]) ? donnees[table][0] ?? null : donnees[table] ?? null, error: null }),
      single: async () => ({ data: op === 'insert' && table === 'invoices' ? { id: 'fac-1', invoice_number: '2001' } : donnees[table], error: null }),
      then: (ok: any) => Promise.resolve({ data: op === 'select' ? donnees[table] ?? [] : valeurs, error: null }).then(ok),
    };
    return q;
  };
  return {
    ecritures,
    client: { from: requete, rpc: async (nom: string) => ({ data: nom === 'invoice_next_number' ? '2001' : null, error: null }) } as any,
  };
}

const TPS = { id: 'tps', name: 'TPS', rate: 5, is_compound: false, is_active: true, type: 'percentage' };
const TVQ = { id: 'tvq', name: 'TVQ', rate: 9.975, is_compound: false, is_active: true, type: 'percentage' };
const baseQuebec = (client: Record<string, unknown> = { province: 'QC', address: 'Québec', tax_exempt: false }) => ({
  clients: client,
  tax_groups: { id: 'g1', region: 'QC', is_default: true, is_active: true },
  tax_group_items: [{ tax_configs: TPS }, { tax_configs: TVQ }],
  memberships: [{ user_id: 'proprio', role: 'owner' }],
  company_settings: { default_language: 'fr' },
  recurring_invoice_schedules: [],
});

const echeance = (auto_send: boolean): RecurringSchedule => ({
  id: 'r1', org_id: 'org', client_id: 'cli', subject: 'Vitres — mensuel',
  items: [{ description: 'Lavage de vitres commercial', qty: 1, unit_price_cents: 28000 }],
  frequency: 'monthly', start_date: '2026-09-01', end_date: null, next_run_date: '2026-09-29',
  due_days_offset: 30, auto_send, is_active: true,
});

beforeEach(() => { envoi.resultat = { success: true }; envoi.appels = 0; vi.mocked(eventBus.emit).mockClear(); });

describe('facture récurrente : taxes', () => {
  it('280 $ au Québec → TPS 14,00 $ + TVQ 27,93 $ = 321,93 $', async () => {
    const f = fauxClient(baseQuebec());
    await runOneSchedule(f.client, echeance(false), { advance: false });
    const facture = f.ecritures.find((e) => e.table === 'invoices' && e.op === 'insert')!.valeurs;
    expect(facture.subtotal_cents).toBe(28000);
    expect(facture.tax_cents).toBe(4193);
    expect(facture.total_cents).toBe(32193);
    expect(facture.balance_cents).toBe(32193);
  });

  it('la ventilation TPS/TVQ est enregistrée (applied_taxes)', async () => {
    const f = fauxClient(baseQuebec());
    await runOneSchedule(f.client, echeance(false), { advance: false });
    const lignes = f.ecritures.find((e) => e.table === 'applied_taxes')!.valeurs;
    expect(lignes.map((l: any) => [l.name, l.amount_cents, l.document_type])).toEqual([['TPS', 1400, 'invoice'], ['TVQ', 2793, 'invoice']]);
  });

  it('un client exempté de taxes n\'en paie aucune', async () => {
    const f = fauxClient(baseQuebec({ province: 'QC', tax_exempt: true }));
    await runOneSchedule(f.client, echeance(false), { advance: false });
    const facture = f.ecritures.find((e) => e.table === 'invoices' && e.op === 'insert')!.valeurs;
    expect(facture.tax_cents).toBe(0);
    expect(facture.total_cents).toBe(28000);
    expect(f.ecritures.some((e) => e.table === 'applied_taxes')).toBe(false);
  });
});

describe('facture récurrente : envoi automatique', () => {
  it('sans envoi automatique : brouillon, aucun courriel', async () => {
    const f = fauxClient(baseQuebec());
    await runOneSchedule(f.client, echeance(false), { advance: false });
    expect(envoi.appels).toBe(0);
    expect(f.ecritures.some((e) => e.table === 'invoices' && e.op === 'update')).toBe(false);
  });

  it('envoi automatique réussi : courriel parti, PUIS facture marquée envoyée et invoice.sent émis', async () => {
    const f = fauxClient(baseQuebec());
    await runOneSchedule(f.client, echeance(true), { advance: false });
    expect(envoi.appels).toBe(1);
    const maj = f.ecritures.find((e) => e.table === 'invoices' && e.op === 'update')!.valeurs;
    expect(maj.status).toBe('sent');
    expect(maj.issued_at).toBeTruthy();
    expect(eventBus.emit).toHaveBeenCalledWith('invoice.sent', expect.objectContaining({ entityId: 'fac-1' }));
  });

  it('courriel refusé (client sans courriel, désabonné…) : la facture RESTE en brouillon', async () => {
    envoi.resultat = { success: false, error: 'aucun courriel' };
    const f = fauxClient(baseQuebec());
    await runOneSchedule(f.client, echeance(true), { advance: false });
    expect(f.ecritures.some((e) => e.table === 'invoices' && e.op === 'update')).toBe(false);
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});
