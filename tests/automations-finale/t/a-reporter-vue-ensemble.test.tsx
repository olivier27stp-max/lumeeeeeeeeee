// @vitest-environment jsdom
/**
 * REPORTÉ — `src/pages/AutomationsApercu.tsx` (agent des statistiques et journaux).
 *
 * Triage « modèles », fichier `05-vue-ensemble` :
 *   · :155 — la tuile des déclenchements dit 1 quand la liste dit 1 + 1 ;
 *   · :209 — activité illisible : « 0 » et une courbe à plat, comme s'il ne
 *            s'était rien passé ;
 *   · :173 — « 1 envoi(s) ont échoué » pour UNE tâche en échec.
 *
 * Écrit ROUGE par l'agent T contre l'ancienne page, qui lisait la table des
 * journaux depuis le navigateur (`activiteParSemaine`) ; le patch proposé
 * (`D:/lume-final/notes/T-a-reporter/AutomationsApercu-et-automationJournauxApi.patch`)
 * ne s'applique plus : `activiteParSemaine` n'existe plus.
 *
 * RÉÉCRIT au report par l'agent S (2026-10-02), mêmes intentions, sur la lecture
 * d'aujourd'hui : la Vue d'ensemble lit TOUS ses chiffres par la route
 * `GET /api/automations/rules/stats` (`chargerStatistiquesBureau`), comptés en
 * base par une seule définition — la même que la liste.
 *   · :155 — le dédoublonnage ne se fait plus dans le navigateur : il est en SQL
 *     (`automation_statistiques`), prouvé contre la vraie base par
 *     `tests/automations-finale/d/integration/10-jeu-connu` ([D-06], [D-09]) et
 *     `12-nouveau-format` ; à l'écran, `ui/20::[D-09]` (tuile = somme de la colonne
 *     de la liste = somme des barres). Ici : la tuile affiche ce que la route compte.
 *   · :209 et :173 — l'écran, sur la vraie page.
 */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const route = vi.hoisted(() => ({ lire: vi.fn() }));
vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../src/components/PermissionGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../src/components/automations/SousNavigation', () => ({ default: () => null }));
vi.mock('../../../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: (c: string) => c }) }));
// La route des chiffres : ce que la base a compté (la forme exacte de la réponse).
vi.mock('../../../src/lib/automationStatsApi', () => ({
  chargerStatistiquesBureau: (jours: number) => route.lire(jours),
  lirePeriodeChoisie: () => 7,
  retenirPeriode: () => undefined,
}));

import { remettre } from './faux-supabase';
import { monter, demonter, jusqua, texteEcran } from './banc-composants';
import { versStatistiques } from '../../aides/stats-automatisations';
import AutomationsApercu from '../../../src/pages/AutomationsApercu';

const regle = (id: string) => ({ id, org_id: 'org-1', name: id, is_active: true, deleted_at: null, purged_at: null, actions: [], steps: null });
const echec = (ruleId: string, erreur: string) => ({ automation_rule_id: ruleId, action_type: 'create_task', result_error: erreur });

/** La valeur d'une tuile, par son libellé. */
function tuile(libelle: string): string {
  const p = Array.from(document.body.querySelectorAll('p')).find((x) => x.textContent === libelle);
  return p?.nextElementSibling?.textContent ?? '';
}
async function ouvrir() {
  await monter(<MemoryRouter><AutomationsApercu /></MemoryRouter>);
  await jusqua(() => texteEcran().includes('Déclenchées'));
}

beforeEach(() => { route.lire.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(async () => { await demonter(); vi.restoreAllMocks(); });

describe('05-vue-ensemble:155 — la tuile des déclenchements est la somme de la liste', () => {
  it('deux automatisations déclenchées par le MÊME prospect le même jour : 2, pas 1', async () => {
    remettre({ automation_rules: [regle('bienvenue'), regle('suivi')] });
    route.lire.mockResolvedValue(versStatistiques({ par_regle: { bienvenue: { declenches: 1, envoyes: 1 }, suivi: { declenches: 1, envoyes: 1 } } }));
    await ouvrir();
    await jusqua(() => tuile('Déclenchées') !== '');
    expect(tuile('Déclenchées')).toBe('2');
  });

  it('une automatisation qui fait TROIS actions pour un prospect ne compte toujours qu’une fois', async () => {
    remettre({ automation_rules: [regle('bienvenue')] });
    // Ce que la base rend pour ce cas : une fiche entrée, deux messages partis (le troisième geste est interne).
    route.lire.mockResolvedValue(versStatistiques({ par_regle: { bienvenue: { declenches: 1, envoyes: 2 } } }));
    await ouvrir();
    await jusqua(() => tuile('Déclenchées') !== '');
    expect(tuile('Déclenchées')).toBe('1');
    expect(tuile('Envoyées')).toBe('2');
  });
});

describe('05-vue-ensemble:209 — activité illisible : l’écran le dit', () => {
  it('la tuile montre « — » (pas « 0 »), la courbe dit qu’elle n’a pas pu être lue, et la panne est journalisée UNE fois', async () => {
    remettre({ automation_rules: [regle('bienvenue')] });
    route.lire.mockRejectedValue(new Error('panne simulée'));
    await ouvrir();
    await jusqua(() => /n’ont pas pu être lus/.test(texteEcran()));
    expect(tuile('Déclenchées')).toBe('—');
    expect(texteEcran()).not.toContain('Déclenchées : 0');
    expect(texteEcran()).toMatch(/déclenchements n’ont pas pu être lus pour le moment\. Réessayez dans un instant\./i);
    expect(vi.mocked(console.error).mock.calls.filter((c) => String(c[0]).startsWith('[apercu]')).length).toBe(1);
  });
});

describe('05-vue-ensemble:173 — le résumé des erreurs parle juste', () => {
  it('UNE tâche en échec : un singulier, et pas « envoi »', async () => {
    remettre({ automation_rules: [regle('tache')] });
    route.lire.mockResolvedValue(versStatistiques({}, [echec('tache', 'Aucun responsable')]));
    await ouvrir();
    await jusqua(() => /ces 7 derniers jours\./.test(texteEcran()));
    const phrase = Array.from(document.body.querySelectorAll('p')).find((p) => /ces 7 derniers jours\.$/.test(p.textContent ?? ''))?.textContent ?? '';
    expect(phrase).not.toContain('(s)');
    expect(phrase).not.toContain('envoi');
    expect(phrase).toMatch(/^1 \S+ a échoué/);
  });

  it('trois échecs : un pluriel', async () => {
    remettre({ automation_rules: [regle('tache')] });
    route.lire.mockResolvedValue(versStatistiques({}, [1, 2, 3].map(() => echec('tache', 'refus'))));
    await ouvrir();
    await jusqua(() => /ces 7 derniers jours\./.test(texteEcran()));
    expect(texteEcran()).toMatch(/3 \S+ ont échoué ces 7 derniers jours\./);
    expect(texteEcran()).not.toContain('(s)');
  });
});
