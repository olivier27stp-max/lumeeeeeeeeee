/**
 * 04-courriel:725 [MSG-017] — dans l'« Aperçu réel » d'un courriel (et l'essai
 * qu'on s'envoie), `[company_name]` est le nom du BUREAU COURANT.
 *
 * L'aperçu finissait par « Merci, <un exemple> » — longtemps le nom d'un vrai
 * client de Lume — sous un en-tête qui, lui, portait le vrai nom du bureau.
 *
 * La vraie route est montée ; seuls l'authentification, les réglages de
 * l'entreprise et l'envoi sont simulés (même montage que
 * tests/emails/apercu-automatisation-fidele.test.ts).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const etat = vi.hoisted(() => ({ nom: 'Nettoyage Test A' as string | null, langue: 'fr', envoye: [] as Array<{ to: string; subject: string; html: string }> }));

vi.mock('../../../server/lib/supabase', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireAuthedClient: async () => ({ orgId: '11111111-1111-4111-8111-111111111111', user: { id: 'u1', email: 'proprio@lume-qa.test' }, client: {} }),
  isOrgMember: async () => true,
  getServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ data: [], error: null }) }) }) }) }),
}));
vi.mock('../../../server/lib/companyBranding', () => ({
  getCompanyBranding: async () => ({ company_name: etat.nom, email: 'bureau@lume-qa.test', default_language: etat.langue, brand_color: '#0E7C66' }),
}));
vi.mock('../../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  sendEmail: async (p: { to: string; subject: string; html: string }) => { etat.envoye.push(p); return { sent: true, messageId: 'm1' }; },
}));

import router from '../../../server/routes/emails';

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
beforeEach(() => { etat.nom = 'Nettoyage Test A'; etat.langue = 'fr'; etat.envoye.length = 0; });

async function apercu(corps: Record<string, unknown>): Promise<string> {
  const r = await fetch(`${base}/api/emails/apercu`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps) });
  expect(r.status).toBe(200);
  return ((await r.json()) as { html: string }).html;
}
/** Le texte d'un paragraphe du corps (les balises retirées). */
const paragraphes = (html: string): string[] => [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gs)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());

describe('04-courriel:725 — `[company_name]` dans l’aperçu réel est le nom du bureau courant', () => {
  it('courriel d’automatisation : « Merci, [company_name] » devient « Merci, Nettoyage Test A »', async () => {
    const html = await apercu({ corpsHtml: '<h2>Bonjour [client_first_name],</h2><p>Merci, [company_name]</p>', declencheur: 'appointment.created' });
    expect(paragraphes(html)).toContain('Merci, Nettoyage Test A');
    // Ni l'exemple neutre, ni le crochet, ni — surtout — le nom d'un autre bureau.
    expect(html).not.toContain('Votre entreprise');
    expect(html).not.toContain('[company_name]');
    expect(html).not.toContain('Coquin lavage');
    // Les autres variables gardent leur exemple.
    expect(html).toContain('Bonjour Marie,');
  });

  it('les trois écritures d’une variable : [company_name], {company_name}, {{ company_name }}', async () => {
    const html = await apercu({ corpsHtml: '<p>A [company_name]</p><p>B {company_name}</p><p>C {{ company_name }}</p>', declencheur: 'lead.created' });
    expect(paragraphes(html)).toEqual(expect.arrayContaining(['A Nettoyage Test A', 'B Nettoyage Test A', 'C Nettoyage Test A']));
  });

  it('modèle de courriel (`type` fourni) : le vrai nom aussi, pas « Votre entreprise »', async () => {
    const html = await apercu({ corpsHtml: '<p>Merci, {company_name}</p>', type: 'invoice_sent' });
    expect(paragraphes(html)).toContain('Merci, Nettoyage Test A');
  });

  it('un nom qui porte « & » ou « < » s’affiche tel qu’il est écrit, sans devenir du HTML', async () => {
    etat.nom = 'Dupont & Fils <Toitures>';
    const html = await apercu({ corpsHtml: '<p>Merci, [company_name]</p>', declencheur: 'lead.created' });
    expect(html).toContain('Merci, Dupont &amp; Fils &lt;Toitures&gt;');
    expect(html).not.toContain('<Toitures>');
  });

  it('bureau sans nom enregistré : l’exemple neutre, jamais le nom d’un autre bureau', async () => {
    etat.nom = null;
    const html = await apercu({ corpsHtml: '<p>Merci, [company_name]</p>', declencheur: 'lead.created' });
    expect(paragraphes(html)).toContain('Merci, Votre entreprise');
    expect(html).not.toContain('Coquin lavage');
  });

  it('« M’envoyer un essai » : le corps ET l’objet portent le nom du bureau', async () => {
    etat.nom = 'Dupont & Fils';
    const r = await fetch(`${base}/api/emails/apercu`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ corpsHtml: '<p>Merci, [company_name]</p>', objet: 'Des nouvelles de [company_name]', declencheur: 'lead.created', envoyer: true }),
    });
    expect(r.status).toBe(200);
    expect(etat.envoye).toHaveLength(1);
    // L'objet est du texte : le nom y est écrit tel quel, sans « &amp; ».
    expect(etat.envoye[0].subject).toBe('[Essai] Des nouvelles de Dupont & Fils');
    expect(etat.envoye[0].html).toContain('Merci, Dupont &amp; Fils');
  });
});
