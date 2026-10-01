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

describe('recollerDictee : les mots que la dictée coupe en deux', () => {
  it('« sous missions » redevient « soumissions », au singulier comme au pluriel', async () => {
    const { recollerDictee } = await import('../server/lib/agent/texte-dicte');
    expect(recollerDictee('les sous missions acceptées c’est lesquelles')).toBe('les soumissions acceptées c’est lesquelles');
    expect(recollerDictee('envoie la sous mission de Marie')).toBe('envoie la soumission de Marie');
    expect(recollerDictee('Sous missions en attente ?')).toBe('Soumissions en attente ?');
    expect(recollerDictee('la sous-mission 12')).toBe('la soumission 12');
  });

  it('ne touche à rien d’autre', async () => {
    const { recollerDictee } = await import('../server/lib/agent/texte-dicte');
    for (const t of ['mes soumissions en attente', 'sous la mission de demain', 'il est en mission chez Gagnon', 'nous missionnons', 'sous missionnaire']) {
      expect(recollerDictee(t), t).toBe(t);
    }
  });

  it('la route du chat et la transcription s’en servent', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    expect(readFileSync(resolve(__dirname, '../server/routes/lumi.ts'), 'utf8')).toContain('const message = recollerDictee(messageRecu);');
    expect(readFileSync(resolve(__dirname, '../server/routes/agent.ts'), 'utf8')).toContain('recollerDictee(r.text)');
  });
});
