// @vitest-environment jsdom
/**
 * À REPORTER — `src/pages/AutomationsApercu.tsx` et `src/lib/automationJournauxApi.ts`
 * (agent des statistiques et journaux), hors de la zone de l'agent T.
 *
 * Triage « modèles », fichier `05-vue-ensemble` :
 *   · :155 — la tuile « Total des déclenchements » dit 1 quand la liste dit 1 + 1 ;
 *   · :209 — journaux d'activité illisibles : « 0 » et une courbe à plat, comme
 *            s'il ne s'était rien passé ;
 *   · :173 — « 1 envoi(s) ont échoué » pour UNE tâche en échec.
 *
 * Le correctif exact est dans `D:/lume-final/notes/T-corrections.md` (bloc
 * « À REPORTER — AutomationsApercu.tsx / automationJournauxApi.ts »). Ces tests
 * sont ROUGES jusqu'au report. La VRAIE page et la VRAIE lecture
 * (`activiteParSemaine`), sur une fausse base.
 */
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/lib/supabase', async () => (await import('./faux-supabase')).moduleSupabase());
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => 'org-1', getCurrentOrgIdOrThrow: async () => 'org-1' }));
vi.mock('../../../src/components/PermissionGate', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../src/components/automations/SousNavigation', () => ({ default: () => null }));
vi.mock('../../../src/i18n', () => ({ useTranslation: () => ({ language: 'fr', t: (c: string) => c }) }));

import { base, remettre } from './faux-supabase';
import { monter, demonter, jusqua, texteEcran } from './banc-composants';
import AutomationsApercu from '../../../src/pages/AutomationsApercu';

const ilYAUneHeure = () => new Date(Date.now() - 3_600_000).toISOString();
const journal = (sup: Record<string, unknown>) => ({
  id: `j${Math.random()}`, org_id: 'org-1', created_at: ilYAUneHeure(), action_type: 'send_sms',
  trigger_event: 'lead.created', result_success: true, result_error: null, entity_type: 'lead', ...sup,
});
const regle = (id: string) => ({ id, org_id: 'org-1', name: id, is_active: true, deleted_at: null, purged_at: null, actions: [], steps: null });

/** La valeur d'une tuile, par son libellé. */
function tuile(libelle: string): string {
  const p = Array.from(document.body.querySelectorAll('p')).find((x) => x.textContent === libelle);
  return p?.nextElementSibling?.textContent ?? '';
}
async function ouvrir() {
  await monter(<MemoryRouter><AutomationsApercu /></MemoryRouter>);
  await jusqua(() => texteEcran().includes('Total des déclenchements'));
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(async () => { await demonter(); vi.restoreAllMocks(); });

describe('05-vue-ensemble:155 — la tuile « Total des déclenchements » est la somme de la liste', () => {
  it('deux automatisations déclenchées par le MÊME prospect le même jour : 2, pas 1', async () => {
    remettre({
      automation_rules: [regle('bienvenue'), regle('suivi')],
      automation_execution_logs: [
        journal({ automation_rule_id: 'bienvenue', entity_id: 'prospect-1' }),
        journal({ automation_rule_id: 'suivi', entity_id: 'prospect-1' }),
      ],
    });
    await ouvrir();
    expect(tuile('Total des déclenchements')).toBe('2');
  });

  it('une automatisation qui fait TROIS actions pour un prospect ne compte toujours qu’une fois', async () => {
    remettre({
      automation_rules: [regle('bienvenue')],
      automation_execution_logs: ['send_sms', 'send_email', 'create_task'].map((action_type) => journal({ automation_rule_id: 'bienvenue', entity_id: 'prospect-1', action_type })),
    });
    await ouvrir();
    expect(tuile('Total des déclenchements')).toBe('1');
  });
});

describe('05-vue-ensemble:209 — journaux d’activité illisibles : l’écran le dit', () => {
  it('la tuile montre « — » (pas « 0 ») et la courbe dit qu’elle n’a pas pu être lue', async () => {
    remettre({ automation_rules: [regle('bienvenue')] });
    base.erreursLectureParTable.automation_execution_logs = { message: 'panne simulée' };
    await ouvrir();
    expect(tuile('Total des déclenchements')).toBe('—');
    expect(texteEcran()).not.toContain('Déclenchements : 0');
    expect(texteEcran()).toMatch(/déclenchements n’ont pas pu être lus/i);
  });
});

describe('05-vue-ensemble:173 — le résumé des erreurs parle juste', () => {
  it('UNE tâche en échec : un singulier, et pas « envoi »', async () => {
    remettre({
      automation_rules: [regle('tache')],
      automation_execution_logs: [journal({ automation_rule_id: 'tache', entity_id: 'x', action_type: 'create_task', result_success: false, result_error: 'Aucun responsable' })],
    });
    await ouvrir();
    await jusqua(() => /ces 7 derniers jours\./.test(texteEcran()));
    const phrase = Array.from(document.body.querySelectorAll('p')).find((p) => /ces 7 derniers jours\.$/.test(p.textContent ?? ''))?.textContent ?? '';
    expect(phrase).not.toContain('(s)');
    expect(phrase).not.toContain('envoi');
    expect(phrase).toMatch(/^1 \S+ a échoué/);
  });

  it('trois échecs : un pluriel', async () => {
    remettre({
      automation_rules: [regle('tache')],
      automation_execution_logs: [1, 2, 3].map((n) => journal({ automation_rule_id: 'tache', entity_id: `x${n}`, result_success: false, result_error: 'refus' })),
    });
    await ouvrir();
    await jusqua(() => /ces 7 derniers jours\./.test(texteEcran()));
    expect(texteEcran()).toMatch(/3 \S+ ont échoué ces 7 derniers jours\./);
    expect(texteEcran()).not.toContain('(s)');
  });
});
