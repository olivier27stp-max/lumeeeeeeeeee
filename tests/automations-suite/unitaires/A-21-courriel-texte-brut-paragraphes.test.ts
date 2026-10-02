/**
 * A-21 — un courriel d'automatisation dont le corps est du TEXTE BRUT à
 * plusieurs paragraphes (écrit à la main, par un ancien outil, ou importé)
 * partait chez le client en UN SEUL BLOC : le corps est posé dans un gabarit
 * HTML, où un retour à la ligne ne vaut rien.
 *
 * Attendu : un corps SANS balise voit ses lignes vides devenir des
 * paragraphes et ses retours simples des `<br>` ; un corps qui porte déjà du
 * HTML n'est pas touché ; une valeur de variable ne peut rien injecter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const envois: Array<{ to: string; html: string }> = [];
vi.mock('../../../server/lib/mailer', () => ({
  isMailerConfigured: () => true,
  adresseInjoignable: async () => false,
  sendEmail: vi.fn(async (p: { to: string; html: string }) => { envois.push({ to: p.to, html: p.html }); return { sent: true, messageId: 'x' }; }),
}));
vi.mock('../../../server/routes/emails', () => ({
  getCompanySettings: async () => ({ company_name: 'Entreprise test', company_address: '120 rue Principale, Granby, QC' }),
  // Le gabarit commun, réduit à son contenu : on lit ce que l'action y pose.
  buildEmailLayout: (_c: unknown, contenu: string) => `<html><body>${contenu}</body></html>`,
  senderFor: () => ({ from: 'test@lume.test' }),
  senderForOrg: async () => ({ from: 'test@lume.test' }),
  langueEntreprise: () => 'fr',
}));
vi.mock('../../../server/lib/notificationHelpers', () => ({
  isEmailUnsubscribed: async () => false,
  getUnsubscribeUrl: async () => 'https://lume.test/unsub',
}));

import { fauxSupabase } from './_faux-supabase';
import { corpsCourrielEnHtml, corpsEstDuHtml, executeSendEmail, resolveTemplate } from '../../../server/lib/actions/index';

const ORG = '11111111-1111-4111-8111-111111111111';
const TEXTE_BRUT = 'Bonjour [client_first_name],\n\nVotre facture [invoice_number] est en retard.\n\nMerci,\nL’équipe';
/** Le rendu du moteur : variables remplacées (et échappées), puis mise en paragraphes. */
const rendre = (gabarit: string, vars: Record<string, string>) => corpsCourrielEnHtml(gabarit, resolveTemplate(gabarit, vars, { html: true }));

beforeEach(() => { envois.length = 0; });

describe('[A-21] un corps en texte brut garde ses paragraphes', () => {
  it('les lignes vides séparent des paragraphes, un retour simple devient <br>', () => {
    expect(rendre(TEXTE_BRUT, { client_first_name: 'Marie', invoice_number: 'F-1042' }))
      .toBe('<p>Bonjour Marie,</p><p>Votre facture F-1042 est en retard.</p><p>Merci,<br>L’équipe</p>');
  });

  it('retours Windows (\\r\\n), plusieurs lignes vides, espaces en bout de ligne : même résultat', () => {
    expect(rendre('Bonjour,  \r\n\r\n \r\n\r\nDeuxième paragraphe\r\nligne 2\r\n\r\n', {}))
      .toBe('<p>Bonjour,</p><p>Deuxième paragraphe<br>ligne 2</p>');
  });

  it('un corps d’une seule ligne n’est pas touché', () => {
    expect(rendre('Bonjour [client_first_name], merci !', { client_first_name: 'Marie' })).toBe('Bonjour Marie, merci !');
  });

  it('une valeur de variable sur plusieurs lignes (une adresse) garde ses lignes', () => {
    expect(rendre('Rendez-vous au :\n[adresse]', { adresse: '120 rue Principale\nGranby' }))
      .toBe('<p>Rendez-vous au :<br>120 rue Principale<br>Granby</p>');
  });
});

