/**
 * Les valeurs d'EXEMPLE montrées dans les aperçus ne portent jamais le nom d'une vraie
 * entreprise cliente.
 *
 * Vu le 2026-10-01 (tournée d'interface) : dans l'aperçu réel d'un courriel,
 * `[company_name]` devenait « Coquin lavage » pour TOUS les bureaux — le nom d'un vrai
 * client de Lume, écrit en dur comme exemple dans `src/lib/variablesCourriel.ts`.
 */
import { describe, it, expect } from 'vitest';
import { VARIABLES_PAR_TYPE } from '../../src/lib/variablesCourriel';

/** Les entreprises clientes réelles connues à ce jour (elles ne servent jamais d'exemple). */
const VRAIS_CLIENTS = [/coquin\s*lavage/i, /vision\s*lavage/i];

describe('exemples des variables de courriel', () => {
  it('aucun exemple ne cite une vraie entreprise cliente', () => {
    const fautifs: string[] = [];
    for (const [type, variables] of Object.entries(VARIABLES_PAR_TYPE)) {
      for (const v of variables) {
        for (const texte of [v.exemple.fr, v.exemple.en, v.fr, v.en]) {
          if (VRAIS_CLIENTS.some((re) => re.test(texte))) fautifs.push(`${type}.${v.cle} : « ${texte} »`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('l’exemple de [company_name] est neutre dans les deux langues', () => {
    const societe = Object.values(VARIABLES_PAR_TYPE).flat().filter((v) => v.cle === 'company_name');
    expect(societe.length).toBeGreaterThan(0);
    for (const v of societe) {
      expect(v.exemple.fr).toBe('Votre entreprise');
      expect(v.exemple.en).toBe('Your company');
    }
  });
});
