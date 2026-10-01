/**
 * Page Automatisations — la LISTE : chargement, vide, erreur, et le cycle de
 * vie d'une automatisation depuis ses menus (dupliquer, corbeille, restaurer).
 *
 * Vrai Chromium, vraie API locale (sans tâche de fond, sans fournisseur), vraie
 * base staging (bureau A de test « ui »). Chaque affirmation à l'écran est
 * doublée d'une lecture de `automation_rules` en service_role.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import {
  avecCapture, confirmerDialogue, creerRegle, fermerNavigateur, lireRegle, marqueUi, nettoyer,
  ouvrirOnglet, reglesParNom, attendreToast, voir, type Onglet,
} from '../harnais/navigateur';

const ORG = () => inject('uiOrgA');
const MARQUE = marqueUi('liste');

let o: Onglet;
beforeAll(async () => { o = await ouvrirOnglet(); });
// Une interception oubliée (test en échec) fausserait tous les suivants.
afterEach(async () => { await o?.page.unrouteAll({ behavior: 'ignoreErrors' }); });
afterAll(async () => {
  await o?.fermer();
  await fermerNavigateur();
  await nettoyer(ORG(), MARQUE);
});

/** Ouvre la liste et attend la fin du chargement (le titre + le tableau). */
async function ouvrirListe(): Promise<void> {
  await o.page.goto(`${o.base}/automations`);
  await o.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
  await o.page.locator('table').waitFor({ timeout: 30_000 });
}

/** La ligne du tableau qui porte ce nom. */
const ligne = (nom: string) => o.page.locator('tbody tr').filter({ hasText: nom }).first();

describe('Liste des automatisations', () => {
  it('[J-001] la liste charge et affiche les automatisations du bureau (nom, statut)', async () => {
    await avecCapture(o, 'J-001', async () => {
      const r = await creerRegle(ORG(), { name: `${MARQUE} visible`, is_active: false });
      await ouvrirListe();
      await expect.poll(() => ligne(r.name).isVisible()).toBe(true);
      await expect(ligne(r.name).textContent()).resolves.toContain('Brouillon');
    });
  });

  it('[J-002] pendant le chargement, un indicateur tourne au lieu d’une liste vide', async () => {
    await avecCapture(o, 'J-002', async () => {
      let relacher: () => void = () => undefined;
      const retenue = new Promise<void>((r) => { relacher = r; });
      await o.page.route('**/rest/v1/automation_rules*', async (route) => { await retenue; await route.continue().catch(() => undefined); });
      try {
        await o.page.goto(`${o.base}/automations`);
        await o.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
        await expect.poll(() => o.page.locator('.section-card .animate-spin').count()).toBeGreaterThan(0);
        await voir(o.page.getByText('Aucune automatisation')).absent();
      } finally {
        relacher();
        await o.page.unroute('**/rest/v1/automation_rules*');
      }
    });
  });

  it('[J-003] aucune automatisation : l’état vide le dit', async () => {
    await avecCapture(o, 'J-003', async () => {
      await o.page.route('**/rest/v1/automation_rules*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
      try {
        await ouvrirListe();
        await expect.poll(() => o.page.getByText('Aucune automatisation').isVisible()).toBe(true);
      } finally {
        await o.page.unroute('**/rest/v1/automation_rules*');
      }
    });
  });

  it('[J-004] API en panne : la liste dit qu’elle n’a pas pu charger (pas « Aucune automatisation ») et « Réessayer » recharge', async () => {
    await avecCapture(o, 'J-004', async () => {
      await creerRegle(ORG(), { name: `${MARQUE} après panne`, is_active: false });
      await o.page.route('**/rest/v1/automation_rules*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"panne simulée"}' }));
      await o.page.goto(`${o.base}/automations`);
      await o.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
      await expect.poll(() => o.page.getByText(/Impossible de charger les automatisations/).first().isVisible(), { timeout: 20_000 }).toBe(true);
      // Un échec n'est PAS une liste vide : l'écran ne doit pas affirmer qu'il n'y a rien.
      await voir(o.page.getByText('Aucune automatisation')).absent();
      await o.page.unroute('**/rest/v1/automation_rules*');
      await o.page.getByRole('button', { name: 'Réessayer' }).click();
      await expect.poll(() => ligne(`${MARQUE} après panne`).isVisible(), { timeout: 20_000 }).toBe(true);
    });
  });
});