describe('[A-21] un corps qui porte déjà du HTML n’est pas touché', () => {
  it('le format de l’éditeur (<p>…</p>) sort à l’octet près, retours à la ligne compris', () => {
    const html = '<p>Bonjour [client_first_name],</p>\n\n<p>Votre facture est en retard.</p>\n<p>Merci</p>';
    expect(rendre(html, { client_first_name: 'Marie' })).toBe('<p>Bonjour Marie,</p>\n\n<p>Votre facture est en retard.</p>\n<p>Merci</p>');
  });

  it.each([
    ['<p>Bonjour</p>', true], ['Bonjour<br>Merci', true], ['Bonjour<br/>Merci', true], ['<a href="https://x.test">lien</a>', true],
    ['<!-- note -->Bonjour', true], ['</div>', true], ['<IMG SRC="x.png">', true],
    ['Bonjour,\n\nMerci', false], ['5 < 10 et 10 > 5', false], ['Je vous <3', false], ['a<b', false], ['prix < 100 $ > 50 $', false], ['', false],
  ])('« %s » : HTML = %s', (texte, attendu) => {
    expect(corpsEstDuHtml(texte)).toBe(attendu);
  });
});

describe('[A-21] aucune injection par une valeur de variable', () => {
  const MECHANT = '<script>alert(1)</script><img src=x onerror=alert(2)>';

  it('texte brut : la valeur reste échappée, dans son paragraphe', () => {
    const html = rendre(TEXTE_BRUT, { client_first_name: MECHANT, invoice_number: 'F-1' });
    expect(html).not.toMatch(/<script|<img/i);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html.startsWith('<p>Bonjour &lt;script&gt;')).toBe(true);
  });

  it('une valeur qui contient des balises ne fait PAS passer un texte brut pour du HTML : les paragraphes sont posés quand même', () => {
    const html = rendre('Bonjour [client_first_name],\n\nMerci', { client_first_name: '<p>Marie</p>' });
    expect(html).toBe('<p>Bonjour &lt;p&gt;Marie&lt;/p&gt;,</p><p>Merci</p>');
  });

  it('corps HTML : la valeur reste échappée comme avant, et ses retours à la ligne ne deviennent pas des balises', () => {
    const html = rendre('<p>Bonjour [client_first_name]</p>', { client_first_name: `${MECHANT}\n\nligne` });
    expect(html).not.toMatch(/<script|<img|<br>/i);
    expect(html).toBe(`<p>Bonjour &lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(2)&gt;\n\nligne</p>`);
  });
});

describe('[A-21] dans l’action « Envoyer un courriel » : ce qui est posé dans le gabarit', () => {
  const contexte = () => {
    const sb = fauxSupabase({
      clients: [{ id: 'c1', org_id: ORG, email: 'marie@exemple.test', email_consent_at: null, sms_consent_at: null, email_opt_out_at: null, deleted_at: null }],
    });
    return { supabase: sb.client, orgId: ORG, entityType: 'client', entityId: 'c1', twilio: null, baseUrl: 'http://t' } as never;
  };
  const VARS = { client_email: 'marie@exemple.test', client_first_name: 'Marie', invoice_number: 'F-1042' };

  it('texte brut à trois paragraphes : le client reçoit trois paragraphes, plus un seul bloc', async () => {
    const r = await executeSendEmail({ subject: 'Rappel', body: TEXTE_BRUT }, VARS, contexte());
    expect(r.success, r.error).toBe(true);
    expect(envois).toHaveLength(1);
    expect(envois[0].html).toContain('<p>Bonjour Marie,</p><p>Votre facture F-1042 est en retard.</p><p>Merci,<br>L’équipe</p>');
  });

  it('corps HTML de l’éditeur : posé tel quel', async () => {
    const r = await executeSendEmail({ subject: 'Rappel', body: '<p>Bonjour [client_first_name],</p><p>Merci</p>' }, VARS, contexte());
    expect(r.success, r.error).toBe(true);
    expect(envois[0].html).toContain('<body><p>Bonjour Marie,</p><p>Merci</p>');
    expect(envois[0].html).not.toContain('<br>');
  });
});
