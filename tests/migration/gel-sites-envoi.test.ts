// Gel des communications après import : la garde vit dans sendEmail (mailer) et
// sendSmsIfConfigured, mais plusieurs routes appellent Twilio DIRECTEMENT. Le
// 2026-09-24, le SMS de devis, de contrat, de demande de paiement et de la
// messagerie partaient malgré le gel. Ce test énumère chaque site d'envoi SMS
// vers un CLIENT et exige la garde avant `messages.create`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lu = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** fichier → ancre du bloc d'envoi (le texte entre l'ancre et `messages.create` doit contenir la garde). */
const SITES: Array<[string, string]> = [
  ['server/routes/quotes.ts', 'getOrgSmsFromNumber(quote.org_id)'],
  ['server/routes/agreements.ts', 'getOrgSmsFromNumber(agreement.org_id)'],
  ['server/routes/payment-requests.ts', 'getOrgSmsFromNumber(params.orgId)'],
  ['server/routes/messages.ts', 'getOrgSmsFromNumber(orgId)'],
];

describe('gel des communications — envois SMS directs', () => {
  for (const [fichier, ancre] of SITES) {
    it(`${fichier} vérifie destinataireGele avant Twilio`, () => {
      const src = lu(fichier);
      expect(src).toContain("from '../lib/migration/gel-communications'");
      const debut = src.indexOf(ancre);
      expect(debut, `ancre « ${ancre} » introuvable`).toBeGreaterThan(-1);
      const fin = src.indexOf('messages.create(', debut);
      expect(fin, 'messages.create introuvable après l\'ancre').toBeGreaterThan(debut);
      const bloc = src.slice(debut, fin);
      expect(bloc).toContain('destinataireGele(');
      expect(bloc).toContain('MESSAGE_GEL');
    });
  }

  it('les routes HTTP répondent 423 avec le code communications_gelees (même contrat que communications.ts)', () => {
    for (const f of ['server/routes/quotes.ts', 'server/routes/agreements.ts', 'server/routes/messages.ts', 'server/routes/communications.ts']) {
      expect(lu(f), f).toContain("res.status(423).json({ error: MESSAGE_GEL, code: 'communications_gelees' })");
    }
  });

  it('le courriel de devis passe par sendEmail (qui porte la garde)', () => {
    const q = lu('server/routes/quotes.ts');
    expect(q).toContain("import { sendEmail, isMailerConfigured } from '../lib/mailer';");
    expect(lu('server/lib/mailer.ts')).toContain('destinataireGele(getServiceClient(), { email: dest }');
  });
});
