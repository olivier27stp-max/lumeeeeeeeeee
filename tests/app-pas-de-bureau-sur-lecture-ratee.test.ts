/**
 * Une lecture ratée des adhésions ne crée jamais un bureau.
 *
 * `App.tsx` provisionne un bureau au premier passage d'un compte NEUF (aucune
 * adhésion). Il ignorait l'erreur de la lecture : sur une panne passagère,
 * `count` valait null, donc « aucune adhésion », donc création d'un bureau —
 * pour un propriétaire qui en avait déjà un. Observé trois fois pendant
 * l'audit du 2026-10-01 (staging saturé : `POST /rest/v1/orgs` tenté après un
 * 500 sur `memberships`).
 *
 * Test de source : monter `App` entier demande toute l'application ; la règle
 * tient en deux lignes dont l'ORDRE fait tout.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const app = readFileSync(resolve(__dirname, '..', 'src/App.tsx'), 'utf8');

describe('provision du premier bureau', () => {
  const debut = app.indexOf("// 1. Ensure user has at least one membership");
  const bloc = app.slice(debut, app.indexOf('// 2. Check if onboarding is done', debut));

  it('le bloc de provision existe toujours (sinon ce test ne prouve plus rien)', () => {
    expect(debut).toBeGreaterThan(0);
    expect(bloc).toContain(".from('orgs')");
    expect(bloc).toContain('.insert({ name:');
  });

  it('l’erreur de la lecture des adhésions est lue…', () => {
    expect(bloc).toMatch(/const \{ count: nbMemberships, error: lectureAdhesions \} = await supabase\s+\.from\('memberships'\)/);
  });

  it('… et fait sortir AVANT toute création de bureau', () => {
    const sortie = bloc.indexOf('if (lectureAdhesions) throw lectureAdhesions;');
    const creation = bloc.indexOf(".from('orgs')");
    expect(sortie).toBeGreaterThan(0);
    expect(sortie).toBeLessThan(creation);
  });
});

describe('contrôle d’accès (abonnement)', () => {
  it('une lecture ratée des adhésions ne ferme pas l’app sur « no_membership » : elle part vers le repli « accès ouvert »', () => {
    const debut = app.indexOf('if (await fetchIsBetaBypassed())');
    const bloc = app.slice(debut, app.indexOf("setAccessBlockedReason('no_subscription')", debut));
    const sortie = bloc.indexOf('if (lectureAdhesionsAcces) throw lectureAdhesionsAcces;');
    const blocage = bloc.indexOf("setAccessBlockedReason('no_membership')");
    expect(sortie).toBeGreaterThan(0);
    expect(blocage).toBeGreaterThan(sortie);
  });
});
