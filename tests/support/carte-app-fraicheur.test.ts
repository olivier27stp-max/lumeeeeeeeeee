/**
 * Fraîcheur de la carte de l'app (2026-09-17).
 *
 * Lumi répond aux « comment faire » avec les boutons EXACTS de
 * server/lib/support/carte-app.ts. Une page qui change ses libellés sans
 * que la carte suive = Lumi qui décrit une interface qui n'existe plus (PR
 * #415 : pourboires, litiges, rappels de paiement ajoutés, carte muette).
 *
 * Ce test compare l'empreinte des libellés de chaque page à
 * tests/support/carte-app-empreinte.json. Il échoue tant que l'empreinte
 * n'est pas régénérée — et on ne la régénère qu'APRÈS avoir relu la page et
 * mis la carte à jour :
 *
 *   1. ouvrir la page listée, relever les nouveaux boutons / onglets / libellés
 *   2. les écrire dans carte-app.ts (rien qui n'existe pas dans l'interface)
 *   3. npm run carte:empreinte
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { empreintePages, extraireLibelles } from '../../scripts/lib/empreinte-pages.mjs';

const racine = resolve(__dirname, '..', '..');

describe('carte de l app — fraîcheur', () => {
  it('extrait les libellés français écrits en dur, pas le code', () => {
    const src = `<h3>{fr ? 'Paiements en ligne' : 'Online payments'}</h3><button aria-label="Retirer ce rappel">x</button><p>{t.support.title}</p><span>Enregistrer</span><a href="/automations">ok</a>`;
    expect(extraireLibelles(src)).toEqual(['Enregistrer', 'Paiements en ligne', 'Retirer ce rappel']);
  });
  it('chaque page a l empreinte enregistrée (sinon : relire la page, mettre carte-app.ts à jour, puis npm run carte:empreinte)', () => {
    const attendu = JSON.parse(readFileSync(resolve(racine, 'tests', 'support', 'carte-app-empreinte.json'), 'utf8')) as Record<string, string>;
    const actuel = empreintePages(racine);
    const changees = Object.keys(actuel).filter((f) => attendu[f] !== actuel[f]);
    const disparues = Object.keys(attendu).filter((f) => !(f in actuel));
    const message = [
      ...changees.map((f) => `libellés changés : ${f}${attendu[f] ? '' : ' (nouvelle page)'}`),
      ...disparues.map((f) => `page disparue : ${f}`),
    ].join('\n');
    expect(message, `\nLa carte de l'app doit être relue pour :\n${message}\n→ mettre server/lib/support/carte-app.ts à jour, puis \`npm run carte:empreinte\`.\n`).toBe('');
  });
});
