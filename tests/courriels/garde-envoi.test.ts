/**
 * Garde d'envoi (server/lib/courriels/garde-envoi.ts + sendEmail) — audit
 * des courriels du 2026-09-29, bugs P0 :
 *   1. liens localhost → envoi REFUSÉ (sauf mode QA, qui ne part qu'au testeur)
 *   2. nom d'entreprise vide → jamais de « — » orphelin dans l'objet
 *   3. voix Lume → Reply-To support, expéditeur jamais anonyme
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const envois = vi.hoisted(() => ({ liste: [] as any[] }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: vi.fn(async (m: any) => { envois.liste.push(m); return { messageId: 'garde-test', response: '250 Ok garde-test' }; }),
    }),
  },
}));
vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  getServiceClient: () => ({ from: () => { const o: any = {}; for (const m of ['select', 'eq', 'is', 'in', 'limit', 'maybeSingle', 'insert', 'order']) o[m] = () => o; o.then = (r: any) => Promise.resolve({ data: null, error: null }).then(r); o.maybeSingle = async () => ({ data: null, error: null }); return o; } }),
}));
vi.mock('../../server/lib/migration/gel-communications', () => ({ destinataireGele: async () => null, journaliserBlocage: () => {}, MESSAGE_GEL: 'gel' }));

import { liensNonPublics, nettoyerObjet, ecartsObjet, expediteurComplet, decomposerExpediteur } from '../../server/lib/courriels/garde-envoi';
import { sendEmail } from '../../server/lib/mailer';

const ENV = { ...process.env };
beforeEach(() => {
  envois.liste.length = 0;
  process.env.EMAIL_FROM = 'Lume CRM <factures@lumecrm.net>';
  process.env.SMTP_USER = 'factures@lumecrm.net';
  process.env.SMTP_PASS = 'x';
  process.env.COURRIEL_FOURNISSEUR = 'smtp';
  delete process.env.RESEND_API_KEY;
  delete process.env.QA_REDIRECT_EMAIL;
  delete process.env.QA_REDIRECT_TO;
});
afterEach(() => { process.env = { ...ENV }; });

describe('liens non publics', () => {
  it.each([
    'http://localhost:5173/quote/abc',
    'https://127.0.0.1/pay/x',
    'http://0.0.0.0:3002/x',
    'http://192.168.1.20/facture',
    'http://10.0.0.5/x',
    'http://172.20.1.1/x',
    'http://lume.local/x',
  ])('%s est repéré', (url) => {
    expect(liensNonPublics(`<a href="${url}">Voir</a>`)).toEqual([url]);
  });
  it.each(['https://lumecrm.net/quote/abc', 'https://app.lumecrm.net/pay/x', 'https://172.15.0.1/x', 'https://g.page/r/review'])(
    '%s est public', (url) => { expect(liensNonPublics(`<a href="${url}">x</a>`)).toEqual([]); },
  );
});

describe('objet', () => {
  it.each([
    [' — Payment Received', 'Payment Received'],
    ['Facture 12 — ', 'Facture 12'],
    ['  Paiement   reçu  ', 'Paiement reçu'],
    ['Vision Lavage — Paiement reçu', 'Vision Lavage — Paiement reçu'],
  ])('« %s » → « %s »', (brut, net) => { expect(nettoyerObjet(brut)).toBe(net); });

  it('les écarts aux règles permanentes sont nommés', () => {
    expect(ecartsObjet('Facture 42 — 125,00 $')).toEqual([]);
    expect(ecartsObjet('👀 Marie vient d’ouvrir la soumission')).toContain('emoji en tête d’objet');
    expect(ecartsObjet('Soumission #QAV2B-PR-13429')).toContain('référence interne dans l’objet');
    expect(ecartsObjet('x'.repeat(61))[0]).toMatch(/61 caractères/);
    expect(ecartsObjet('')).toContain('objet vide');
  });
});

describe('expéditeur', () => {
  it('un expéditeur plateforme sans nom devient « Lume CRM »', () => {
    expect(expediteurComplet('<factures@lumecrm.net>', 'factures@lumecrm.net')).toBe('Lume CRM <factures@lumecrm.net>');
    expect(expediteurComplet('Vision Lavage <vision-lavage@lumecrm.net>', 'factures@lumecrm.net')).toBe('Vision Lavage <vision-lavage@lumecrm.net>');
  });
  it('décompose « Nom <adresse> »', () => {
    expect(decomposerExpediteur('"Coquin lavage" <coquin@lumecrm.net>')).toEqual({ nom: 'Coquin lavage', adresse: 'coquin@lumecrm.net' });
  });
});

describe('sendEmail applique la garde', () => {
  it('REFUSE un courriel avec un lien localhost — rien ne part', async () => {
    const r = await sendEmail({ to: 'client@exemple.test', subject: 'Votre facture', html: '<a href="http://localhost:5173/invoice/abc">Voir</a>' });
    expect(r.sent).toBe(false);
    expect(r.error).toMatch(/lien non public/);
    expect(envois.liste).toHaveLength(0);
  });

  it('mode QA (redirigé vers le testeur) : le lien localhost passe', async () => {
    process.env.QA_REDIRECT_EMAIL = 'testeur@exemple.test';
    const r = await sendEmail({ to: 'client@exemple.test', subject: 'Votre facture', html: '<a href="http://localhost:5173/invoice/abc">Voir</a>' });
    expect(r.sent).toBe(true);
    expect(envois.liste[0].to).toBe('testeur@exemple.test');
  });

  it('voix Lume : Reply-To support, objet nettoyé', async () => {
    await sendEmail({ to: 'proprio@exemple.test', subject: ' — Paiement reçu', html: '<p>ok</p>' });
    expect(envois.liste[0].replyTo).toBe('support@lumecrm.net');
    expect(envois.liste[0].subject).toBe('Paiement reçu');
    expect(envois.liste[0].from).toBe('Lume CRM <factures@lumecrm.net>');
  });

  it('voix de l’entreprise : son Reply-To est gardé, jamais remplacé par le support', async () => {
    await sendEmail({ to: 'client@exemple.test', from: 'Vision Lavage <vision-lavage@lumecrm.net>', replyTo: 'info@visionlavage.ca', subject: 'Facture 46', html: '<p>ok</p>' });
    expect(envois.liste[0].replyTo).toBe('info@visionlavage.ca');
  });

  it('voix de l’entreprise sans Reply-To : on n’y met PAS le support de Lume', async () => {
    await sendEmail({ to: 'client@exemple.test', from: 'Vision Lavage <vision-lavage@lumecrm.net>', subject: 'Facture 46', html: '<p>ok</p>' });
    expect(envois.liste[0].replyTo).toBeUndefined();
  });
});
