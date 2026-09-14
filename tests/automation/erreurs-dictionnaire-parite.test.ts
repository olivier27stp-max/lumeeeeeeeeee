/**
 * Deux jumeaux à garder identiques (la frontière serveur/client interdit
 * l'import croisé) :
 *
 *   - le dictionnaire des erreurs du moteur, `server/lib/automationErreurs.ts`
 *     et `src/lib/automationErreurs.ts` — même motifs, mêmes phrases ;
 *   - la liste des variables que le serveur remplit (`vars.xxx =` dans
 *     `server/lib/actions/index.ts`) et `VARIABLES_CONNUES` côté éditeur,
 *     qui sert à signaler une variable inconnue avant l'enregistrement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DICTIONNAIRE_ERREURS as SERVEUR, traduireErreurAutomatisation } from '../../server/lib/automationErreurs';
import { DICTIONNAIRE_ERREURS as CLIENT } from '../../src/lib/automationErreurs';
import { VARIABLES_CONNUES, VARIABLES_PROPOSEES, variablesInconnues } from '../../src/lib/emailBodyText';

describe('dictionnaire des erreurs — serveur et client identiques', () => {
  it('mêmes motifs, mêmes phrases, même ordre', () => {
    expect(CLIENT.map((e) => [e.motif.source, e.motif.flags, e.fr])).toEqual(SERVEUR.map((e) => [e.motif.source, e.motif.flags, e.fr]));
  });

  it('les erreurs réelles du moteur ont toutes une traduction (jamais le texte anglais seul)', () => {
    const brutes = [
      'No recipient phone', 'No recipient email', 'SMTP not configured', 'Twilio not configured',
      'Recipient +15145550101 has opted out of SMS (STOP)', 'Recipient a@b.c has unsubscribed from marketing emails',
      'Frequency cap reached for +15145550101 (max 3 commercial messages / 24h) — skipped to avoid spamming',
      'Daily cap reached (100 sms/day for this plan) — deferred to tomorrow', 'Plan does not include SMS',
      'Organization has no SMS number provisioned (x)', 'No marketing consent for this client — commercial message withheld',
      'Review requests are disabled in Settings → Customer reviews.', 'No Google or Facebook review link configured. Set one in Settings → Customer reviews.',
      'A review request was already sent to this client in the last 7 days.', 'send_email timed out after 20s', 'Règle désactivée pendant l’attente',
    ];
    for (const b of brutes) {
      const fr = traduireErreurAutomatisation(b);
      expect(fr, b).not.toMatch(/détail technique/);
      expect(fr).toMatch(/[àéèêç]|client|forfait|envoi/i);
    }
    expect(traduireErreurAutomatisation('ECONNRESET')).toMatch(/^Envoi impossible \(détail technique : ECONNRESET\)/);
    expect(traduireErreurAutomatisation(null)).toBe('Envoi impossible, cause inconnue.');
  });
});

describe('variables connues de l’éditeur = variables fournies par le serveur', () => {
  it('chaque `vars.xxx =` du serveur est dans VARIABLES_CONNUES', () => {
    const src = readFileSync('server/lib/actions/index.ts', 'utf8');
    const serveur = new Set([...src.matchAll(/\bvars\.([a-z_]+)\s*=/g)].map((m) => m[1]));
    // Les trois familles retournées par Object.assign (contrat, contrat signé) :
    for (const v of ['contract_link', 'contract_line', 'contract_html', 'signed_contract_link', 'deposit_amount', 'deposit_line']) serveur.add(v);
    const manquantes = [...serveur].filter((v) => !VARIABLES_CONNUES.has(v));
    expect(manquantes, 'variables serveur absentes de VARIABLES_CONNUES (src/lib/emailBodyText.ts)').toEqual([]);
  });

  it('chaque variable proposée à l’utilisateur est connue', () => {
    expect(VARIABLES_PROPOSEES.filter((v) => !VARIABLES_CONNUES.has(v.cle))).toEqual([]);
  });

  it('variablesInconnues signale ce que le serveur remplacera par du vide', () => {
    expect(variablesInconnues('Bonjour [prenom], votre RDV le [appointment_date] avec [company_name]. [prenom]')).toEqual(['prenom']);
    expect(variablesInconnues('Bonjour [client_first_name]')).toEqual([]);
  });
});
