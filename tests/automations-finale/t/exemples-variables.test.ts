/**
 * 03-texto:438 [MSG-004][MSG-008] — « The client will read » montrait des
 * exemples français (« 14 août 2026 », « 9 h 00 », « Votre entreprise ») au
 * milieu d'un texte anglais. `remplacerVariables(texte, fr)` (src/lib/emailBodyText.ts)
 * rend les exemples dans la langue de celui qui lira.
 */
import { describe, it, expect } from 'vitest';
import { remplacerVariables, VARIABLES_PROPOSEES } from '../../../src/lib/emailBodyText';

describe('03-texto:438 — des exemples anglais pour un lecteur anglophone', () => {
  const TEXTE = 'See you on [appointment_date] at [appointment_time] — [company_name]';

  it('en anglais : ni « août », ni « 9 h 00 », ni « Votre entreprise »', () => {
    expect(remplacerVariables(TEXTE, false)).toBe('See you on August 14, 2026 at 9:00 a.m. — Your company');
  });

  it('en français, et sans préciser la langue : comme avant', () => {
    expect(remplacerVariables(TEXTE, true)).toBe('See you on 14 août 2026 at 9 h 00 — Votre entreprise');
    expect(remplacerVariables(TEXTE)).toBe(remplacerVariables(TEXTE, true));
  });

  it('chaque variable proposée a un exemple dans les DEUX langues ; les trois écritures sont remplacées', () => {
    for (const { cle } of VARIABLES_PROPOSEES) {
      for (const fr of [true, false]) {
        expect(remplacerVariables(`[${cle}]`, fr), `${cle} (${fr ? 'fr' : 'en'})`).not.toContain(cle);
      }
    }
    expect(remplacerVariables('{invoice_total} · {{quote_total}} · [due_date]', false)).toBe('$450.00 · $1,250.00 · August 30, 2026');
  });

  it('une variable inconnue reste telle quelle dans les deux langues', () => {
    expect(remplacerVariables('Bonjour [prenom]', false)).toBe('Bonjour [prenom]');
  });
});
