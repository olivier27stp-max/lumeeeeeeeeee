/**
 * Bandeau « données importées pas encore activées » : visible sur toutes les pages tant que le
 * bureau est gelé après un import, avec un « Plus d'infos » qui explique que les automatisations
 * ne repartent qu'après « Activer le compte » dans Migrations. Il lit la MÊME ligne que la garde
 * d'envoi serveur (org_features / communications_gelees), jamais une copie.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const bandeau = lire('src/components/BandeauDonneesNonActivees.tsx');

describe('BandeauDonneesNonActivees', () => {
  it('lit la même source que la garde serveur (org_features, communications_gelees, enabled)', () => {
    expect(bandeau).toMatch(/FEATURE_GEL = 'communications_gelees'/);
    expect(lire('server/lib/migration/gel-communications.ts')).toMatch(/FEATURE_GEL = 'communications_gelees'/);
    expect(bandeau).toMatch(/from\('org_features'\)[\s\S]*?\.eq\('org_id', orgId\)[\s\S]*?\.eq\('feature', FEATURE_GEL\)/);
    expect(bandeau).toMatch(/gele: data\?\.enabled === true/);
  });

  it('se rafraîchit seul (chaque minute et au retour sur l’onglet) pour disparaître après l’activation', () => {
    expect(bandeau).toMatch(/refetchInterval: 60_000/);
    expect(bandeau).toMatch(/refetchOnWindowFocus: true/);
    expect(bandeau).toMatch(/if \(!etat\.data\?\.gele\) return null;/);
  });

  it('« Plus d’infos » ouvre un avertissement clair, en français et en anglais', () => {
    expect(bandeau).toMatch(/plus: 'Plus d’infos'/);
    expect(bandeau).toMatch(/Les automatisations ne sont pas activées tant que les données n’ont pas été activées dans Migrations\./);
    expect(bandeau).toMatch(/Automations stay off until the data has been activated in Migrations\./);
    expect(bandeau).toMatch(/role="alert"/);
  });

  it('est monté au-dessus de la barre d’en-tête, sur toutes les pages, et n’offre le lien console qu’aux admins Lume', () => {
    const app = lire('src/App.tsx');
    expect(app).toMatch(/<BandeauDonneesNonActivees peutActiver=\{creatorAccess\.data === true\} \/>/);
    const iBandeau = app.indexOf('<BandeauDonneesNonActivees');
    const iHeader = app.indexOf('<header className="h-11');
    expect(iBandeau).toBeGreaterThan(0);
    expect(iHeader).toBeGreaterThan(iBandeau);
    expect(bandeau).toMatch(/\{peutActiver && \(\s*<Link\s+to="\/creator-space\/migrations"/);
  });
});
