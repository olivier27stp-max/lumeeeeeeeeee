/**
 * Les variables proposées existent vraiment (2026-09-23).
 *
 * Trois sources doivent s'accorder, et rien ne les croisait :
 *   1. le SERVEUR, qui passe un objet à `texteDuCourriel` ;
 *   2. `variablesCourriel.ts`, qui décide de ce que l'éditeur propose ;
 *   3. le CATALOGUE, dont les objets par défaut citent des variables.
 *
 * Quand elles divergent, c'est le client qui le voit. Le cas trouvé :
 * l'objet par défaut du contrat est « Contrat [contract_number] — à signer »,
 * et `variablesPour('contract_sent')` ne connaissait pas cette clé — le type
 * manquait simplement de la table. L'aperçu ne la remplaçait donc pas par son
 * exemple, et on validait un objet à trou.
 *
 * Statique : ni base, ni réseau.
 */
import { describe, it, expect } from 'vitest';
import { CATALOGUE_COURRIELS } from '../../src/lib/catalogueCourriels';
import { variablesPour, remplacerParExemples } from '../../src/lib/variablesCourriel';

describe('variables des modèles de courriel', () => {
  it('chaque variable citée par le catalogue est proposée par l’éditeur', () => {
    const manquantes: string[] = [];
    for (const groupe of CATALOGUE_COURRIELS) {
      for (const entree of groupe.entrees) {
        if (!entree.type) continue;
        const connues = new Set(variablesPour(entree.type).map((v) => v.cle));
        const textes = [
          entree.objetOrigine?.fr, entree.objetOrigine?.en,
          entree.texteOrigine?.fr, entree.texteOrigine?.en,
        ];
        for (const texte of textes) {
          for (const m of String(texte || '').matchAll(/\[(\w+)\]/g)) {
            if (!connues.has(m[1])) manquantes.push(`${entree.type} : [${m[1]}]`);
          }
        }
      }
    }
    // Un message qui dit quoi ajouter, pas seulement que ça a échoué.
    expect(manquantes.join('\n')).toBe('');
  });

  it('l’aperçu ne laisse aucun crochet visible pour un poste connu', () => {
    /* Ce que le propriétaire regarde avant d'envoyer. Un crochet qui survit
       ici survivra dans la boîte du client. */
    for (const groupe of CATALOGUE_COURRIELS) {
      for (const entree of groupe.entrees) {
        if (!entree.type) continue;
        for (const fr of [true, false]) {
          const objet = entree.objetOrigine?.[fr ? 'fr' : 'en'] ?? '';
          const rendu = remplacerParExemples(objet, entree.type, fr);
          expect(rendu, `${entree.type} (${fr ? 'fr' : 'en'})`).not.toMatch(/\[\w+\]/);
        }
      }
    }
  });
});
