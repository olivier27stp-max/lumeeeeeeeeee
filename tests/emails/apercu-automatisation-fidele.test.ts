/**
 * L'aperçu « réel » d'un courriel d'automatisation montre ce qui PARTIRA.
 *
 * Audit du 2026-10-01 (constat majeur, observé à l'écran) : pour n'importe quel
 * courriel d'automatisation, l'aperçu « rendu par le serveur, avec le même
 * gabarit qu'à l'envoi » affichait un bloc « Montant à payer — 1 220,17 $ », un
 * bouton « Voir et payer » et « Carte de crédit · aucun compte à créer ». À
 * l'envoi, un courriel d'automatisation n'a jamais de bloc de montant, et ne
 * porte que le bouton de l'entité de son déclencheur (ou aucun). « M'envoyer un
 * essai » envoyait ce même faux rendu.
 *
 * La vraie route est montée ; seuls l'authentification et les réglages de
 * l'entreprise sont simulés.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const etat = vi.hoisted(() => ({ langue: 'fr', envoye: [] as Array<{ to: string; subject: string; html: string }> }));

vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireAuthedClient: async () => ({ orgId: '11111111-1111-4111-8111-111111111111', user: { id: 'u1', email: 'proprio@lume-qa.test' }, client: {} }),
  isOrgMember: async () => true,
  getServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ data: [], error: null }) }) }) }) }),
}));
vi.mock('../../server/lib/companyBranding', () => ({
  getCompanyBranding: async () => ({ company_name: 'Nettoyage Test', email: 'bureau@lume-qa.test', default_language: etat.langue, brand_color: '#0E7C66' }),
}));
vi.mock('../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  sendEmail: async (p: { to: string; subject: string; html: string }) => { etat.envoye.push(p); return { sent: true, messageId: 'm1' }; },
}));

import router from '../../server/routes/emails';

let serveur: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  await new Promise<void>((ok) => { serveur = app.listen(0, '127.0.0.1', () => ok()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((ok) => serveur.close(ok)); });

const CORPS = '<h2>Bonjour [client_first_name],</h2><p>Merci de votre confiance.</p>';
async function apercu(corps: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${base}/api/emails/apercu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ corpsHtml: CORPS, ...corps }) });
  expect(r.status).toBe(200);
  return ((await r.json()) as { html: string }).html;
}

describe('aperçu d’un courriel d’AUTOMATISATION (sans `type`)', () => {
  it('aucun bloc « Montant à payer », aucun « Voir et payer », aucune mention de carte de crédit', async () => {
    const html = await apercu({ declencheur: 'lead.created' });
    expect(html).toContain('Merci de votre confiance.');
    expect(html).not.toContain('Montant à payer');
    expect(html).not.toContain('1 220,17');
    expect(html).not.toContain('Voir et payer');
    expect(html).not.toContain('Carte de crédit');
  });

  it('un déclencheur sans page publique (prospect, rendez-vous, job) : aucun bouton', async () => {
    for (const declencheur of ['lead.created', 'appointment.created', 'job.completed', '']) {
      const html = await apercu({ declencheur });
      expect(html, declencheur).not.toMatch(/Approuver la soumission|Payer la facture|Voir et payer/);
    }
  });

  it('un déclencheur de devis : le bouton que le client recevra, « Approuver la soumission »', async () => {
    const html = await apercu({ declencheur: 'quote.sent' });
    expect(html).toContain('Approuver la soumission');
    expect(html).not.toContain('Montant à payer');
  });

  it('un déclencheur de facture : « Payer la facture », toujours sans bloc de montant', async () => {
    const html = await apercu({ declencheur: 'invoice.overdue' });
    expect(html).toContain('Payer la facture');
    expect(html).not.toContain('Montant à payer');
  });

  it('les variables sont remplacées par un exemple, comme avant', async () => {
    expect(await apercu({ declencheur: 'lead.created' })).not.toContain('[client_first_name]');
  });

  it('« M’envoyer un essai » envoie CE rendu — pas le faux bloc de paiement', async () => {
    etat.envoye.length = 0;
    const r = await fetch(`${base}/api/emails/apercu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ corpsHtml: CORPS, objet: 'Merci', declencheur: 'lead.created', envoyer: true }) });
    expect(r.status).toBe(200);
    expect(etat.envoye).toHaveLength(1);
    // Toujours à SOI.
    expect(etat.envoye[0].to).toBe('proprio@lume-qa.test');
    expect(etat.envoye[0].html).not.toContain('Montant à payer');
    expect(etat.envoye[0].html).not.toContain('Voir et payer');
  });
});

describe('aperçu d’un courriel de FACTURE (`type` fourni) : inchangé', () => {
  it('le bloc de montant et le bouton de paiement d’exemple restent', async () => {
    const html = await apercu({ type: 'invoice_sent' });
    expect(html).toContain('Montant à payer');
    expect(html).toContain('Voir et payer');
  });
});
