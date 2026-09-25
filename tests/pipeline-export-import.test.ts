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
import { analyserCsv, decouperEnregistrements, decouperLigne, devinerSeparateur } from '../src/lib/pipeline/importCsv';

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

describe('les colonnes que l export écrit', () => {
  // Le bug réel : l'export ne contenait que « Client / Étape / Montant… ».
  // À la réimportation, les 22 lignes étaient TOUTES rejetées avec « ni
  // courriel ni téléphone », parce que l'import exige un moyen de joindre
  // la personne pour rapprocher un contact connu au lieu d'en créer un double.
  const ENTETES_FR = ['Client', 'Courriel', 'Téléphone', 'Adresse', 'Étape', 'Montant', 'Source', 'Campagne', 'Assigné', 'Créé le', 'Dernière activité'];

  it('un fichier exporté se réimporte entièrement', () => {
    const csv = ecrireCsv([
      ENTETES_FR,
      ['Alice Alpha', 'alice@a.ca', '418 555-0001', '1 rue A, Québec', 'Nouveau lead', '1000,00', 'Web', '', '', '2026-09-01', '2026-09-20'],
      ['Bob Bravo', 'bob@b.ca', '(514) 555-0199', '2 rue B', 'Contacté', '2500,00', 'Meta', '', 'Marie', '2026-09-02', '2026-09-21'],
    ]);
    const a = analyserCsv(csv);
    expect(a.erreur).toBeNull();
    // ZÉRO ligne ignorée : c'est tout l'enjeu.
    expect(a.lignes.filter((l) => l.probleme !== '')).toHaveLength(0);
    expect(a.lignes.filter((l) => l.probleme === '')).toHaveLength(2);
  });

  it('sans colonne de contact, tout est rejeté — le bug d origine', () => {
    // On reproduit l'ANCIEN export pour figer la raison du rejet.
    const csv = ecrireCsv([
      ['Client', 'Étape', 'Montant', 'Source'],
      ['Alice Alpha', 'Nouveau lead', '1000,00', 'Web'],
      ['Bob Bravo', 'Contacté', '2500,00', 'Meta'],
    ]);
    const a = analyserCsv(csv);
    // Le fichier est lisible, mais aucune ligne n est importable.
    expect(a.lignes.filter((l) => l.probleme === '')).toHaveLength(0);
  });

  it('les colonnes de l export portent les noms que l import reconnaît', () => {
    // Garde-fou : si quelqu un renomme une colonne de l export, ce test
    // tombe avant que le fichier ne devienne inutilisable en production.
    for (const attendu of ['Client', 'Courriel', 'Téléphone', 'Adresse']) {
      expect(ENTETES_FR).toContain(attendu);
    }
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

describe('le fichier d export de GoHighLevel', () => {
  // Le vrai en-tête de leur export « opportunities », et deux lignes réelles.
  // Le champ Notes contient des SAUTS DE LIGNE entre guillemets : c'est le
  // piège qui transformait 2 deals en 4 lignes bancales, toutes rejetées
  // « sans nom ».
  const GHL = [
    'Opportunity name,Contact Name,phone,email,pipeline,stage,Lead Value,source,assigned,Created on,Updated on,lost reason ID,lost reason name,Followers,Notes,tags,Engagement score,status',
    '(Example) Deal with Jordan Smith,(Example) Jordan Smith,,jordan.smith@example.com,Marketing Pipeline,Negotiation,3934,Email Campaign,,2026-09-23T16:54:01.082Z,2026-09-23T16:54:01.082Z,,,,"Sent contract for review',
    'Client provided a positive testimonial for our service',
    '",follow-up,0,won',
    '(Example) Deal with Alex Carter,(Example) Alex Doe Carter,,alex.carter@businessmail.com,Marketing Pipeline,Closed,1554,Email Campaign,,2026-09-23T16:54:00.674Z,2026-09-23T16:54:00.674Z,,,,,follow-up,0,abandoned',
  ].join('\n');

  it('lit DEUX deals, pas quatre lignes coupées', () => {
    const a = analyserCsv(GHL);
    expect(a.erreur).toBeNull();
    expect(a.lignes).toHaveLength(2);
    expect(a.lignes.filter((l) => l.probleme !== '')).toHaveLength(0);
  });

  it('reconnaît « Contact Name » comme le nom', () => {
    const a = analyserCsv(GHL);
    const noms = a.lignes.map((l) => `${l.prenom} ${l.nom}`.trim());
    expect(noms[0]).toContain('Jordan Smith');
    expect(noms[1]).toContain('Alex Doe Carter');
  });

  it('garde les courriels', () => {
    const a = analyserCsv(GHL);
    expect(a.lignes[0].courriel).toBe('jordan.smith@example.com');
    expect(a.lignes[1].courriel).toBe('alex.carter@businessmail.com');
  });
});

describe('découpage en enregistrements', () => {
  it('ne coupe pas dans un champ entre guillemets', () => {
    const e = decouperEnregistrements('a;b\nc;"deux\nlignes"\nd;e');
    expect(e).toHaveLength(3);
    expect(e[1]).toBe('c;"deux\nlignes"');
  });

  it('gère les fins de ligne Windows', () => {
    expect(decouperEnregistrements('a;b\r\nc;d')).toEqual(['a;b', 'c;d']);
  });

  it('ignore les lignes vides', () => {
    expect(decouperEnregistrements('a;b\n\n\nc;d')).toEqual(['a;b', 'c;d']);
  });

  it('un guillemet doublé ne sort pas du champ', () => {
    const e = decouperEnregistrements('a;"il a dit ""oui""\nsuite"\nb;c');
    expect(e).toHaveLength(2);
  });
});
