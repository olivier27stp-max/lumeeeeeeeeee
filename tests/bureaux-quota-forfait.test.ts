// Quota de bureaux : Autopilot comprend 2 bureaux d'office (décision de Rafba,
// 2026-09-25) ; le quota plateforme (Creator Space) l'emporte s'il est plus haut.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { officeQuotaForPlan, resolveOfficeQuota, OFFICE_QUOTA_KEY } from '../server/lib/platformFeatures';

const plateforme = (quota: number) => ({ feature: OFFICE_QUOTA_KEY, enabled: true, metadata: { quota, platform_override: true } });

describe('quota de bureaux selon le forfait', () => {
  it('Autopilot = 2, les autres forfaits = 1', () => {
    expect(officeQuotaForPlan('autopilot')).toBe(2);
    for (const slug of ['starter', 'pro', 'scale', null, undefined, 'inconnu']) expect(officeQuotaForPlan(slug)).toBe(1);
  });

  it('sans quota plateforme : le forfait décide', () => {
    expect(resolveOfficeQuota([], ['autopilot'])).toBe(2);
    expect(resolveOfficeQuota([], ['pro'])).toBe(1);
    expect(resolveOfficeQuota(null)).toBe(1);
  });

  it('le plus grand des deux gagne', () => {
    expect(resolveOfficeQuota([plateforme(5)], ['autopilot'])).toBe(5);
    expect(resolveOfficeQuota([plateforme(1)], ['autopilot'])).toBe(2);
    expect(resolveOfficeQuota([plateforme(3)], ['pro'])).toBe(3);
  });

  it('une ligne qui ne vient pas de la plateforme est ignorée (le tenant ne s’accorde rien)', () => {
    expect(resolveOfficeQuota([{ feature: OFFICE_QUOTA_KEY, enabled: true, metadata: { quota: 9 } }], ['pro'])).toBe(1);
  });

  it('getOfficeCapacity lit les forfaits actifs du groupe', () => {
    const src = readFileSync('server/routes/orgs.ts', 'utf8');
    const fn = src.slice(src.indexOf('async function getOfficeCapacity'), src.indexOf('async function callerRole'));
    expect(fn).toMatch(/from\('subscriptions'\)/);
    expect(fn).toMatch(/resolveOfficeQuota\(rows, /);
  });
});
