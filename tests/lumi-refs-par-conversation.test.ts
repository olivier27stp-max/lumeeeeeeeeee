/**
 * Les références courtes (ref1, ref2…) appartiennent à UNE conversation.
 *
 * Constat R3 de l'inventaire, reproduit ici : l'espace des réfs était commun à
 * toutes les conversations d'une personne. Les réfs sont des compteurs ; après
 * un redéploiement (ou 30 minutes sans activité) une nouvelle conversation
 * repartait à « ref1 ». Reprendre ensuite une ancienne conversation ne
 * restaurait pas ses propres réfs (une réf vivante n'est jamais réécrite) : le
 * « ref1 » que le modèle lisait dans l'ancien historique — le client X —
 * désignait désormais la fiche de l'autre conversation — le client Y. Une
 * action partait sur la mauvaise fiche.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { masquerIds, demasquerIds, instantaneRefs, restaurerRefs, espaceRefsDe } from '../server/lib/agent/refs';

const X = '11111111-1111-4111-8111-111111111111';
const Y = '22222222-2222-4222-8222-222222222222';

describe('un espace de réfs par conversation', () => {
  it('la clé porte la conversation ; sans conversation (texto, MCP) elle reste par personne', () => {
    expect(espaceRefsDe('org', 'user', 'conv-a')).toBe('org:user:conv-a');
    expect(espaceRefsDe('org', 'user', 'conv-a')).not.toBe(espaceRefsDe('org', 'user', 'conv-b'));
    expect(espaceRefsDe('org', 'user')).toBe('org:user');
    expect(espaceRefsDe('org', 'user', null)).toBe('org:user');
  });

  it('LE DÉFAUT, reproduit avec un espace partagé : l’ancienne « ref1 » désigne la fiche d’une autre conversation', () => {
    const partage = `partage-${Math.random()}`;
    // Hier, conversation A : ref1 = client X. Sauvegardé avec la conversation.
    expect(masquerIds(partage, { client_id: X })).toEqual({ client_id: 'ref1' });
    const sauveA = instantaneRefs(partage);
    // Redéploiement : la mémoire est vide. Simulé par un autre espace « partagé » neuf.
    const apresRedemarrage = `partage-${Math.random()}`;
    // Aujourd'hui, conversation B, même personne : ref1 = client Y.
    expect(masquerIds(apresRedemarrage, { client_id: Y })).toEqual({ client_id: 'ref1' });
    // L'utilisateur reprend la conversation A : ses réfs sont restaurées… mais ref1 est déjà prise.
    restaurerRefs(apresRedemarrage, sauveA);
    // Le modèle relit « ref1 = client X » dans l'historique de A et agit sur ref1 :
    expect(demasquerIds(apresRedemarrage, { client_id: 'ref1' })).toEqual({ client_id: Y }); // ← la mauvaise fiche
  });

  it('LE CORRECTIF : chaque conversation a son espace, la même reprise vise la bonne fiche', () => {
    const org = `org-${Math.random()}`;
    const a = espaceRefsDe(org, 'user', 'conv-a');
    expect(masquerIds(a, { client_id: X })).toEqual({ client_id: 'ref1' });
    const sauveA = instantaneRefs(a);
    // « Redéploiement » : on repart d'espaces neufs (autre entreprise fictive = mémoire vide pour ces clés).
    const org2 = `org-${Math.random()}`;
    const a2 = espaceRefsDe(org2, 'user', 'conv-a');
    const b2 = espaceRefsDe(org2, 'user', 'conv-b');
    expect(masquerIds(b2, { client_id: Y })).toEqual({ client_id: 'ref1' });
    restaurerRefs(a2, sauveA);
    expect(demasquerIds(a2, { client_id: 'ref1' })).toEqual({ client_id: X });
    expect(demasquerIds(b2, { client_id: 'ref1' })).toEqual({ client_id: Y });
    // Et une nouvelle fiche lue dans A continue après la plus haute réf connue de A.
    expect(masquerIds(a2, { client_id: Y })).toEqual({ client_id: 'ref2' });
  });
});

describe('la route de Lumi utilise partout l’espace de la conversation', () => {
  const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
  const route = lire('server/routes/lumi.ts');

  it('plus aucune clé « entreprise:personne » construite à la main dans la route', () => {
    expect(route).not.toContain('`${ctx.auth.orgId}:${ctx.auth.user.id}`');
    expect(route.match(/espaceRefsDe\(ctx\.auth\.orgId, ctx\.auth\.user\.id, (conversationId|conversation_id|o\.conversationId)\)/g)?.length).toBeGreaterThanOrEqual(15);
  });

  it('l’orchestrateur, le repérage, les actions directes et l’optimisation reçoivent cet espace', () => {
    expect(route).toContain('espaceRefs: cleRefs,');
    expect(route.match(/repondreActionDirecte\([^\n]*espaceRefs: espaceRefsDe\(ctx\.auth\.orgId, ctx\.auth\.user\.id, conversationId\)/g)).toHaveLength(2);
    expect(route).toMatch(/repondreOptimisation\(\{[^\n]*espaceRefs: espaceRefsDe\(ctx\.auth\.orgId, ctx\.auth\.user\.id, o\.conversationId\)/);
    expect(lire('server/lib/lumi/orchestrateur.ts')).toContain('const espaceRefs = opts.espaceRefs ?? `${opts.orgId}:${opts.userId}`;');
    expect(lire('server/lib/lumi/actions-directes.ts')).toContain('const espace = ctx.espaceRefs ?? `${ctx.orgId}:${ctx.userId}`;');
    expect(lire('server/lib/lumi/optimiserJournee.ts')).toContain('const espace = ctx.espaceRefs ?? `${ctx.orgId}:${ctx.userId}`;');
  });

  it('la décision (Confirmer) retraduit les réfs dans l’espace de SA conversation, restauré juste avant', () => {
    const execute = route.slice(route.indexOf("router.post('/lumi/execute'"), route.indexOf("router.get('/lumi/mode'"));
    const charge = execute.indexOf('chargerHistorique(conversation_id, espaceRefsDe(ctx.auth.orgId, ctx.auth.user.id, conversation_id))');
    const traduit = execute.indexOf('demasquerIds(espaceRefsDe(ctx.auth.orgId, ctx.auth.user.id, conversation_id), a.args)');
    expect(charge).toBeGreaterThan(0);
    expect(traduit).toBeGreaterThan(charge);
  });
});
