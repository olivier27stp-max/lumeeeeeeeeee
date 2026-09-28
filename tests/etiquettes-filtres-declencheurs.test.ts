// Étape 6 (volet étiquettes) du plan étiquettes + champs (2026-09-28).
//
// · « Étiquette ajoutée / retirée » : choisir QUELLE étiquette déclenche ;
// · sur chaque déclencheur qui a un client : « seulement si le client a /
//   n'a PAS l'étiquette », jugé sur ses étiquettes RÉELLES ;
// · ces filtres ne sont jamais comparés aux métadonnées de l'événement
//   (sinon la règle ne partirait jamais).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../server/lib/eventBus', () => ({ eventBus: { emit: vi.fn(), onAnyEvent: vi.fn() } }));

import { DECLENCHEURS, CLES_CONDITIONS_ETIQUETTES } from '../src/lib/automationCatalogue';
import { conditionsEtiquettesOk } from '../server/lib/etiquettes';
import { evaluateConditions } from '../server/lib/automationEngine';

const base = (tags: string[]) => ({
  from: () => ({ select: () => ({ eq: async () => ({ data: tags.map((tag) => ({ tag })), error: null }) }) }),
}) as any;
const client = (id: string | null) => async () => id;

describe('catalogue', () => {
  it('« Étiquette ajoutée » et « Étiquette retirée » laissent choisir QUELLE étiquette', () => {
    for (const cle of ['client.tagged', 'client.untagged']) {
      const d = DECLENCHEURS.find((x) => x.cle === cle)!;
      expect(d.champs?.find((c) => c.cle === 'tag')?.type, cle).toBe('etiquette');
    }
  });

  it('chaque déclencheur qui a un client offre « a » et « n’a pas » l’étiquette', () => {
    for (const d of DECLENCHEURS) {
      const cles = (d.champs ?? []).map((c) => c.cle);
      if (d.cle === 'webhook.received') { expect(cles).not.toContain('client_a_etiquette'); continue; }
      if (d.cle === 'quote.viewed') { expect(cles).toContain('etiquette'); expect(cles).not.toContain('client_a_etiquette'); continue; }
      for (const c of CLES_CONDITIONS_ETIQUETTES) expect(cles, d.cle).toContain(c);
    }
  });
});

describe('moteur', () => {
  it('sans filtre : vrai, sans même chercher le client', async () => {
    const cherche = vi.fn(async () => 'c1');
    expect(await conditionsEtiquettesOk(base([]), cherche, {})).toBe(true);
    expect(cherche).not.toHaveBeenCalled();
  });

  it('« a l’étiquette » : insensible à la casse', async () => {
    expect(await conditionsEtiquettesOk(base(['VIP']), client('c1'), { client_a_etiquette: 'vip' })).toBe(true);
    expect(await conditionsEtiquettesOk(base(['Printemps']), client('c1'), { client_a_etiquette: 'VIP' })).toBe(false);
  });

  it('« n’a pas l’étiquette »', async () => {
    expect(await conditionsEtiquettesOk(base(['Ne pas relancer']), client('c1'), { client_sans_etiquette: 'Ne pas relancer' })).toBe(false);
    expect(await conditionsEtiquettesOk(base(['VIP']), client('c1'), { client_sans_etiquette: 'Ne pas relancer' })).toBe(true);
  });

  it('un filtre sur une fiche sans client ne laisse rien partir', async () => {
    expect(await conditionsEtiquettesOk(base(['VIP']), client(null), { client_a_etiquette: 'VIP' })).toBe(false);
  });

  it('les filtres d’étiquettes ne sont jamais comparés aux métadonnées', () => {
    const evt = { type: 'note.added', orgId: 'o', entityType: 'client', entityId: 'c1', metadata: {} } as any;
    expect(evaluateConditions({ client_a_etiquette: 'VIP', client_sans_etiquette: 'Stop' }, evt)).toBe(true);
  });

  it('« quelle étiquette » : comparée à l’étiquette de l’événement', () => {
    const evt = (tag: string) => ({ type: 'client.tagged', orgId: 'o', entityType: 'client', entityId: 'c1', metadata: { tag } }) as any;
    expect(evaluateConditions({ tag: 'VIP' }, evt('VIP'))).toBe(true);
    expect(evaluateConditions({ tag: 'VIP' }, evt('Printemps'))).toBe(false);
    expect(evaluateConditions({ tag: '' }, evt('Printemps'))).toBe(true);
  });
});
