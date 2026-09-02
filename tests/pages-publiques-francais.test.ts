import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Les pages publiques parlent la langue du client.
 *
 * Ce sont les écrans que les clients reçoivent par lien : devis, contrat,
 * portail, paiement, invitation. Ils s'affichent bien en français — sauf les
 * messages d'erreur, qui remontaient bruts du serveur, en anglais.
 *
 * Trouvé le 2026-09-01 en simulant un navigateur francophone :
 *     « Erreur d'invitation — Invitation not found. »
 *     « Paiement indisponible — Too many requests. Please try again later. »
 *
 * Un titre traduit suivi d'un message anglais donne une impression de travail
 * inachevé, sur les pages justement les plus vues de l'extérieur.
 */

const RACINE = process.cwd();
const lire = (p: string) => fs.readFileSync(path.join(RACINE, p), 'utf8');

describe('la page d\u2019invitation traduit les erreurs du serveur', () => {
  const source = lire('src/pages/AcceptInvitation.tsx');

  it('elle passe par un traducteur de messages', () => {
    expect(source).toContain('const messageLisible =');
    expect(source).toContain('messageLisible(err?.message');
  });

  it('elle n\u2019affiche plus le message brut en priorité', () => {
    // `err.message || repli` faisait toujours gagner l'anglais du serveur.
    expect(source).not.toContain("setErrorMessage(err.message || (isFr");
  });

  it('les cas courants sont couverts', () => {
    for (const cas of ['not found', 'expired', 'invalid', 'too many requests']) {
      expect(source).toContain(cas);
    }
  });
});

describe('la page de paiement traduit les erreurs du serveur', () => {
  const source = lire('src/pages/PublicPayment.tsx');

  it('elle passe par un traducteur de messages', () => {
    expect(source).toContain('function messageLisible');
    expect(source).toContain('messageLisible(err?.message, isFr');
  });

  it('elle couvre le cas d\u2019une facture déjà payée', () => {
    // Un client qui repaie par mégarde doit comprendre pourquoi c'est refusé.
    expect(source).toContain('already paid');
    expect(source).toContain('déjà été payée');
  });

  it('en anglais, le message d\u2019origine est conservé', () => {
    expect(source).toContain('if (!isFr) return String(brut);');
  });
});
