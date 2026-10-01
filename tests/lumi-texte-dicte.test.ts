/**
 * Lu dans les réponses de la passe prod du 2026-10-01 :
 *  - « Texte à Sophie : « Bonjour Sophie… » » → le texto partait AVEC ses guillemets ;
 *  - « Tes 1 meilleurs clients ».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sansGuillemetsEnglobants, nettoyerTexteDicte } from '../server/lib/agent/texte-dicte';

describe('un texte dicté entre guillemets ne part pas avec ses guillemets', () => {
  it('une seule paire qui entoure tout le texte est retirée', () => {
    expect(sansGuillemetsEnglobants('« Bonjour Sophie, on arrive vers 13 h pour le déneigement. »')).toBe('Bonjour Sophie, on arrive vers 13 h pour le déneigement.');
    expect(sansGuillemetsEnglobants('“We will be there at 9.”')).toBe('We will be there at 9.');
    expect(sansGuillemetsEnglobants('"Merci pour votre confiance"')).toBe('Merci pour votre confiance');
  });

  it('un texte qui cite un mot, ou qui contient deux citations, est laissé tel quel', () => {
    for (const t of ['Le client a dit « oui » pour jeudi.', '« Bonjour » et « à bientôt »', 'Bonjour Sophie', "L'équipe arrive à 9 h", '« »'])
      expect(sansGuillemetsEnglobants(t), t).toBe(t);
  });

  it('seuls les champs de texte libre sont touchés, à toute profondeur', () => {
    const args = { client_name: '« Sophie »', message_text: '« Bonjour Sophie. »', reminders: [{ message: '“Rappel amical”', invoice_id: 'ref3' }], subject: '« Passage jeudi »', title: '« Lavage »' };
    expect(nettoyerTexteDicte(args)).toEqual({ client_name: '« Sophie »', message_text: 'Bonjour Sophie.', reminders: [{ message: 'Rappel amical', invoice_id: 'ref3' }], subject: 'Passage jeudi', title: '« Lavage »' });
  });

  it('le même nettoyage sert à la carte (modèle et action directe) et à l’exécution', () => {
    const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
    expect(lire('server/lib/lumi/orchestrateur.ts')).toContain('const args = nettoyerTexteDicte(demasquerIds(espaceRefs,');
    expect(lire('server/lib/lumi/actions-directes.ts')).toContain('const args = nettoyerTexteDicte(brut);');
    expect(lire('server/lib/agent/garde.ts')).toContain('nettoyerTexteDicte(normaliserDatesHeures(validation.args');
  });
});

describe('raccourci « meilleurs clients »', () => {
  it('un seul client se dit au singulier', () => {
    const src = readFileSync(resolve(__dirname, '..', 'server/lib/lumi/raccourcis.ts'), 'utf8');
    expect(src).toContain("lignes.length === 1 ? (fr ? 'Ton meilleur client :' : 'Your top client:')");
  });
});
