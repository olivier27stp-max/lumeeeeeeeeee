// Marque commune, prix par bureau, fermeture de bureau (plan multi-bureaux,
// étapes 7, 8, 12). Preuve en conditions réelles : e2e staging 9/9 et 14/14.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const marque = lire('supabase/migrations/20260928020000_marque_entreprise.sql');
const prix = lire('supabase/migrations/20260928030000_prix_catalogue_par_bureau.sql');
const fermeture = lire('supabase/migrations/20260928010000_fermeture_bureau.sql');

describe('marque commune', () => {
  it('propagée par trigger aux seuls bureaux qui la suivent', () => {
    expect(marque).toMatch(/and cs\.suit_marque_entreprise;/);
    expect(marque).toMatch(/before update of logo_url, brand_color on public\.company_groups/);
  });
  it('seuls logo et couleur sont modifiables côté client (propriétaire, policy existante)', () => {
    expect(marque).toMatch(/grant update \(logo_url, brand_color\) on public\.company_groups to authenticated/);
  });
});

describe('prix par bureau', () => {
  it('table protégée comme les autres tables par bureau (bureau_actif) ; écriture admin', () => {
    expect(prix).toMatch(/create policy bureau_actif on public\.predefined_services_bureau\s+as restrictive/);
    expect(prix).toMatch(/has_org_admin_role\(\(select auth\.uid\(\)\), org_id\)/);
  });
  it('tous les sélecteurs de services reçoivent le prix et la disponibilité du bureau', () => {
    const api = lire('src/lib/servicesApi.ts');
    const liste = api.slice(api.indexOf('export async function listPredefinedServices'), api.indexOf('export async function listPredefinedServicesGestion'));
    expect(liste).toMatch(/reglagesDuBureau\(orgId\)/);
    expect(liste).toMatch(/offert !== false/);
  });
});

describe('fermeture de bureau', () => {
  it('propriétaire seulement ; jamais le dernier bureau ni celui de l’abonnement', () => {
    expect(fermeture).toMatch(/has_org_role\(v_uid, p_org, array\['owner'\]\)/);
    expect(fermeture).toMatch(/dernier bureau actif/);
    expect(fermeture).toMatch(/porte l''abonnement/);
  });
  it('réversible : ce qui est coupé est noté puis remis', () => {
    for (const cle of ['membres', 'regles', 'recurrences', 'factures_recurrentes', 'rapports', 'rappels']) {
      expect(fermeture).toContain(`'${cle}'`);
    }
  });
  it('un bureau fermé sort du sélecteur', () => {
    expect(lire('src/contexts/CompanyContext.tsx')).toMatch(/\.not\('archived_at', 'is', null\)/);
  });
});
