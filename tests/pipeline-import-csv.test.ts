/**
 * L'analyse d'un CSV de deals.
 *
 * Un import qui refuse le fichier fait perdre plus de temps que la saisie
 * manuelle : ces tests couvrent ce que les PME envoient VRAIMENT — un export
 * Excel francophone en point-virgule avec BOM, un export Jobber en anglais,
 * un fichier tapé à la main avec « Tél » et des virgules dans les adresses.
 */
import { describe, it, expect } from 'vitest';
import { analyserCsv, decouperLigne, devinerSeparateur } from '../src/lib/pipeline/importCsv';

describe('découpage des lignes', () => {
  it('respecte les guillemets autour des virgules', () => {
    // Une adresse contient presque toujours une virgule : un split() nu
    // décale toutes les colonnes suivantes.
    expect(decouperLigne('Jean,"123 rue Principale, Laval",514-555-0100', ','))
      .toEqual(['Jean', '123 rue Principale, Laval', '514-555-0100']);
  });

  it('rend un guillemet doublé comme un guillemet littéral', () => {
    expect(decouperLigne('a,"il a dit ""oui""",b', ','))
      .toEqual(['a', 'il a dit "oui"', 'b']);
  });

  it('garde les champs vides à leur place', () => {
    expect(decouperLigne('Jean,,514-555-0100', ',')).toEqual(['Jean', '', '514-555-0100']);
  });
});

describe('détection du séparateur', () => {
  it('reconnaît le point-virgule d’Excel francophone', () => {
    // C'est ce que reçoit la moitié des PME québécoises.
    expect(devinerSeparateur('Prénom;Nom;Courriel')).toBe(';');
  });

  it('reconnaît la virgule', () => {
    expect(devinerSeparateur('First name,Last name,Email')).toBe(',');
  });

  it('reconnaît la tabulation d’un copier-coller de tableur', () => {
    expect(devinerSeparateur('Prénom\tNom\tCourriel')).toBe('\t');
  });
});

describe('analyse du fichier', () => {
  it('lit un export Lume en français, point-virgule et BOM', () => {
    const csv = '﻿Client;Courriel;Téléphone;Adresse\n'
      + 'Jean Tremblay;jean@ex.com;514-555-0100;"123 rue Principale, Laval"';
    const a = analyserCsv(csv);

    expect(a.erreur).toBeNull();
    expect(a.lignes).toHaveLength(1);
    // Un seul champ « Client » : premier mot = prénom, le reste = nom.
    expect(a.lignes[0].prenom).toBe('Jean');
    expect(a.lignes[0].nom).toBe('Tremblay');
    expect(a.lignes[0].adresse).toBe('123 rue Principale, Laval');
    expect(a.lignes[0].probleme).toBe('');
  });

  it('lit un export anglais en virgule', () => {
    const csv = 'First name,Last name,Email,Phone\nJohn,Smith,j@ex.com,5145550100';
    const a = analyserCsv(csv);
    expect(a.lignes[0]).toMatchObject({ prenom: 'John', nom: 'Smith', probleme: '' });
  });

  it('accepte « Tél » et « Cellulaire » comme téléphone', () => {
    const csv = 'Prénom;Tél\nMarie;438-555-0143';
    expect(analyserCsv(csv).lignes[0].telephone).toBe('438-555-0143');
    const csv2 = 'Prénom;Cellulaire\nMarie;438-555-0143';
    expect(analyserCsv(csv2).lignes[0].telephone).toBe('438-555-0143');
  });

  it('signale une ligne sans aucun moyen de joindre la personne', () => {
    // Marquée, pas ignorée en silence : l'utilisateur doit savoir que
    // celle-là ne partira pas, et pourquoi.
    const csv = 'Prénom;Nom;Courriel\nJean;Tremblay;';
    expect(analyserCsv(csv).lignes[0].probleme).toBe('sans_contact');
  });

  it('signale une ligne sans nom', () => {
    const csv = 'Prénom;Courriel\n;jean@ex.com';
    expect(analyserCsv(csv).lignes[0].probleme).toBe('sans_nom');
  });

  it('numérote les lignes comme le tableur les affiche', () => {
    const csv = 'Prénom;Courriel\nA;a@ex.com\nB;b@ex.com';
    // L'en-tête est la ligne 1 : la première donnée est donc la 2.
    expect(analyserCsv(csv).lignes.map((l) => l.ligne)).toEqual([2, 3]);
  });

  it('liste les colonnes qu’il n’a pas su relier', () => {
    const csv = 'Prénom;Courriel;Note interne;Score\nJean;j@ex.com;bla;5';
    const a = analyserCsv(csv);
    expect(a.colonnesIgnorees).toEqual(['Note interne', 'Score']);
    // Mais la ligne passe quand même : une colonne inconnue n'est pas une
    // erreur, juste une information qu'on ne sait pas où mettre.
    expect(a.lignes[0].probleme).toBe('');
  });

  it('refuse un fichier dont aucune colonne n’est reconnue', () => {
    const a = analyserCsv('Colonne A;Colonne B\n1;2');
    expect(a.erreur).toBe('aucune_colonne_reconnue');
    expect(a.lignes).toHaveLength(0);
  });

  it('refuse un fichier vide ou sans données', () => {
    expect(analyserCsv('').erreur).toBe('fichier_vide');
    expect(analyserCsv('Prénom;Courriel').erreur).toBe('aucune_donnee');
  });

  it('ignore les lignes vides du bas de fichier', () => {
    // Excel en ajoute presque toujours une.
    const csv = 'Prénom;Courriel\nJean;j@ex.com\n\n\n';
    expect(analyserCsv(csv).lignes).toHaveLength(1);
  });
});
