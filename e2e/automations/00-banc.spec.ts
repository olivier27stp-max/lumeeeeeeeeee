/**
 * Le banc lui-même : si ces tests tombent, aucun autre résultat ne vaut.
 *  · chaque rôle ouvre une vraie session sur le bureau de test ;
 *  · la langue demandée est bien celle de l'écran ;
 *  · le moniteur VOIT un problème quand il y en a un (témoin positif) ;
 *  · les bureaux sont en bac à sable.
 */
import { test, expect, Moniteur, ouvrirListe } from './_outils/banc';

test.describe('banc — sessions par rôle', () => {
  test('[BANC-001] le propriétaire ouvre la liste des automatisations, en français @matrice', async ({ page }) => {
    await ouvrirListe(page);
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
  });

  test.describe('admin', () => {
    test.use({ compte: 'adminA' });
    test('[BANC-002] l’admin ouvre la liste', async ({ page }) => {
      await ouvrirListe(page);
      await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible();
    });
  });

  test.describe('anglais', () => {
    test.use({ langue: 'en' });
    test('[BANC-003] la langue du test est celle de l’écran', async ({ page }) => {
      await page.goto('/automations');
      // Le titre anglais de la liste est « Workflows list » (src/pages/Automations.tsx).
      await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
      await expect(page.getByText('Mes automatisations')).toHaveCount(0);
    });
  });
});

test.describe('banc — garde-fous', () => {
  test('[BANC-004] les deux bureaux de test sont en bac à sable', async ({ bureau }) => {
    const { data } = await bureau.admin.from('orgs_envois_simules').select('org_id, mode').in('org_id', [bureau.orgA, bureau.orgB]);
    expect((data ?? []).map((l) => l.org_id).sort()).toEqual([bureau.orgA, bureau.orgB].sort());
    const { data: orgs } = await bureau.admin.from('orgs').select('name').in('id', [bureau.orgA, bureau.orgB]);
    for (const o of orgs ?? []) expect(o.name).toMatch(/^\[TEST\] QA Automatisations/);
  });

  test('[BANC-005] témoin positif : le moniteur relève une erreur de console, une exception, un 500 et un 404', async ({ context, baseURL }) => {
    // Un moniteur À PART, sur un onglet à part : celui du banc ferait échouer ce test, à raison.
    const page = await context.newPage();
    const m = new Moniteur(baseURL!);
    m.brancher(page);
    await page.route('**/api/e2e-temoin-500', (r) => r.fulfill({ status: 500, body: 'panne simulée' }));
    await page.route('**/api/e2e-temoin-404', (r) => r.fulfill({ status: 404, body: 'absent' }));
    await page.goto('/automations');
    await page.evaluate(async () => {
      console.error('erreur de console simulée');
      setTimeout(() => { throw new Error('exception simulée'); }, 0);
      await fetch('/api/e2e-temoin-500');
      await fetch('/api/e2e-temoin-404');
      await new Promise((r) => setTimeout(r, 200));
    });
    const genres = m.problemes.map((p) => `${p.genre}:${p.texte.slice(0, 40)}`);
    expect(genres.some((g) => g.startsWith('console:') && g.includes('erreur de console simulée'))).toBe(true);
    expect(genres.some((g) => g.startsWith('exception:') && g.includes('exception simulée'))).toBe(true);
    expect(genres.some((g) => g.startsWith('reseau:500'))).toBe(true);
    expect(genres.some((g) => g.startsWith('reseau:404'))).toBe(true);
    await page.close();
  });
});
