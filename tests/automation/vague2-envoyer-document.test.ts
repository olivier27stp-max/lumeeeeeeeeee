/**
 * « Envoyer la facture / la soumission » ENVOIE le document, comme le bouton
 * manuel (audit V2, D-06).
 *
 * Mesuré sur staging : le lien partait mais le document restait en brouillon
 * (sent_at nul) — absent des impayés, pas d'invoice.sent, relances jamais
 * lancées. Même effet maintenant que /emails/send-invoice et l'envoi de devis.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ client: null as any, emis: [] as Array<{ type: string; entityId: string }>, envoyer: true }));

vi.mock('../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => etat.client }));
vi.mock('../../server/lib/mailer', async (orig) => ({
  ...(await orig<any>()),
  isMailerConfigured: () => true,
  adresseInjoignable: async () => false,
  sendEmail: vi.fn(async () => (etat.envoyer ? { sent: true, messageId: 'x' } : { sent: false, error: 'panne' })),
}));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({ ...(await orig<any>()), getOrgSmsFromNumber: async () => '+15550000000' }));
vi.mock('../../server/lib/eventBus', async (orig) => {
  const reel = await orig<any>();
  return { ...reel, eventBus: { ...reel.eventBus, emit: async (type: string, e: { entityId: string }) => { etat.emis.push({ type, entityId: e.entityId }); } } };
});

import { executeAction } from '../../server/lib/actions/index';
import { clientEnregistreur } from './filet-regression/_enregistreur';
import { monde, ORG, IDS } from './filet-regression/_banc';

process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';

function contexte(entityType: 'invoice' | 'quote', surcharges: Record<string, unknown>) {
  const m = monde({ id: 'r', trigger_event: entityType === 'invoice' ? 'invoice.sent' : 'quote.sent' }, surcharges);
  const { client, journal } = clientEnregistreur(m as any);
  etat.client = client;
  return { journal, ctx: { supabase: client, orgId: ORG, entityType, entityId: entityType === 'invoice' ? IDS.facture : IDS.devis, twilio: null, baseUrl: 'https://app.lume.test' } };
}

async function envoyer(type: 'envoyer_facture' | 'envoyer_soumission', entityType: 'invoice' | 'quote', surcharges: Record<string, unknown>) {
  const { journal, ctx } = contexte(entityType, surcharges);
  const { resolveEntityVariables } = await import('../../server/lib/actions/index');
  const vars = await resolveEntityVariables(ctx.supabase as any, ORG, entityType, ctx.entityId);
  const r = await executeAction(type as any, {}, vars, ctx as any);
  const majs = journal.filter((q: any) => q.op === 'update' && (q.table === 'invoices' || q.table === 'quotes')).map((q: any) => ({ table: q.table, valeur: q.valeur }));
  return { r, majs };
}

beforeEach(() => { etat.emis.length = 0; etat.envoyer = true; });

describe('D-06 — le document envoyé par une automatisation est ENVOYÉ', () => {
  it('facture brouillon → envoyée (sent_at + issued_at) ; le trigger en base émettra invoice.sent', async () => {
    const { r, majs } = await envoyer('envoyer_facture', 'invoice', {
      invoices: { data: [{ id: IDS.facture, org_id: ORG, invoice_number: 'INV-000042', status: 'draft', client_id: IDS.client, job_id: IDS.job, total_cents: 162690, balance_cents: 162690, due_date: '2026-10-15', deleted_at: null, view_token: 'bbbbbbbb-0000-4000-8000-000000000002' }] },
    });
    expect(r.success).toBe(true);
    const facture = majs.find((m) => m.table === 'invoices')?.valeur as Record<string, unknown>;
    expect(facture?.status).toBe('sent');
    expect(facture?.sent_at).toBeTruthy();
  });

  it('soumission brouillon → en attente de réponse, et quote.sent émis UNE fois', async () => {
    const { majs } = await envoyer('envoyer_soumission', 'quote', {
      quotes: { data: [{ id: IDS.devis, org_id: ORG, quote_number: 'Q-2026-042', status: 'draft', client_id: IDS.client, lead_id: null, job_id: IDS.job, total_cents: 162690, currency: 'CAD', deleted_at: null, view_token: 'bbbbbbbb-0000-4000-8000-000000000001' }] },
    });
    const devis = majs.find((m) => m.table === 'quotes')?.valeur as Record<string, unknown>;
    expect(devis?.status).toBe('awaiting_response');
    expect(devis?.sent_via_email_at).toBeTruthy();
    expect(etat.emis.filter((e) => e.type === 'quote.sent')).toEqual([{ type: 'quote.sent', entityId: IDS.devis }]);
  });

  it('renvoi d’une soumission déjà acceptée : statut intact, pas de quote.sent (pas de boucle)', async () => {
    const { majs } = await envoyer('envoyer_soumission', 'quote', {
      quotes: { data: [{ id: IDS.devis, org_id: ORG, quote_number: 'Q-2026-042', status: 'approved', client_id: IDS.client, lead_id: null, job_id: IDS.job, total_cents: 162690, currency: 'CAD', deleted_at: null, view_token: 'bbbbbbbb-0000-4000-8000-000000000001' }] },
    });
    const devis = majs.find((m) => m.table === 'quotes')?.valeur as Record<string, unknown>;
    expect(devis?.status).toBeUndefined();
    expect(etat.emis.filter((e) => e.type === 'quote.sent')).toEqual([]);
  });

  it('courriel non parti → le document reste tel quel', async () => {
    etat.envoyer = false;
    const { majs } = await envoyer('envoyer_facture', 'invoice', {
      invoices: { data: [{ id: IDS.facture, org_id: ORG, invoice_number: 'INV-000042', status: 'draft', client_id: IDS.client, job_id: IDS.job, total_cents: 162690, balance_cents: 162690, due_date: '2026-10-15', deleted_at: null, view_token: 'bbbbbbbb-0000-4000-8000-000000000002' }] },
    });
    expect(majs.filter((m) => m.table === 'invoices')).toEqual([]);
  });
});
