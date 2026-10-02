/**
 * Le jeu de bureaux du lot « modeles » est prêt — et son état est écrit pour le
 * mode économe (voir connexion.ts).
 *
 * Ce test passe par le banc TEL QUEL (bureaux créés ou retrouvés, comptes,
 * bac à sable vérifié, session ouverte par lien magique) : c'est lui qui fait
 * foi. Il doit être lancé une fois SANS `E2E_MODELES_ECONOME` avant toute passe
 * économe.
 */
import { test, expect } from '../_outils/banc';
import { ecrireEtatJeu, fichierEtatJeu } from './connexion';

test('[BANC-M01] les bureaux du lot existent, sont en bac à sable, et le propriétaire ouvre la liste par le banc', async ({ page, bureau }) => {
  const { data } = await bureau.admin.from('orgs_envois_simules').select('org_id').in('org_id', [bureau.orgA, bureau.orgB]);
  expect((data ?? []).map((l) => l.org_id).sort()).toEqual([bureau.orgA, bureau.orgB].sort());
  const { data: orgs } = await bureau.admin.from('orgs').select('name').in('id', [bureau.orgA, bureau.orgB]);
  expect(orgs ?? []).toHaveLength(2);
  for (const o of orgs ?? []) expect(o.name).toMatch(/^\[TEST\] QA Automatisations/);
  ecrireEtatJeu(bureau);
  expect(fichierEtatJeu()).toContain('bureau-');
  await page.goto('/automations');
  await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
});
