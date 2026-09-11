/**
 * Références courtes (ref3 → UUID) : instantané et restauration.
 *
 * Le mapping vit en mémoire ; un redéploiement l'effaçait et une action
 * confirmée juste après échouait (« Quote not found », prod 2026-09-10).
 * Il est maintenant sauvé avec le dernier message de chaque tour
 * (lumi_messages.refs) et rejoué au chargement de la conversation.
 */
import { describe, it, expect } from 'vitest';
import { masquerIds, demasquerIds, instantaneRefs, restaurerRefs } from '../server/lib/agent/refs';

const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('instantané / restauration des réfs', () => {
  it('un instantané rejoué dans un espace vierge retraduit les réfs, et le compteur continue après', () => {
    const avant = 'org:user:avant';
    const masque = masquerIds(avant, { clients: [{ id: U1 }, { id: U2 }] });
    const refs = masque.clients.map((c: any) => c.id);
    const snap = instantaneRefs(avant);
    expect(Object.keys(snap).sort()).toEqual([...refs].sort());

    // « Redémarrage » : un espace neuf ne connaît rien…
    const apres = 'org:user:apres';
    expect(demasquerIds(apres, { quote_id: refs[0] })).toEqual({ quote_id: refs[0] });
    // …jusqu'à ce que l'instantané soit rejoué.
    restaurerRefs(apres, snap);
    expect(demasquerIds(apres, { quote_id: refs[0], autre: refs[1] })).toEqual({ quote_id: U1, autre: U2 });
    // Une nouvelle réf émise ensuite ne réutilise pas un numéro déjà pris.
    const nouveau = masquerIds(apres, { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }).id;
    expect(refs).not.toContain(nouveau);
    expect(Number(nouveau.slice(3))).toBeGreaterThan(Math.max(...refs.map((r: string) => Number(r.slice(3)))));
  });

  it('ignore les entrées malformées et ne réécrit jamais une réf vivante', () => {
    const cle = 'org:user:garde';
    const ref = masquerIds(cle, { id: U1 }).id;
    restaurerRefs(cle, { [ref]: U2, 'pasuneref': U1, ref99: 'pas-un-uuid' } as any);
    expect(demasquerIds(cle, { id: ref })).toEqual({ id: U1 });
    expect(demasquerIds(cle, { id: 'ref99' })).toEqual({ id: 'ref99' });
    restaurerRefs(cle, null);
    restaurerRefs(cle, undefined);
  });
});
