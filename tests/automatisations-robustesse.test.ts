/**
 * PHASE 3 — LA ROBUSTESSE (§6 du mandat d'audit).
 *
 * Le niveau de fiabilité de GoHighLevel, SANS ses défauts. L'audit du
 * 25 septembre 2026 en a relevé trois chez eux, et le mandat demande
 * explicitement de ne pas les reproduire — celui qui compte ici :
 * « nœuds non enregistrés abandonnés silencieusement (perte de travail) ».
 *
 * Ces tests portent sur le CONTRAT, pas l'apparence : un test de style se
 * réécrit à chaque retouche et finit par ne plus rien protéger.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');
const editeur = lire('src/pages/AutomationBuilderPage.tsx');
const canevas = lire('src/components/automations/SequenceCanvas.tsx');

describe('§6.4 — on ne perd JAMAIS son travail en silence', () => {
  it('fermer l’onglet avec des modifications non enregistrées avertit', () => {
    /*
     * Le défaut de GHL, textuellement dans le mandat. Le navigateur affiche
     * son propre message — on ne peut pas le personnaliser, mais on peut
     * refuser de laisser partir sans rien dire.
     */
    expect(editeur).toMatch(/addEventListener\('beforeunload'/);
    expect(editeur, 'seulement quand il y a vraiment du travail en attente')
      .toMatch(/if \(!travailNonEnregistre\) return;/);
  });

  it('quitter l’éditeur demande confirmation', () => {
    expect(editeur).toMatch(/const quitterEditeur = useCallback/);
    expect(editeur).toMatch(/Quitter sans enregistrer/);
  });

  it('les DEUX sorties passent par la confirmation', () => {
    /*
     * L'éditeur a deux boutons « Mes automatisations » (barre du haut et
     * état vide). En oublier un laisserait une porte par laquelle le
     * travail se perd — et c'est exactement le genre d'oubli qui ne se
     * remarque qu'une fois le travail perdu.
     */
    const sorties = editeur.match(/void quitterEditeur\(\)/g) ?? [];
    expect(sorties.length, 'chaque sortie doit être gardée').toBeGreaterThanOrEqual(2);
    expect(editeur, 'aucune sortie directe ne doit subsister')
      .not.toMatch(/onClick=\{\(\) => navigate\('\/automations'\)\}/);
  });

  it('« incomplet » compte comme du travail en attente', () => {
    /*
     * Le cas le plus dangereux : une étape incomplète EMPÊCHE
     * l'enregistrement. On croit son parcours sauvé alors que rien n'est
     * parti. Ne garder que `modifie` laisserait filer précisément ça.
     */
    expect(editeur).toMatch(/etatSauvegarde === 'modifie' \|\| etatSauvegarde === 'incomplet'/);
  });
});

describe('§6.5 — les nœuds en erreur se voient SUR le canevas', () => {
  it('le canevas reçoit les étapes fautives', () => {
    expect(canevas).toMatch(/etapesEnErreur\?: Set<string>/);
    expect(editeur).toMatch(/etapesEnErreur=\{etapesEnErreur\}/);
  });

  it('une carte fautive porte une bordure d’erreur', () => {
    expect(canevas).toMatch(/enErreur\s*\n?\s*\?\s*'border-danger/);
  });

  it('l’erreur PRIME sur la sélection', () => {
    // Une carte fautive doit se voir même quand une autre est ouverte,
    // sinon on la perd de vue au moment précis où on la cherche.
    const i = canevas.indexOf('const bordure = enErreur');
    expect(i, 'la bordure est calculée hors du JSX').toBeGreaterThan(-1);
    const bloc = canevas.slice(i, i + 220);
    expect(bloc.indexOf('border-danger'), 'l’erreur passe avant la sélection')
      .toBeLessThan(bloc.indexOf('border-accent'));
  });

  it('la bordure est calculée HORS du JSX', () => {
    /*
     * Leçon payée le 2026-09-25 : le détecteur d'accessibilité lit les
     * balises au caractère près et NE SAUTE PAS les commentaires. Un
     * commentaire dans un attribut lui fait avaler la balise entière et
     * signaler un faux « div cliquable ». Le cliquet passait de 0 à 1 sans
     * qu'aucun div ne soit réellement en cause.
     */
    expect(canevas).toMatch(/className=\{cn\(\s*\n\s*'relative w-\[260px\][^']*',\s*\n\s*bordure,/);
  });
});

describe('§6.3 — publier n’est pas collé à une action destructrice', () => {
  it('l’éditeur ne porte AUCUNE suppression', () => {
    /*
     * Le piège relevé chez GHL : « Publish workflow » juste au-dessus de
     * « Delete workflow » — l'auditeur a failli publier son workflow de
     * test par erreur. Chez nous la suppression vit dans la LISTE, pas
     * dans l'éditeur : le piège ne peut pas exister. Ce test le maintient.
     */
    expect(editeur).not.toMatch(/supprimerAutomatisation/);
  });
});
