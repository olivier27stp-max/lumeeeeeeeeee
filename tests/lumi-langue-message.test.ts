/**
 * Les étages sans modèle répondent dans la langue du message, comme le modèle.
 *
 * Passe de référence du 2026-10-01 : sur un compte en français, « How many
 * invoices are overdue right now? » recevait un article d'aide en français,
 * alors que le modèle, lui, répondait en anglais 40 fois sur 43.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { langueDuMessage } from '../server/lib/lumi/langue-message';
import { reponseFaqPour } from '../server/lib/support/faq';

describe('langueDuMessage', () => {
  it('reconnaît une phrase franche, dans les deux sens', () => {
    for (const q of ['How do I turn a quote into an invoice?', 'What are my jobs for tomorrow?', 'Can you show me the overdue invoices?', 'How many clients do I have?'])
      expect(langueDuMessage(q, 'fr'), q).toBe('en');
    for (const q of ['Comment transformer un devis en facture ?', "C'est quoi mes jobs de demain ?", 'combien de clients ai-je au total', 'Envoie la facture à Tremblay pis dis-moi quand c’est fait'])
      expect(langueDuMessage(q, 'en'), q).toBe('fr');
  });

  it('dans le doute, la langue du compte : un mot, un nom propre, un numéro ne font pas basculer', () => {
    for (const q of ['ok', 'Tremblay', 'facture 12', 'pointe-moi', 'Black Friday Blast', 'job 24', '']) {
      expect(langueDuMessage(q, 'fr'), q).toBe('fr');
      expect(langueDuMessage(q, 'en'), q).toBe('en');
    }
  });

  it('un nom anglais dans une phrase française ne la fait pas passer à l’anglais', () => {
    expect(langueDuMessage('Mets en pause l’automatisation Thank You After Job', 'fr')).toBe('fr');
    expect(langueDuMessage('Ajoute le client John Smith de The Home Depot', 'fr')).toBe('fr');
  });
});

describe('l’aide écrite suit la langue du message', () => {
  it('question en anglais → article en anglais, même si le compte est en français', () => {
    const q = 'How do I turn a quote into an invoice?';
    const r = reponseFaqPour(q, langueDuMessage(q, 'fr'), 'tu');
    expect(r?.id).toBe('quote-to-invoice');
    expect(r?.reponse).toMatch(/^Open the approved quote/);
  });

  it('la route calcule la langue du tour une fois et la passe aux étages sans modèle', () => {
    const r = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');
    expect(r).toContain('const langueTour = langueDuMessage(message, ctx.language);');
    expect(r).toContain('language: langueTour, fuseau: ctx.fuseau,');
    expect(r).toContain("reponseFaqPour(message, langueTour, 'tu')");
  });
});
