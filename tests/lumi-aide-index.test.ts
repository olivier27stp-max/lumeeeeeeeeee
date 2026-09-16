/**
 * search_help couvre tout le CRM (audit du 2026-09-16) : les pages du site,
 * la carte de l'app (routes et boutons exacts) ET la FAQ du support sont
 * indexées, pour que Lumi dans l'app réponde aussi bien que le support.
 */
import { describe, it, expect } from 'vitest';
import { chercherAide, passagesCarteApp, passagesArticles } from '../server/lib/agent/tools-aide';
import { CARTE_APP } from '../server/lib/support/carte-app';
import { ARTICLES } from '../src/components/supportArticles';

describe('index d aide élargi', () => {
  it('la carte de l app donne un passage par écran, avec sa route', () => {
    const p = passagesCarteApp();
    expect(p.length).toBeGreaterThan(40);
    const taches = p.find((x) => x.page === '/tasks');
    expect(taches?.texte).toMatch(/Supprimer/);
    const avis = p.find((x) => x.page === '/settings/reviews');
    expect(avis?.titre).toMatch(/Avis clients/);
    // Une ligne de section (═══) n'est pas un passage.
    expect(p.some((x) => /^═/.test(x.texte))).toBe(false);
  });
  it('chaque article de la FAQ est un passage, avec sa route', () => {
    const p = passagesArticles();
    expect(p.length).toBe(ARTICLES.length);
    expect(p.find((x) => x.slug === 'article:two-factor')?.page).toBe('/settings/team');
  });
  it('des questions sur des écrans absents des pages du site trouvent maintenant une réponse avec la bonne route', () => {
    const cas: Array<[string, string]> = [
      ['comment supprimer une tâche', '/tasks'],
      ['comment activer les avis Google', '/settings/reviews'],
      ['comment changer le logo de mon entreprise', '/settings/company'],
      ['activer la double authentification 2FA', '/settings/team'],
      ['j ai oublié mon mot de passe', '/auth'],
      ['régler mes taxes TPS TVQ', '/settings/taxes'],
      ['où sont mes formations', '/courses'],
    ];
    for (const [q, route] of cas) {
      const r = chercherAide(q);
      expect(r.map((x) => x.page), q).toContain(route);
    }
  });
  it('la carte reste sous le plafond de cache du prompt support', () => {
    expect(CARTE_APP.length).toBeLessThan(16_000);
  });
});
