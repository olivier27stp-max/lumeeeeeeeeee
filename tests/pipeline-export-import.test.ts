// Export CSV → import CSV : l'aller-retour tient-il ?
//
// Ce que ces tests protègent : on exporte un pipeline, on rouvre le fichier
// dans Excel, on le réimporte. Si l'analyseur ne relit pas ce que l'export a
// écrit, on perd des lignes en silence — et personne ne s'en aperçoit avant
// de compter les cartes.
//
// Les pièges réels : le BOM UTF-8 qu'Excel exige, le point-virgule comme
// séparateur (locale FR), les virgules DANS une adresse, et les guillemets
// doublés de la RFC 4180.
import { describe, it, expect } from 'vitest';
import { analyserCsv, decouperLigne, devinerSeparateur } from '../src/lib/pipeline/importCsv';

/** Reproduit exactement ce que `telechargerCsv` écrit dans le fichier. */
function champCsv(valeur: string): string {
  if (!/[";\r\n]/.test(valeur)) return valeur;
  return `"${valeur.replace(/"/g, '""')}"`;
}
function ecrireCsv(lignes: string[][]): string {
  // Le BOM est ajouté par l'export : sans lui Excel lit les accents en Latin-1.
  return `﻿${lignes.map((l) => l.map(champCsv).join(';')).join('\r\n')}`;
}

describe('découpage d une ligne', () => {
  it('garde une virgule à l intérieur d un champ entre guillemets', () => {
    // « 12 rue des Lilas, Québec » est UNE adresse, pas deux colonnes.
    expect(decouperLigne('Jean;"12 rue des Lilas, Québec";418', ';'))
      .toEqual(['Jean', '12 rue des Lilas, Québec', '418']);
  });

  it('rend un guillemet doublé comme un seul (RFC 4180)', () => {
    expect(decouperLigne('a;"il a dit ""oui""";b', ';'))
      .toEqual(['a', 'il a dit "oui"', 'b']);
  });

  it('garde les champs vides', () => {
    expect(decouperLigne('a;;c', ';')).toEqual(['a', '', 'c']);
  });
});

describe('séparateur', () => {
  it('reconnaît le point-virgule d Excel francophone', () => {
    expect(devinerSeparateur('Client;Courriel;Téléphone')).toBe(';');
  });

  it('reconnaît la virgule', () => {
    expect(devinerSeparateur('Client,Courriel,Téléphone')).toBe(',');
  });
});

describe('aller-retour export → import', () => {
  it('relit un fichier écrit par notre propre export', () => {
    // Les colonnes de l'export réel, avec une adresse à virgule et un nom
    // à apostrophe — les deux cas qui cassent un analyseur naïf.
    const csv = ecrireCsv([
      ['Client', 'Courriel', 'Téléphone', 'Adresse'],
      ['Alice Alpha', 'alice@a.ca', '418 555-0001', '1 rue A, Québec'],
      ["Bob O'Bravo", 'bob@b.ca', '(514) 555-0199', '2 rue B, Lévis'],
      ['Carl Charlie', 'carl@c.ca', '4185550003', '3 rue C'],
    ]);

    const a = analyserCsv(csv);
    expect(a.erreur).toBeNull();

    const bonnes = a.lignes.filter((l) => l.probleme === '');
    expect(bonnes).toHaveLength(3);

    // Le BOM ne doit pas se retrouver collé au premier prénom.
    expect(bonnes[0].prenom.startsWith('﻿')).toBe(false);
    expect(`${bonnes[0].prenom} ${bonnes[0].nom}`.trim()).toBe('Alice Alpha');
    expect(bonnes[0].courriel).toBe('alice@a.ca');
    expect(bonnes[0].adresse).toBe('1 rue A, Québec');

    // L'apostrophe survit.
    expect(`${bonnes[1].prenom} ${bonnes[1].nom}`.trim()).toBe("Bob O'Bravo");
    expect(bonnes[1].adresse).toBe('2 rue B, Lévis');
  });

  it('accepte les en-têtes anglais', () => {
    const a = analyserCsv('Name,Email,Phone\nJohn Smith,john@x.ca,4185550000');
    expect(a.erreur).toBeNull();
    expect(a.lignes.filter((l) => l.probleme === '')).toHaveLength(1);
  });

  it('écarte une ligne sans courriel NI téléphone, sans jeter le fichier', () => {
    // Un contact qu'on ne peut pas joindre n'est pas un lead — mais les
    // autres lignes doivent quand même passer.
    const a = analyserCsv('Nom;Courriel;Téléphone\nBon;bon@x.ca;418\nOrphelin;;');
    expect(a.erreur).toBeNull();
    const bonnes = a.lignes.filter((l) => l.probleme === '');
    const mauvaises = a.lignes.filter((l) => l.probleme !== '');
    expect(bonnes).toHaveLength(1);
    expect(mauvaises).toHaveLength(1);
    // La ligne fautive est désignée par son numéro, pour être retrouvée.
    expect(mauvaises[0].ligne).toBeGreaterThan(1);
  });

  it('refuse un fichier sans colonne reconnaissable plutôt que d inventer', () => {
    const a = analyserCsv('Colonne1;Colonne2\nx;y');
    expect(a.erreur).not.toBeNull();
  });

  it('signale un fichier qui n a que son en-tête', () => {
    const a = analyserCsv('Nom;Courriel;Téléphone');
    expect(a.erreur).toBe('aucune_donnee');
  });

  it('un fichier vide est refusé', () => {
    expect(analyserCsv('').erreur).toBe('fichier_vide');
  });
});
