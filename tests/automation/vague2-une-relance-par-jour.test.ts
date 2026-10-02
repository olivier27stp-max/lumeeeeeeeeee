/**
 * Une facture reçoit au plus UNE relance par jour, toutes automatisations
 * confondues (audit V2, D-16).
 *
 * Mesuré sur staging : une facture en retard recevait la relance « en
 * retard » ET la relance J+1 du préréglage « Invoice Reminder » le même jour.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());

import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';
import { estRegleDeRelanceFacture } from '../../server/lib/automationEngine';

const ORG = '11111111-1111-4111-8111-111111111111';
const COURRIEL = { type: 'send_email', config: { subject: 'Relance', body: 'Votre facture est en retard' } };
const regleRetard = { id: 'r-retard', org_id: ORG, name: 'Facture en retard', trigger_event: 'invoice.overdue', preset_key: null, conditions: {}, delay_seconds: 0, is_active: true, actions: [COURRIEL] };

// En journée (midi à Toronto) : hors de la fenêtre d'envoi, le courriel serait reporté avant même d'être
// comparé aux relances du jour (mission finale, point 11) — ce test dépendait de l'heure où il tournait.
const MIDI = new Date('2026-10-01T16:00:00Z');
afterEach(() => vi.useRealTimers());

async function jouer(relancesDuJour: Array<{ id: string }>) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(MIDI);
  const { initAutomationEngine } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({
    automation_rules: (req: any) => ({
      data: req.filtres.some((f: any[]) => f[1] === 'trigger_event' && f[0] === 'eq')
        ? [regleRetard]
        : [regleRetard, { id: 'r-j1', trigger_event: 'invoice.sent', preset_key: 'invoice_sent_reminder_1d' }],
    }),
    automation_execution_logs: (req: any) => (req.op === 'select' && req.filtres.some((f: any[]) => f[1] === 'automation_rule_id')
      ? { data: relancesDuJour }
      : { data: req.op === 'insert' ? [{ id: 'resa' }] : null }),
    company_settings: { data: { company_name: 'A' } },
    invoices: { data: [{ id: 'f1', status: 'sent', client_id: 'c1', invoice_number: 'INV-1', total_cents: 10000, balance_cents: 10000 }] },
    clients: { data: [{ id: 'c1', first_name: 'Marie', email: 'marie@example.test', email_consent_at: '2026-01-01T00:00:00Z', email_opt_out_at: null }] },
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: null as any, baseUrl: 'http://t' });
  await eventBus.emit('invoice.overdue', { orgId: ORG, entityType: 'invoice', entityId: 'f1', metadata: { days_overdue: 1 } });
  for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r));
  const journaux = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any)
    .concat(requetes(journal, 'automation_execution_logs', 'update').map((r) => r.valeur as any));
  return journaux;
}

describe('D-16 — une relance de facture par jour', () => {
  it('la relance J+1 est déjà partie aujourd’hui → « en retard » est sautée', async () => {
    const journaux = await jouer([{ id: 'envoi-j1' }]);
    expect(journaux.some((j) => j?.result_data?.saute_code === 'deja_envoye')).toBe(true);
    expect(journaux.some((j) => j?.result_success === true && !j?.result_data?.saute)).toBe(false);
  });

  it('témoin : aucune autre relance aujourd’hui → elle part', async () => {
    const journaux = await jouer([]);
    expect(journaux.some((j) => j?.result_data?.saute_code === 'deja_envoye')).toBe(false);
  });

  it('qui compte comme une règle de relance', () => {
    expect(estRegleDeRelanceFacture({ trigger_event: 'invoice.overdue' })).toBe(true);
    expect(estRegleDeRelanceFacture({ trigger_event: 'invoice.sent', preset_key: 'invoice_sent_reminder_7d' })).toBe(true);
    expect(estRegleDeRelanceFacture({ trigger_event: 'invoice.sent', preset_key: 'pack_relance_facture' })).toBe(true);
    // Envoyer la facture n'est pas une relance.
    expect(estRegleDeRelanceFacture({ trigger_event: 'invoice.sent', preset_key: null })).toBe(false);
  });
});
