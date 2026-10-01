/**
 * LUMI — l'historique rejoué au modèle est toujours valide pour l'API.
 *
 * Le briefing du matin crée une conversation qui COMMENCE par un message de
 * Lumi et porte un bloc d'affichage `{ type: 'fiches' }`. Répondre dedans — là
 * où mène la notification — envoyait cet historique tel quel : bloc inconnu,
 * premier message `assistant`. 73 briefings en prod, aucune réponse encore.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assainirPourApi, AMORCE_BRIEFING } from '../server/lib/lumi/historique';

const briefing = {
  role: 'assistant' as const,
  content: [
    { type: 'text', text: 'Bon matin ! 3 visites aujourd’hui, 2 factures en retard.' },
    { type: 'fiches', fiches: [{ type: 'invoice', id: 'i1', label: 'Facture INV-0007', href: '/invoices/i1' }] },
  ] as any,
};

describe('historique rejoué au modèle', () => {
  it('répondre au briefing : le bloc « fiches » est retiré et la conversation commence par l’utilisateur', () => {
    const h = assainirPourApi([briefing, { role: 'user', content: 'Relance les deux factures.' }]);
    expect(h.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(h[0].content).toBe(AMORCE_BRIEFING);
    expect((h[1].content as any[]).map((b) => b.type)).toEqual(['text']);
    expect(JSON.stringify(h)).not.toContain('"fiches"');
  });

  it('un message qui ne contenait QUE des fiches disparaît (jamais un message vide)', () => {
    const h = assainirPourApi([
      { role: 'user', content: 'Mes clients ?' },
      { role: 'assistant', content: [{ type: 'fiches', fiches: [] }] as any },
      { role: 'assistant', content: [{ type: 'text', text: 'Tu en as 12.' }] },
    ]);
    expect(h).toHaveLength(2);
    expect(h.every((m) => (typeof m.content === 'string' ? m.content.length : m.content.length) > 0)).toBe(true);
  });

  it('une conversation normale n’est pas touchée (mêmes objets, cache du prompt intact)', () => {
    const msgs = [
      { role: 'user' as const, content: 'Mes factures en retard ?' },
      { role: 'assistant' as const, content: [{ type: 'tool_use' as const, id: 't1', name: 'list_invoices', input: {} }] },
      { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 't1', content: '{}' }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Aucune.' }] },
    ];
    const h = assainirPourApi(msgs);
    expect(h).toHaveLength(4);
    h.forEach((m, i) => expect(m).toBe(msgs[i]));
  });

  it('ne modifie pas l’entrée', () => {
    const copie = JSON.stringify([briefing]);
    assainirPourApi([briefing]);
    expect(JSON.stringify([briefing])).toBe(copie);
  });

  it('branchement : chargerHistorique assainit avant d’envoyer', () => {
    const route = readFileSync(resolve(__dirname, '../server/routes/lumi.ts'), 'utf8');
    expect(route).toContain('return purgerVieuxResultats(assainirPourApi(msgs));');
    // Le briefing écrit toujours ce bloc d'affichage : si ça change, ce test est à revoir.
    expect(readFileSync(resolve(__dirname, '../server/lib/lumi/briefing.ts'), 'utf8')).toContain("{ type: 'fiches', fiches }");
  });
});
