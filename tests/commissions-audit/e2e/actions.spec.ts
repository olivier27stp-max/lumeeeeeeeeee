/**
 * Chaque bouton de la page, cliqué pour de vrai, et son effet vérifié.
 * Série : les actions modifient le tenant (rejoué au prochain lancement).
 */
import { test, expect } from '@playwright/test';
import { API, ANON_KEY } from '../env-local';
import { ORG, U, R, f, MEMBRES, MOT_DE_PASSE } from '../fixture';
import { SEPT, argent, norm, oracle, connecter, filtrerPeriode } from './outils';
import type { Attendu } from '../comparer';

test.describe.configure({ mode: 'serial' });

let attendus: Attendu[] = [];
test.beforeAll(async () => { attendus = await oracle(); });
const montant = (cle: string) => attendus.find((a) => a.invoice_id === f(cle).id)!.montant_cents;

async function jeton(userId: string) {
  const m = MEMBRES.find((x) => x.id === userId)!;
  const r = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: m.courriel, password: MOT_DE_PASSE }),
  });
  return (await r.json()).access_token as string;
}

test.beforeEach(async ({ page }) => {
  await connecter(page, U.olivia, 'fr');
  await page.goto('/commissions');
  await filtrerPeriode(page, SEPT.from, SEPT.to);
});

const ligne = (page: import('@playwright/test').Page, cle: string) => page.getByRole('row', { name: new RegExp(`FX-${cle}-`) }).first();

test('« Verser » : la ligne passe à Versé et le KPI « Versé sur la période » suit', async ({ page }) => {
  await ligne(page, 'I1').getByRole('button', { name: /Verser/ }).click();
  await expect(ligne(page, 'I1')).toContainText('Versé');
  await page.reload();
  await filtrerPeriode(page, SEPT.from, SEPT.to);
  expect(norm(await page.getByText('Versé sur la période').locator('..').innerText())).toContain(argent(montant('I1'), 'fr'));
});

test('« Reverser » : annuler ne change rien ; confirmer retire la commission du total', async ({ page }) => {
  const totalAvant = norm(await page.locator('main').innerText());
  await ligne(page, 'I8').getByRole('button', { name: 'Reverser la commission' }).click();
  await expect(page.getByText('Reverser cette commission ?')).toBeVisible();
  await page.getByRole('button', { name: /Annuler/ }).click();
  await expect(ligne(page, 'I8')).not.toContainText('Reversé');
  await ligne(page, 'I8').getByRole('button', { name: 'Reverser la commission' }).click();
  await page.getByRole('button', { name: 'Reverser', exact: true }).click();
  await expect(ligne(page, 'I8')).toContainText('Reversé');
  expect(norm(await page.locator('main').innerText())).not.toEqual(totalAvant);
});

test('facture payée ailleurs (« Marquer payée ») : la page reflète la nouvelle commission', async ({ page }) => {
  const r = await fetch(`http://localhost:3012/api/invoices/${f('I2').id}/mark-paid`, {
    method: 'POST', headers: { Authorization: `Bearer ${await jeton(U.olivia)}`, 'x-org-id': ORG.A, 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'cash' }),
  });
  expect(r.status).toBe(200);
  await page.reload();
  await filtrerPeriode(page, SEPT.from, SEPT.to);
  // Payée aujourd'hui, au taux du jour (12 %) sur 500,00 $ avant taxes.
  await expect(ligne(page, 'I2')).toBeVisible();
  expect(norm(await ligne(page, 'I2').innerText())).toContain(argent(6000, 'fr'));
});

test('une estimation n’a pas de bouton Approuver (on ne paie pas un job non encaissé)', async ({ page }) => {
  await filtrerPeriode(page, '2026-09-15', '2026-09-15');
  const estimation = page.getByRole('row', { name: /Estimation/ }).first();
  await expect(estimation).toBeVisible();
  await expect(estimation.getByRole('button', { name: 'Approuver' })).toHaveCount(0);
});

test('onglet Taux : assigner un plan puis revenir au plan par défaut', async ({ page }) => {
  await page.getByRole('button', { name: 'Taux', exact: true }).click();
  const choix = page.getByLabel('Plan de commission de Nora SansPlan');
  await choix.selectOption(R.pct);
  await expect(page.getByText('Plan mis à jour')).toBeVisible();
  await choix.selectOption('');
  await expect(page.getByText('Plan mis à jour').first()).toBeVisible();
});

test('onglets et retour : aucun bouton mort', async ({ page }) => {
  for (const nom of ['Représentants', 'Mes commissions', 'Taux', "Vue d'ensemble"]) {
    await page.getByRole('button', { name: nom, exact: true }).click();
    await expect(page.getByRole('button', { name: nom, exact: true })).toHaveClass(/shadow-sm/);
  }
});
