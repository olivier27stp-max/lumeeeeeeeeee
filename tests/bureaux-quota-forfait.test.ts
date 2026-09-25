/**
 * Bureaux inclus dans le forfait.
 *
 * Les bureaux avaient été retirés des forfaits (migration 20260917000000) :
 * tout le monde à 1, et seule la plateforme pouvait en accorder plus.
 * Autopilot, qui vend la « gestion multi-équipes », butait donc sur un seul
 * bureau — il a fallu poser des lignes `org_features` à la main pour deux
 * organisations le 2026-09-25.
 *
 * Le forfait redevient un PLANCHER. La règle qui compte, et que ces tests
 * figent : on prend le plus grand des deux, jamais le quota du forfait seul.
 * Aligner sur le forfait retirerait un bureau déjà en service à une
 * organisation dont la plateforme avait relevé le quota.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BUREAUX_PAR_FORFAIT,
  DEFAULT_OFFICE_QUOTA,
  MAX_OFFICE_QUOTA,
  quotaBureauxDuForfait,
  quotaEffectifBureaux,
  resolveOfficeQuota,
} from '../server/lib/platformFeatures';

/** Une ligne org_features telle que Creator Space l'écrit. */
const accorde = (quota: number) => [
  { feature: 'office_quota', enabled: true, metadata: { quota, platform_override: true } },
];

describe('ce que chaque forfait inclut', () => {
  it('Autopilot en inclut 2', () => {
    expect(quotaBureauxDuForfait({ slug: 'autopilot' })).toBe(2);
  });

  it('Scale et Minimum en incluent 1', () => {
    expect(quotaBureauxDuForfait({ slug: 'pro' })).toBe(1);
    expect(quotaBureauxDuForfait({ slug: 'starter' })).toBe(1);
  });

  it('la table est la source unique', () => {
    expect(BUREAUX_PAR_FORFAIT.autopilot).toBe(2);
    expect(BUREAUX_PAR_FORFAIT.pro).toBe(1);
    expect(BUREAUX_PAR_FORFAIT.starter).toBe(1);
  });

  it('sans abonnement lisible, le plancher reste 1', () => {
    // Une lecture ratée ne doit pas OUVRIR des bureaux.
    for (const p of [null, undefined, {}, { slug: null }, { slug: 'inconnu' }]) {
      expect(quotaBureauxDuForfait(p as any), JSON.stringify(p)).toBe(DEFAULT_OFFICE_QUOTA);
    }
  });
});

describe('personne ne perd un bureau déjà en service', () => {
  it('un quota plateforme de 2 survit à un forfait qui n’en donne qu’un', () => {
    // Le cas réel : Coquin lavage et Vision Lavage, quota 2 posé le 2026-09-25.
    expect(quotaEffectifBureaux({ slug: 'pro' }, accorde(2))).toBe(2);
  });

  it('une organisation SANS abonnement garde son quota plateforme', () => {
    // Vision Lavage : aucun abonnement, quota 2. Aligner sur le forfait
    // l'aurait ramenée à 1, avec un bureau déjà créé.
    expect(quotaEffectifBureaux(null, accorde(2))).toBe(2);
  });

  it('une exception plus large que le forfait l’emporte', () => {
    expect(quotaEffectifBureaux({ slug: 'autopilot' }, accorde(5))).toBe(5);
  });
});

describe('le forfait sert de plancher', () => {
  it('Autopilot obtient 2 sans aucune ligne plateforme', () => {
    // C'est le cas qui manquait : Grok Audit (TEST), autopilot, bloqué à 1.
    expect(quotaEffectifBureaux({ slug: 'autopilot' }, [])).toBe(2);
    expect(quotaEffectifBureaux({ slug: 'autopilot' }, null)).toBe(2);
  });

  it('Scale reste à 1 sans ligne plateforme', () => {
    expect(quotaEffectifBureaux({ slug: 'pro' }, [])).toBe(1);
  });

  it('un quota plateforme PLUS PETIT que le forfait ne rabaisse pas Autopilot', () => {
    expect(quotaEffectifBureaux({ slug: 'autopilot' }, accorde(1))).toBe(2);
  });
});

describe('les garde-fous existants tiennent', () => {
  it('une ligne sans marque de plateforme est ignorée', () => {
    // Sans `platform_override`, n'importe qui écrivant org_features
    // s'accorderait des bureaux.
    const bidon = [{ feature: 'office_quota', enabled: true, metadata: { quota: 9 } }];
    expect(resolveOfficeQuota(bidon)).toBe(DEFAULT_OFFICE_QUOTA);
    expect(quotaEffectifBureaux({ slug: 'pro' }, bidon)).toBe(1);
  });

  it('une autre feature ne donne pas de bureaux', () => {
    const autre = [{ feature: 'autre_chose', enabled: true, metadata: { quota: 9, platform_override: true } }];
    expect(quotaEffectifBureaux({ slug: 'pro' }, autre)).toBe(1);
  });

  it('le plafond absolu est respecté', () => {
    expect(quotaEffectifBureaux({ slug: 'autopilot' }, accorde(9_999))).toBe(MAX_OFFICE_QUOTA);
  });

  it('aucun forfait ne dépasse le plafond', () => {
    for (const [slug, n] of Object.entries(BUREAUX_PAR_FORFAIT)) {
      expect(n, slug).toBeLessThanOrEqual(MAX_OFFICE_QUOTA);
      expect(n, slug).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('le point d’application lit bien le forfait', () => {
  it('getOfficeCapacity passe par quotaEffectifBureaux', () => {
    // Le piège : ajouter la table sans brancher le calcul — les tests
    // unitaires passeraient et la création de bureau resterait bloquée.
    const src = readFileSync(resolve(__dirname, '..', 'server/routes/orgs.ts'), 'utf8');
    expect(src).toContain('quotaEffectifBureaux');
    expect(src).toMatch(/from\('subscriptions'\)[\s\S]{0,200}plans:plan_id \(slug\)/);
  });
});
