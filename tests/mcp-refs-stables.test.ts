/**
 * MCP : une référence tenue par l'agent externe ne change jamais de fiche.
 *
 * Même défaut que dans Lumi (constat R3), en pire : côté MCP, c'est l'agent
 * externe (Claude Desktop…) qui garde les réfs dans son propre fil, le serveur
 * n'a aucun historique à restaurer. Avec un compteur, chaque redéploiement
 * repartait à « ref1 » : le « ref5 » que l'agent tenait depuis le matin — le
 * client X — désignait la 5e fiche lue depuis le redémarrage. Un « supprime-le »
 * partait sur une autre fiche.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { masquerIds, demasquerIds } from '../server/lib/agent/refs';

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';
const Z = 'abcdef12-3456-4789-8abc-def012345678';
const espace = () => `mcp-${Math.random()}`;

describe('réfs stables (espace sans conversation)', () => {
  it('la même fiche reçoit la même réf dans deux processus différents', () => {
    const avant = masquerIds(espace(), { client_id: X, job_id: Z }, { stable: true });
    const apresRedemarrage = masquerIds(espace(), { job_id: Z, client_id: X }, { stable: true }); // autre ordre de lecture
    expect(apresRedemarrage.client_id).toBe(avant.client_id);
    expect(apresRedemarrage.job_id).toBe(avant.job_id);
    expect(avant.client_id).toMatch(/^ref\d+$/);
    expect(avant.client_id).not.toBe(avant.job_id);
  });

  it('LE DÉFAUT : avec un compteur, la réf d’avant le redémarrage désigne une autre fiche', () => {
    const matin = espace();
    const refX = masquerIds(matin, { client_id: X }).client_id; // ref1 = X
    const apres = espace(); // redéploiement : mémoire vide
    masquerIds(apres, { client_id: Y }); // première lecture : ref1 = Y
    expect(demasquerIds(apres, { client_id: refX })).toEqual({ client_id: Y }); // « supprime ref1 » viserait Y
  });

  it('LE CORRECTIF : la réf d’avant le redémarrage reste inconnue tant que sa fiche n’est pas relue, puis redevient la bonne', () => {
    const matin = espace();
    const refX = masquerIds(matin, { client_id: X }, { stable: true }).client_id;
    const apres = espace();
    masquerIds(apres, { client_id: Y }, { stable: true });
    // Inconnue : laissée telle quelle, l'outil répondra « introuvable » — jamais une autre fiche.
    expect(demasquerIds(apres, { client_id: refX })).toEqual({ client_id: refX });
    // L'agent relit la fiche : même réf qu'avant, et elle vise bien X.
    expect(masquerIds(apres, { client_id: X }, { stable: true }).client_id).toBe(refX);
    expect(demasquerIds(apres, { client_id: refX })).toEqual({ client_id: X });
  });

  it('deux identifiants qui commencent pareil gardent deux réfs distinctes', () => {
    const e = espace();
    const a = '00000001-0000-4000-8000-000000000001';
    const b = '00000001-0000-4000-8000-000000000002';
    const r = masquerIds(e, { a, b }, { stable: true });
    expect(r.a).not.toBe(r.b);
    expect(demasquerIds(e, { x: r.a, y: r.b })).toEqual({ x: a, y: b });
  });

  it('la route MCP demande des réfs stables ; Lumi garde ses petits compteurs par conversation', () => {
    const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
    expect(lire('server/routes/mcp.ts')).toContain('masquerIds(espaceRefs, resultatFinal, { stable: true })');
    expect(lire('server/lib/lumi/orchestrateur.ts')).toContain('masquerIds(espaceRefs, r.result)');
    expect(masquerIds(espace(), { client_id: X }).client_id).toBe('ref1');
  });
});
