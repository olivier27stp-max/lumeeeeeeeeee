/**
 * Support moins cher (2026-09-17) : prompt quatre fois plus court et cache
 * partagé entre entreprises. Pur, sans Claude ni base.
 *
 *  - indexCarteApp : chaque écran de la carte y est, avec sa route, mais pas ses boutons
 *  - reponseGenerique : une réponse de doc sans trace du compte, sinon rien de partagé
 *  - la route cherche d'abord le cache partagé, puis celui de l'entreprise, et n'y écrit qu'une réponse générique
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARTE_APP, indexCarteApp } from '../../server/lib/support/carte-app';
import { reponseGenerique, outilsDeDoc, PORTEE_CACHE_SUPPORT_GLOBALE } from '../../server/lib/support/garde-fous';
import { cleIndex } from '../../server/lib/lumi/cache-semantique';

const ctx = { userName: 'Marie Tremblay', companyName: 'Plomberie Tremblay', planLabel: 'Scale' };

describe('indexCarteApp', () => {
  it('garde le vocabulaire, chaque écran et sa route, sans les boutons ; au moins quatre fois plus court', () => {
    const idx = indexCarteApp();
    expect(idx.startsWith('Vocabulaire :')).toBe(true);
    expect(idx).toContain('TRAVAIL QUOTIDIEN : ');
    expect(idx).toContain('Tâches (/tasks)');
    expect(idx).toContain('Jobs (/jobs)');
    expect(idx).toContain('Membres (/settings/team)');
    expect(idx).not.toContain('icône corbeille');
    expect(idx).not.toContain('confirmation');
    expect(idx.length * 4).toBeLessThan(CARTE_APP.length);
    // Toute route de la carte est dans l'index.
    for (const m of CARTE_APP.matchAll(/^[^:(\n]+?\s*\(([^)]*)\)\s*:/gm)) {
      const route = /\/[a-z0-9\-/:]+/i.exec(m[1])?.[0];
      if (route) expect(idx, route).toContain(`(${route})`);
    }
  });
  it('les titres de section perdent leur parenthèse explicative', () => {
    expect(indexCarteApp()).toMatch(/\nVENTE TERRAIN : /);
  });
});

describe('reponseGenerique', () => {
  it('une réponse de doc, sans trace du compte, est partageable', () => {
    expect(reponseGenerique('Ouvrez la page Tâches, puis sur la ligne de la tâche, menu « … » → « Supprimer ». Si ça ne règle pas votre cas, dites-le-moi et je passe la question à l’équipe.', ['search_help'], ctx)).toBe(true);
  });
  it('sans search_help (réponse de tête ou du dossier), ou avec un autre outil : jamais partagée', () => {
    expect(reponseGenerique('Ouvrez la page Tâches.', [], ctx)).toBe(false);
    expect(reponseGenerique('Ouvrez la page Tâches.', ['search_help', 'get_migration_status'], ctx)).toBe(false);
    expect(outilsDeDoc([])).toBe(true);
    expect(outilsDeDoc(['search_help'])).toBe(true);
    expect(outilsDeDoc(['transfer_to_human'])).toBe(false);
  });
  it('un chiffre, un nom, l’entreprise, le forfait ou une phrase d’état du compte la gardent privée', () => {
    for (const t of [
      'Vous avez 212 clients ; pour en archiver un, ouvrez sa fiche → « … » → « Archiver ».',
      'Marie, ouvrez Paramètres → Membres.',
      'Pour Plomberie Tremblay, c’est dans Paramètres → Taxes.',
      'Sur le forfait Scale, allez dans Paramètres → Forfait & facturation.',
      'Stripe est déjà activé chez vous ; pour le voir : Finances → Paiements.',
      'Dans votre cas, la migration est en attente.',
      'Vous êtes sur le forfait mensuel.',
    ]) expect(reponseGenerique(t, ['search_help'], ctx), t).toBe(false);
  });
  it('la portée partagée est par langue, hors de toute entreprise', () => {
    expect(cleIndex(PORTEE_CACHE_SUPPORT_GLOBALE('fr'))).toBe('lumi:sem:global:support-fr');
    expect(cleIndex(PORTEE_CACHE_SUPPORT_GLOBALE('en'))).toBe('lumi:sem:global:support-en');
  });
});

describe('route du support', () => {
  const src = readFileSync('server/routes/support.ts', 'utf8');
  it('cherche le cache partagé avant celui de l’entreprise, et n’écrit dans le partagé qu’une réponse générique', () => {
    const partage = src.indexOf('chercherSemantique(PORTEE_CACHE_SUPPORT_GLOBALE(ctx.langue)');
    const org = src.indexOf('chercherSemantique(PORTEE_CACHE_SUPPORT(auth.orgId)');
    expect(partage).toBeGreaterThan(0);
    expect(partage).toBeLessThan(org);
    expect(src).toContain('if (reponseGenerique(reply, r.outils, ctx)) void memoriserSemantique(PORTEE_CACHE_SUPPORT_GLOBALE(ctx.langue)');
    expect(src).toContain('outilsDeDoc(r.outils) && !page');
  });
});
