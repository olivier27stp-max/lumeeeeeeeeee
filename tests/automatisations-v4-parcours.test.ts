// VAGUE 4 — interface des automatisations : la logique du parcours (sans écran).
//
// Chaque bloc `describe` porte un défaut de l'audit V2 (11-interface.md §9).

import { describe, it, expect } from 'vitest';
import { retirerEtape, finDuParcours, type Etape } from '../src/lib/sequenceTypes';

/** Les étapes atteignables depuis la tête (`steps[0]`), comme le moteur les parcourt. */
function atteignables(steps: Etape[]): Set<string> {
  const vues = new Set<string>();
  const file = steps[0] ? [steps[0].id] : [];
  while (file.length) {
    const id = file.shift() as string;
    if (vues.has(id)) continue;
    vues.add(id);
    const e = steps.find((x) => x.id === id);
    if (!e) continue;
    if (e.type === 'si') { if (e.alors) file.push(e.alors); if (e.sinon) file.push(e.sinon); }
    else if (e.type !== 'arreter' && e.suivant) file.push(e.suivant);
  }
  return vues;
}

describe('A-01 — supprimer la PREMIÈRE étape ne rend pas la suite orpheline', () => {
  /*
   * Le cas prouvé par l'audit (s4 C5) : l'ordre du TABLEAU diffère de l'ordre
   * du PARCOURS (une condition insérée après coup est rangée en fin de
   * tableau). Parcours : Alpha → si ; si oui → Delta → Bravo ; si non → Charlie.
   */
  const steps: Etape[] = [
    { id: 'e1', type: 'action', nom: 'Alpha', action: { type: 'send_sms', config: { body: 'a' } }, suivant: 'e3' },
    { id: 'e2', type: 'action', nom: 'Bravo', action: { type: 'send_sms', config: { body: 'b' } }, suivant: null },
    { id: 'e4', type: 'action', nom: 'Charlie', action: { type: 'send_sms', config: { body: 'c' } }, suivant: null },
    { id: 'e5', type: 'action', nom: 'Delta', action: { type: 'send_sms', config: { body: 'd' } }, suivant: 'e2' },
    { id: 'e3', type: 'si', conditions: { total_cents: { gt: 5000 } }, alors: 'e5', sinon: 'e4' },
  ];

  it('la suite de la tête devient la tête, et rien n’est perdu', () => {
    const apres = retirerEtape(steps, 'e1');
    expect(apres.map((e) => e.id)).not.toContain('e1');
    expect(apres[0].id).toBe('e3');
    // Toutes les étapes restantes sont atteignables depuis la nouvelle tête.
    expect([...atteignables(apres)].sort()).toEqual(['e2', 'e3', 'e4', 'e5']);
  });

  it('supprimer une étape du milieu ne change pas la tête', () => {
    const apres = retirerEtape(steps, 'e5');
    expect(apres[0].id).toBe('e1');
    expect([...atteignables(apres)].sort()).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('une tête « attendre la réponse » sans suite principale passe la main à sa branche', () => {
    const s: Etape[] = [
      { id: 'e1', type: 'attendre', delai_secondes: 60, mode: 'reponse', suivant: null, si_reponse: 'e3' },
      { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'y' } }, suivant: null },
      { id: 'e3', type: 'action', action: { type: 'send_sms', config: { body: 'x' } }, suivant: 'e2' },
    ];
    const apres = retirerEtape(s, 'e1');
    expect(apres[0].id).toBe('e3');
    expect([...atteignables(apres)].sort()).toEqual(['e2', 'e3']);
  });
});

describe('A-05 — la fin du parcours se lit sur le graphe, pas sur le tableau', () => {
  const sms = (id: string, suivant: string | null): Etape => ({ id, type: 'action', action: { type: 'send_sms', config: { body: id } }, suivant });
  it('suit la branche « si oui » jusqu’au bout', () => {
    const s: Etape[] = [sms('e1', 'e3'), sms('e2', null), { id: 'e3', type: 'si', conditions: {}, alors: 'e2', sinon: null }];
    expect(finDuParcours(s)).toEqual({ apresId: 'e2' });
  });
  it('une condition sans « si oui » : on s’accroche à sa branche « alors »', () => {
    const s: Etape[] = [sms('e1', 'e2'), { id: 'e2', type: 'si', conditions: {}, alors: null, sinon: null }];
    expect(finDuParcours(s)).toEqual({ apresId: 'e2', branche: 'alors' });
  });
  it('avant un « Arrêter ici », jamais après', () => {
    const s: Etape[] = [sms('e1', 'e2'), { id: 'e2', type: 'arreter' }];
    expect(finDuParcours(s)).toEqual({ apresId: 'e1' });
  });
  it('parcours vide : en tête', () => {
    expect(finDuParcours([])).toEqual({ apresId: null });
  });
});
