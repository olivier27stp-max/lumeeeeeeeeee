/**
 * T8 (intégration, STAGING) — PERMISSIONS : un employé ne peut pas faire faire
 * au moteur ce qu'il n'a pas le droit de faire à la main.
 *
 *   T8.1  un technicien (pas de droit invoices.update) insère par PostgREST une
 *         règle « facture payée → statut paid », puis poste le hook
 *         invoice-paid sur une facture impayée → la facture NE doit PAS passer
 *         payée                                       ROUGE (F4 + F15, migration M1)
 *   T8.2  un technicien réécrit `config.to` d'une règle de confirmation →
 *         le SMS du client suivant NE doit PAS partir vers son numéro
 *                                                       ROUGE (F4 + F18, migration M1)
 *   T8.4  un membre dont l'adhésion est inactive appelle un hook → 403
 *                                                       ROUGE (has_org_membership sans statut, M7)
 *
 * Opt-in `AUTOMATIONS_IT=1` / `DB_URL` ; refuse la prod ; fixtures `qa-t8-*`
 * nettoyées ; les règles modifiées sont restaurées dans `finally`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { Banc, DISPONIBLE, attendre, type OrgTest } from './_fixtures';

const sms: Array<{ to: string; body: string }> = [];
vi.mock('../../server/lib/mailer', () => ({ isMailerConfigured: () => true, sendEmail: vi.fn(async () => ({ sent: true, messageId: 'test' })) }));
vi.mock('../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'qa@lume.test' }) }));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));
const twilio = { messages: { create: vi.fn(async (p: { to: string; body: string }) => { sms.push({ to: p.to, body: p.body }); return { sid: `SM_${sms.length}` }; }) } };

const banc = new Banc('t8');
let A: OrgTest;
let technicien: { id: string; email: string };
let inactif: { id: string; email: string };
let jetonOwner = ''; let jetonTech = ''; let jetonInactif = '';

function figerLHeureEnJournee() { const d = new Date(); d.setUTCHours(18, 0, 0, 0); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(d); }

describe.skipIf(!DISPONIBLE)('T8 — permissions (staging)', () => {
  beforeAll(async () => {
    A = await banc.creerOrg('A');
    technicien = await banc.creerUtilisateur('A-tech');
    inactif = await banc.creerUtilisateur('A-inactif');
    const { error: e1 } = await banc.admin.from('memberships').insert({ user_id: technicien.id, org_id: A.id, role: 'technician', status: 'active' });
    if (e1) throw new Error(e1.message);
    const { error: e2 } = await banc.admin.from('memberships').insert({ user_id: inactif.id, org_id: A.id, role: 'admin', status: 'inactive' });
    if (e2) throw new Error(e2.message);
    jetonOwner = await banc.jetonDe(A.owner.email);
    jetonTech = await banc.jetonDe(technicien.email);
    jetonInactif = await banc.jetonDe(inactif.email);
    await banc.demarrerServeur({ client: twilio, phoneNumber: '+15550000000' });
  }, 90_000);
  afterAll(async () => { vi.useRealTimers(); await banc.nettoyer(); }, 60_000);
  beforeEach(() => { sms.length = 0; twilio.messages.create.mockClear(); figerLHeureEnJournee(); });

  it('T8.1 — corrigé (F4/F15, M1) : un technicien ne peut pas faire marquer une facture payée par le moteur', async () => {
    // Une facture impayée de l'org.
    const { data: facture, error: ef } = await banc.admin.from('invoices').insert({
      org_id: A.id, client_id: A.client.id, created_by: A.owner.id, invoice_number: `T8-${banc.stamp}`, status: 'sent', currency: 'CAD',
      subtotal_cents: 100000, tax_cents: 0, total_cents: 100000, balance_cents: 100000, paid_cents: 0, due_date: new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10),
    }).select('id, status').single();
    if (ef) throw new Error(`facture : ${ef.message}`);
    // Un trigger peut ramener une facture insérée à « draft » : on la passe explicitement à « sent » (impayée, envoyée au client).
    await banc.admin.from('invoices').update({ status: 'sent' }).eq('id', facture.id);
    const { data: avant } = await banc.admin.from('invoices').select('status').eq('id', facture.id).single();
    const statutAvant = avant!.status;
    expect(statutAvant).not.toBe('paid');

    // Le technicien n'a pas invoices.update. Il insère une règle par PostgREST…
    const t = banc.clientDe(jetonTech);
    const { data: regle } = await t.from('automation_rules').insert({
      org_id: A.id, name: `${banc.prefixe} escalade`, trigger_event: 'invoice.paid', conditions: {}, delay_seconds: 0,
      actions: [{ type: 'update_status', config: { table: 'invoices', status: 'paid' } }], is_active: true, is_preset: false,
    }).select('id').maybeSingle();
    try {
      // …puis poste le hook « facture payée » sur la facture impayée.
      const r = await banc.poster(jetonTech, A.id, 'invoice-paid', { invoiceId: facture.id, clientId: A.client.id });
      await attendre(async () => (await banc.admin.from('invoices').select('status').eq('id', facture.id).single()).data?.status === 'paid', 10);
      const { data: apres } = await banc.admin.from('invoices').select('status').eq('id', facture.id).single();
      const preuve = { regle_inseree_par_technicien: !!regle, hook_statut: r.statut, facture_apres: apres?.status };
      expect(regle, `un technicien a pu créer une règle (RLS ouverte) : ${JSON.stringify(preuve)}`).toBeNull();
      expect(apres?.status, `facture marquée payée sans paiement, par un technicien, via le moteur : ${JSON.stringify(preuve)}`).toBe(statutAvant);
    } finally {
      if (regle?.id) await banc.admin.from('automation_rules').delete().eq('id', regle.id);
      await banc.admin.from('invoices').delete().eq('id', facture.id);
    }
  }, 40_000);

  it('T8.2 — corrigé (F4/F18, M1) : un technicien ne peut pas détourner les confirmations vers son numéro', async () => {
    const regle = A.regles.get('appointment_confirmation')!;
    const { data: avant } = await banc.admin.from('automation_rules').select('actions').eq('id', regle).single();
    const detourne = (avant!.actions as any[]).map((a) => (a.type === 'send_sms' ? { ...a, config: { ...a.config, to: '+15145559999' } } : a));
    const t = banc.clientDe(jetonTech);
    const { data: ecrit } = await t.from('automation_rules').update({ actions: detourne }).eq('id', regle).select('id');
    try {
      // L'owner crée une visite, comme d'habitude.
      await banc.poster(jetonOwner, A.id, 'appointment-created', { eventId: A.visite, jobId: A.job, clientId: A.client.id });
      await attendre(async () => sms.some((s) => /confirm/i.test(s.body)));
      const versTech = sms.filter((s) => s.to === '+15145559999');
      const preuve = { regle_reecrite_par_technicien: (ecrit ?? []).length > 0, sms_vers_le_technicien: versTech.length, sms_vers_le_client: sms.filter((s) => s.to === A.client.phone).length };
      expect(versTech, `confirmation du client détournée vers le numéro du technicien : ${JSON.stringify(preuve)}`).toHaveLength(0);
      expect(ecrit ?? [], `un technicien a pu réécrire une règle (RLS ouverte) : ${JSON.stringify(preuve)}`).toHaveLength(0);
    } finally {
      await banc.admin.from('automation_rules').update({ actions: avant!.actions }).eq('id', regle);
    }
  }, 40_000);

  it('T8.4 — corrigé (M7) : un membre dont l’adhésion est inactive ne peut pas appeler un hook d’événement', async () => {
    const r = await banc.poster(jetonInactif, A.id, 'lead-created', { leadId: A.client.id });
    expect(r.statut, `membre inactif accepté (${r.statut}) : has_org_membership ne regarde pas memberships.status`).toBe(403);
  }, 30_000);
});
