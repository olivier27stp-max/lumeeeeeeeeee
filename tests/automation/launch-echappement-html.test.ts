/**
 * Launch 2026-09-28 — bloc 4 : toute variable insérée dans le corps d'un
 * courriel est échappée. Un nom venu d'un formulaire public (« <a href=…> »)
 * s'affichait tel quel dans le courriel reçu par le client.
 */
import { describe, it, expect, vi } from 'vitest';

const envoi = vi.hoisted(() => ({ html: [] as string[], sujets: [] as string[] }));
vi.mock('../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  adresseInjoignable: async () => false,
  sendEmail: vi.fn(async (p: any) => { envoi.html.push(p.html); envoi.sujets.push(p.subject); return { sent: true, messageId: 'x' }; }),
}));
vi.mock('../../server/routes/emails', () => ({
  getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b,
  senderForOrg: async () => ({ from: 'T <t@lume.test>' }), langueEntreprise: () => 'fr',
}));
vi.mock('../../server/lib/migration/gel-communications', () => ({ destinataireGele: async () => null, journaliserBlocage: () => {}, MESSAGE_GEL: 'gel' }));

import { executeSendEmail, resolveTemplate } from '../../server/lib/actions/index';
import { clientEnregistreur } from '../quarantaine/automation/_enregistreur';

const PIEGE = '<a href="https://hameconnage.test">Payez ici</a>';

describe('échappement HTML des variables', () => {
  it('dans le corps du courriel envoyé : le nom piégé arrive échappé, [contract_html] reste du HTML', async () => {
    const { client } = clientEnregistreur({ clients: { data: { id: 'c', email: 'a@b.test', email_consent_at: null, sms_consent_at: null, email_opt_out_at: null } }, activity_log: { data: null } });
    const ctx = { supabase: client, orgId: 'o', entityType: 'client', entityId: 'c', twilio: null, baseUrl: 'x', commercial: false } as any;
    await executeSendEmail({ subject: 'Bonjour [client_first_name]', body: '<p>Bonjour [client_first_name]</p>[contract_html]' },
      { client_email: 'a@b.test', client_first_name: PIEGE, contract_html: '<p>Signez ici</p>' }, ctx);
    const html = envoi.html.at(-1)!;
    expect(html).not.toContain('<a href="https://hameconnage.test">');
    expect(html).toContain('&lt;a href=&quot;https://hameconnage.test&quot;&gt;');
    expect(html).toContain('<p>Signez ici</p>');
    // L'objet est du texte : pas d'entités HTML.
    expect(envoi.sujets.at(-1)).toBe(`Bonjour ${PIEGE}`);
  });

  it('un texto (texte brut) n’est pas échappé', () => {
    expect(resolveTemplate('Bonjour [nom]', { nom: 'Tom & Jerry' })).toBe('Bonjour Tom & Jerry');
    expect(resolveTemplate('Bonjour [nom]', { nom: 'Tom & Jerry' }, { html: true })).toBe('Bonjour Tom &amp; Jerry');
  });
});
