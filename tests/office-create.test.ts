// Formulaire « Nouveau bureau » : helpers purs de la route create-office et
// du module d'héritage (remap des ids de taxes, filtres d'accès).
import { describe, it, expect } from 'vitest';
import {
  buildOrgInsert,
  buildCompanySettingsInsert,
  filterGrantable,
  formatAddressLine,
} from '../server/lib/office-create';
import {
  mapTaxGroupItems,
  mapJobTags,
  pickBranding,
  zipIds,
} from '../server/lib/office-inheritance';

const CREATOR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ADMIN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OUTSIDER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

describe('buildOrgInsert / buildCompanySettingsInsert — champs facultatifs', () => {
  it('n\'écrit que le nom quand rien d\'autre n\'est fourni', () => {
    const org = buildOrgInsert({ name: '  Bureau de Laval ' }, CREATOR, null);
    expect(org).toEqual({ name: 'Bureau de Laval', created_by: CREATOR });
    const cs = buildCompanySettingsInsert({ name: 'Bureau de Laval' }, 'org-1', CREATOR);
    expect(cs).toEqual({ org_id: 'org-1', created_by: CREATOR, company_name: 'Bureau de Laval' });
  });

  it('reporte l\'adresse structurée sur les deux tables (orgs.address = une ligne)', () => {
    const input = {
      name: 'Laval',
      phone: '450-555-0100',
      email: 'Laval@Example.com ',
      website: 'https://example.com',
      address: { street1: '10 rue A', street2: '', city: 'Laval', province: 'QC', postal_code: 'H7A 1A1', country: 'CA' },
    };
    const org = buildOrgInsert(input, CREATOR, 'group-1');
    expect(org.company_group_id).toBe('group-1');
    expect(org.address).toBe('10 rue A, Laval, QC, H7A 1A1');
    expect(org.region).toBe('QC');
    expect(org.email).toBe('laval@example.com');
    const cs = buildCompanySettingsInsert(input, 'org-1', CREATOR);
    expect(cs.street1).toBe('10 rue A');
    expect(cs).not.toHaveProperty('street2'); // vide → non écrit (colonne DEFAULT '')
    expect(cs.website).toBe('https://example.com');
  });

  it('formatAddressLine ignore les morceaux vides', () => {
    expect(formatAddressLine({ city: 'Laval', province: ' ' })).toBe('Laval');
    expect(formatAddressLine(null)).toBe('');
  });
});

describe('filterGrantable — accès immédiat au nouveau bureau', () => {
  const members = [
    { user_id: CREATOR, role: 'owner', status: 'active' },
    { user_id: ADMIN, role: 'admin', status: 'active' },
    { user_id: REP, role: 'sales_rep', status: 'active' },
  ];

  it('retient seulement les owners/admins actifs demandés, sans le créateur', () => {
    const out = filterGrantable([CREATOR, ADMIN, REP, OUTSIDER], members, CREATOR);
    expect(out).toEqual([{ user_id: ADMIN, role: 'admin' }]);
  });

  it('rejette un membre inactif même s\'il est admin', () => {
    const out = filterGrantable([ADMIN], [{ user_id: ADMIN, role: 'admin', status: 'pending' }], CREATOR);
    expect(out).toEqual([]);
  });

  it('ne dédouble jamais un id demandé deux fois', () => {
    const out = filterGrantable([ADMIN, ADMIN], members, CREATOR);
    expect(out).toHaveLength(1);
  });
});

describe('héritage — remap des taxes et identité', () => {
  it('zipIds aligne ancien → nouvel id dans l\'ordre d\'insertion', () => {
    const m = zipIds([{ id: 'a' }, { id: 'b' }], [{ id: 'A' }, { id: 'B' }]);
    expect(m.get('a')).toBe('A');
    expect(m.get('b')).toBe('B');
  });

  it('mapTaxGroupItems remappe et saute les liens orphelins', () => {
    const groups = new Map([['g1', 'G1']]);
    const configs = new Map([['c1', 'C1']]);
    const out = mapTaxGroupItems(
      [
        { tax_group_id: 'g1', tax_config_id: 'c1', sort_order: 2 },
        { tax_group_id: 'g1', tax_config_id: 'c-missing', sort_order: 0 },
      ],
      groups,
      configs,
    );
    expect(out).toEqual([{ tax_group_id: 'G1', tax_config_id: 'C1', sort_order: 2 }]);
  });

  it('pickBranding ne copie que les colonnes renseignées', () => {
    const patch = pickBranding({
      logo_url: 'https://x/logo.png',
      website: '',
      currency: 'CAD',
      timezone: null,
      default_unit: 'sqft',
      industry: 'landscaping',
      company_name: 'NE DOIT PAS PASSER',
    });
    expect(patch).toEqual({
      logo_url: 'https://x/logo.png',
      currency: 'CAD',
      default_unit: 'sqft',
      industry: 'landscaping',
    });
  });

  it('mapJobTags exclut les étiquettes supprimées', () => {
    const out = mapJobTags(
      [{ name: 'VIP', color_hex: '#f00' }, { name: 'Old', color_hex: '#000', deleted_at: '2026-01-01' }],
      'org-2',
    );
    expect(out).toEqual([{ org_id: 'org-2', name: 'VIP', color_hex: '#f00' }]);
  });
});