describe('Cycle de vie depuis la liste', () => {
  it('[J-020] Dupliquer : la copie naît en brouillon, avec le même parcours', async () => {
    await avecCapture(o, 'J-020', async () => {
      const steps = [
        { id: 'e1', type: 'action', action: { type: 'create_notification', config: { title: 'Suivi QA' } }, suivant: null },
      ];
      const source = await creerRegle(ORG(), {
        name: `${MARQUE} source`, is_active: true, trigger_event: 'invoice.sent',
        actions: [{ type: 'create_notification', config: { title: 'Suivi QA' } }], steps,
      });
      await ouvrirListe();
      await ligne(source.name).getByRole('button', { name: `Actions pour ${source.name}` }).click();
      await o.page.getByRole('menuitem', { name: 'Dupliquer' }).click();
      await attendreToast(o.page, 'Copie créée');
      const copies = (await reglesParNom(ORG(), MARQUE)).filter((r) => r.id !== source.id && r.name.includes('source'));
      expect(copies).toHaveLength(1);
      const copie = copies[0];
      expect(copie.is_active).toBe(false);
      expect(copie.is_preset).toBe(false);
      expect(copie.trigger_event).toBe('invoice.sent');
      expect(copie.steps).toEqual(steps);
      // Ce qui est affiché = ce qui est en base.
      await expect.poll(() => ligne(copie.name).isVisible()).toBe(true);
      await expect(ligne(copie.name).textContent()).resolves.toContain('Brouillon');
      // La source n'a pas bougé.
      expect((await lireRegle(source.id)).is_active).toBe(true);
    });
  });

  it('[J-021] Supprimer : confirmation, corbeille, dépubliée ; [J-022] Restaurer : revient en brouillon', async () => {
    await avecCapture(o, 'J-021', async () => {
      const r = await creerRegle(ORG(), { name: `${MARQUE} à jeter`, is_active: true, trigger_event: 'invoice.sent' });
      await ouvrirListe();
      await ligne(r.name).getByRole('button', { name: `Actions pour ${r.name}` }).click();
      await o.page.getByRole('menuitem', { name: 'Supprimer' }).click();
      await confirmerDialogue(o.page, 'Supprimer');
      await attendreToast(o.page, 'mise à la corbeille');
      const jetee = await lireRegle(r.id);
      expect(jetee.deleted_at).not.toBeNull();
      expect(jetee.is_active).toBe(false);
      // Plus dans « Toutes », présente dans « Corbeille » avec le statut « Supprimée ».
      await expect.poll(() => ligne(r.name).count()).toBe(0);
      await o.page.getByRole('tab', { name: /Corbeille/ }).click();
      await expect.poll(() => ligne(r.name).isVisible()).toBe(true);
      await expect(ligne(r.name).textContent()).resolves.toContain('Supprimée');

      // [J-022] Restaurer
      await ligne(r.name).getByRole('button', { name: `Actions pour ${r.name}` }).click();
      await o.page.getByRole('menuitem', { name: 'Restaurer' }).click();
      await attendreToast(o.page, 'restaurée');
      const restauree = await lireRegle(r.id);
      expect(restauree.deleted_at).toBeNull();
      expect(restauree.is_active).toBe(false);
      await o.page.getByRole('tab', { name: /Toutes/ }).click();
      await expect.poll(() => ligne(r.name).isVisible()).toBe(true);
      await expect(ligne(r.name).textContent()).resolves.toContain('Brouillon');
    });
  });
});
