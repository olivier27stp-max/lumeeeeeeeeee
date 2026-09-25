// La page Demandes doit tenir compte de PLUSIEURS formulaires.
//
// CE QUE CES TESTS PROTÈGENT. Depuis #617/#638, une organisation peut avoir
// un formulaire pour le site, un pour les publicités, un pour le terrain.
// La page Demandes, elle, n'en chargeait qu'UN — le plus ancien :
//
//   · les réponses venues d'un autre formulaire affichaient leur clé brute
//     (`champ_3f2a…`) au lieu du libellé, parce que celui-ci vit dans un
//     formulaire que la page n'avait pas lu ;
//   · rien ne menait aux réglages une fois la première demande reçue : le
//     lien n'existait que dans les états vides.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const page = () => fs.readFileSync('src/pages/Requests.tsx', 'utf8');

describe('la page Demandes lit TOUS les formulaires', () => {
  it('appelle la lecture au pluriel', () => {
    const s = page();
    expect(s).toContain('fetchRequestForms');
    // L'ancienne lecture au singulier ne doit pas rester : elle ramènerait
    // le plus ancien et on retomberait dans le défaut.
    expect(s).not.toMatch(/fetchRequestForm\s*\(/);
  });

  it('garde la liste en état', () => {
    expect(page()).toContain('const [formulaires, setFormulaires]');
  });
});

describe('les libellés des réponses', () => {
  it('sont cherchés dans tous les formulaires, pas seulement le premier', () => {
    const s = page();
    const bloc = s.slice(s.indexOf('const labelFor ='), s.indexOf('const archivedCount'));
    expect(bloc).toContain('for (const f of formulaires');
    // Le repli garde le comportement d'avant si la liste est vide.
    expect(bloc).toContain('form ? [form] : []');
  });

  it('retombe sur la clé quand aucun formulaire ne la connaît', () => {
    // Afficher la clé brute vaut mieux qu'afficher du vide : au moins on
    // voit qu'une réponse existe.
    const bloc = page();
    expect(bloc).toContain('return key;');
  });
});

describe('accéder aux formulaires depuis la page', () => {
  it("l'en-tête porte un lien permanent vers les réglages", () => {
    // Avant, le lien n'existait QUE dans les états vides : dès la première
    // demande reçue, plus rien ne menait au réglage des formulaires.
    const s = page();
    const entete = s.slice(s.indexOf('{/* Header */}'), s.indexOf('{/* States */}'));
    expect(entete).toContain('/settings/request-form');
    expect(entete).toMatch(/Mes formulaires/);
  });

  it('le lien du formulaire est nommé quand il y en a plusieurs', () => {
    // Un lien nu ne dit pas lequel on s'apprête à partager.
    expect(page()).toContain('formulaires.length > 1 && form');
  });
});
