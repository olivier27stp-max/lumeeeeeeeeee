/**
 * LE MÊME OBJET, LE MÊME NOM — dans la liste ET dans l'éditeur.
 *
 * Les préréglages sont semés en base avec un nom ANGLAIS
 * (« Appointment Confirmation ») : mesuré le 2026-09-25, 275 des 500
 * règles actives en portent un.
 *
 * La liste les traduisait à l'affichage, mais la table vivait dans le
 * fichier de la page — l'éditeur n'y avait pas accès. On cliquait donc
 * sur « Confirmation de rendez-vous » et l'éditeur s'ouvrait sur
 * « Appointment Confirmation ».
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { localizeAutomationName, AUTOMATION_NAME_FR } from '../src/lib/automationNames';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

describe('le nom affiché', () => {
  it('traduit un préréglage anglais quand la langue est le français', () => {
    expect(localizeAutomationName('Appointment Confirmation', 'fr'))
      .toBe('Confirmation de rendez-vous');
  });

  it('laisse le nom tel quel en anglais', () => {
    expect(localizeAutomationName('Appointment Confirmation', 'en'))
      .toBe('Appointment Confirmation');
  });

  it('ne touche pas au nom qu’une entreprise s’est donné', () => {
    /*
     * La table ne connaît que les libellés d'origine : un préréglage
     * renommé par son propriétaire garde son nom à lui. C'est ce qui
     * rend sûr de traduire à l'affichage ET d'enregistrer ce qui est
     * affiché — le champ de l'éditeur est modifiable.
     */
    expect(localizeAutomationName('Ma relance à moi', 'fr')).toBe('Ma relance à moi');
  });

  it('couvre les préréglages semés, pas trois cas isolés', () => {
    // 64 libellés au 2026-09-25. Une BAISSE voudrait dire qu'on en a
    // perdu en déplaçant la table.
    expect(Object.keys(AUTOMATION_NAME_FR).length).toBeGreaterThanOrEqual(60);
  });
});

describe('la liste et l’éditeur disent la même chose', () => {
  it('les DEUX écrans passent par la même table', () => {
    /*
     * C'est le cœur du défaut : la table était privée à la page liste.
     * Si l'un des deux cesse de l'utiliser, les noms divergent à nouveau
     * sans que rien ne casse — le genre de régression qu'on ne voit
     * qu'en cliquant.
     */
    for (const f of ['src/pages/Automations.tsx', 'src/pages/AutomationBuilderPage.tsx']) {
      expect(lire(f), `${f} doit traduire le nom affiché`)
        .toMatch(/localizeAutomationName/);
    }
  });

  it('la table ne vit plus dans un fichier de page', () => {
    // Sinon on retomberait dans le même piège : un écran y accède, pas
    // l'autre.
    expect(lire('src/pages/Automations.tsx'))
      .not.toMatch(/const AUTOMATION_NAME_FR/);
  });
});
