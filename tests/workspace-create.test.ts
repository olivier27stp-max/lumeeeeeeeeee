// Formulaire de création de workspace : helpers purs de /workspaces/create.
import { describe, it, expect } from 'vitest';
import {
  buildWorkspaceOrgPatch,
  buildWorkspaceSettingsUpsert,
  taxRegionFor,
  type WorkspaceInput,
} from '../server/lib/workspace-create';

const USER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const base: WorkspaceInput = {
  company: { name: ' Vision Lavage ', industry: 'window_cleaning', employee_count: '2-5' },
};

describe('buildWorkspaceOrgPatch — schéma prod de orgs', () => {
  it('n\'écrit que name / employee_count (+ logo_url si fourni)', () => {
    expect(buildWorkspaceOrgPatch(base)).toEqual({ name: 'Vision Lavage', employee_count: '2-5' });
    expect(buildWorkspaceOrgPatch({ ...base, company: { ...base.company, logo_url: 'https://x/l.png' } }))
      .toEqual({ name: 'Vision Lavage', employee_count: '2-5', logo_url: 'https://x/l.png' });
  });
});

describe('buildWorkspaceSettingsUpsert — champs facultatifs', () => {
  it('minimum : nom + industrie, sans effacer le reste', () => {
    const row = buildWorkspaceSettingsUpsert(base, 'org-1', USER);
    expect(row).toEqual({ org_id: 'org-1', created_by: USER, company_name: 'Vision Lavage', industry: 'window_cleaning' });
  });

  it('coordonnées, préférences et avis quand renseignés', () => {
    const row = buildWorkspaceSettingsUpsert({
      ...base,
      contact: {
        phone: '514 555 0100',
        email: 'Info@Vision.ca',
        website: '',
        address: { street1: '1 rue A', city: 'Montréal', province: 'QC', postal_code: 'H1A 1A1', country: 'CA' },
      },
      preferences: { currency: 'CAD', timezone: 'America/Toronto', revenue_goal_cents: 25_000_000 },
      reviews: { enabled: true, google_review_url: 'https://g.page/r/xyz', facebook_review_url: '' },
    }, 'org-1', USER);
    expect(row.email).toBe('info@vision.ca');
    expect(row).not.toHaveProperty('website');
    expect(row.city).toBe('Montréal');
    expect(row.timezone).toBe('America/Toronto');
    expect(row.revenue_goal_cents).toBe(25_000_000);
    expect(row.google_review_url).toBe('https://g.page/r/xyz');
    expect(row).not.toHaveProperty('facebook_review_url');
    expect(row.review_enabled).toBe(true);
  });

  it('les avis ne s\'activent pas sans au moins un lien', () => {
    const row = buildWorkspaceSettingsUpsert({ ...base, reviews: { enabled: true } }, 'org-1', USER);
    expect(row).not.toHaveProperty('review_enabled');
  });

  it('ignore un objectif de revenu nul ou invalide', () => {
    const row = buildWorkspaceSettingsUpsert({ ...base, preferences: { revenue_goal_cents: 0 } }, 'org-1', USER);
    expect(row).not.toHaveProperty('revenue_goal_cents');
  });
});

describe('taxRegionFor — région de taxes à semer', () => {
  it('QC par défaut', () => {
    expect(taxRegionFor(null, null)).toBe('QC');
    expect(taxRegionFor('Yukon', 'CA')).toBe('QC');
  });
  it('reconnaît codes et noms', () => {
    expect(taxRegionFor('Québec', 'CA')).toBe('QC');
    expect(taxRegionFor('ON', 'CA')).toBe('ON');
    expect(taxRegionFor('Colombie-Britannique', 'Canada')).toBe('BC');
    expect(taxRegionFor('CA', 'US')).toBe('US-CA');
    expect(taxRegionFor('Texas', 'États-Unis')).toBe('US-TX');
  });
});
