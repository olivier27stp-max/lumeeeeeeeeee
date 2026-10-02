/**
 * Agent S — un REGARD sur la LISTE après le lot « liste » (pas une preuve) : captures, pour relire à l'œil
 * les endroits que le lot a changés. Sorties : D:/lume-final/sorties/s/ (préfixe « liste- »).
 *
 *   QA_AUTO_SUFFIXE=d QA_UI_PORT_API=3494 QA_UI_PORT_VITE=5494 QA_UI_SORTIES=D:/lume-final/sorties/s \
 *     npx vitest run --maxWorkers=2 --config tests/automations-finale/d/vitest.config.ts --project ui \
 *     tests/automations-finale/d/ui/98-regard-liste.preuve.ts
 */
import { describe, it, afterAll } from 'vitest';
import { ouvrirOnglet, fermerNavigateur, capturer, type Onglet } from '../../../automations-suite/harnais/navigateur';

afterAll(async () => { await fermerNavigateur(); });

async function regarder(o: Onglet, langue: 'fr' | 'en'): Promise<void> {
  const voir = async (nom: string) => { await o.page.waitForTimeout(500); await capturer(o.page, `liste-${langue}-${nom}`); };
  const fr = langue === 'fr';
  await o.page.goto(`${o.base}/automations`);
  await o.page.locator('#rech-automations').waitFor();
  await o.page.locator('table tbody tr').first().waitFor();
  await voir('accueil');

  // La barre de lot, dans la rangée du fil d'Ariane ; puis la sélection étendue.
  await o.page.getByRole('checkbox', { name: fr ? 'Tout cocher' : 'Select all' }).check();
  await voir('lot-page-cochee');
  const etendre = o.page.getByRole('button', { name: fr ? /^Sélectionner les \d+$/ : /^Select all \d+$/ });
  if (await etendre.count()) { await etendre.click(); await voir('lot-selection-etendue'); }
  await o.page.getByRole('button', { name: fr ? 'Tout décocher' : 'Clear selection' }).click();

  // Une case sur deux : l'état intermédiaire.
  await o.page.locator('table tbody input[type="checkbox"]').first().check();
  await voir('lot-une-case');
  await o.page.getByRole('button', { name: fr ? 'Tout décocher' : 'Clear selection' }).click();

  // Le menu « ⋮ » ouvert au clavier, focus dans le menu.
  await o.page.locator('table tbody button[aria-haspopup="menu"]').first().focus();
  await o.page.keyboard.press('Enter');
  await o.page.keyboard.press('ArrowDown');
  await voir('menu-ligne-clavier');
  await o.page.keyboard.press('Escape');

  // Recherche : par le sous-titre, puis sans résultat.
  await o.page.locator('#rech-automations').fill(fr ? 'nouveau prospect' : 'new lead');
  await voir('recherche-sous-titre');
  await o.page.locator('#rech-automations').fill('zzz-rien-ne-porte-ce-nom');
  await voir('recherche-sans-resultat');
  await o.page.locator('#rech-automations').fill('');

  // Filtres : le compteur sur le bouton, panneau fermé.
  await o.page.getByRole('button', { name: fr ? /^Filtres avancés/ : /^Advanced filters/ }).click();
  await o.page.locator('#f-statut').selectOption('brouillon');
  await o.page.locator('#f-categorie').selectOption('Reviews');
  await o.page.getByRole('button', { name: fr ? /^Filtres avancés/ : /^Advanced filters/ }).click();
  await voir('filtres-actifs-panneau-ferme');

  // Les onglets : « À vérifier » et la corbeille (adresse à jour).
  await o.page.goto(`${o.base}/automations?onglet=verifier`);
  await o.page.locator('table').waitFor();
  await voir('onglet-a-verifier');
  await o.page.goto(`${o.base}/automations?onglet=corbeille`);
  await o.page.locator('table').waitFor();
  await voir('onglet-corbeille');

  // Chiffres illisibles : l'onglet sans compteur, l'état vide qui ne dit pas « tout roule ».
  await o.page.route('**/api/automations/rules/stats*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"panne simulée"}' }));
  await o.page.goto(`${o.base}/automations?onglet=verifier`);
  await o.page.getByRole('alert').first().waitFor();
  await voir('a-verifier-illisible');
  await o.page.unroute('**/api/automations/rules/stats*');

  // Dossiers illisibles.
  await o.page.route('**/api/automations/folders', (r) => (r.request().method() === 'GET'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Impossible de lire les dossiers."}' })
    : r.continue()));
  await o.page.goto(`${o.base}/automations`);
  await o.page.getByRole('alert').first().waitFor();
  await voir('dossiers-illisibles');
  await o.page.unroute('**/api/automations/folders');

  // À 1024 px de large : la rangée du fil d'Ariane et de la barre de lot.
  await o.page.setViewportSize({ width: 1024, height: 800 });
  await o.page.goto(`${o.base}/automations`);
  await o.page.locator('table tbody tr').first().waitFor();
  await o.page.getByRole('checkbox', { name: fr ? 'Tout cocher' : 'Select all' }).check();
  await voir('lot-1024');
}

describe('S — regard sur la liste (lot « liste »)', () => {
  it('français', async () => {
    const o = await ouvrirOnglet({ langue: 'fr' });
    try { await regarder(o, 'fr'); } finally { await o.fermer(); }
  });
  it('anglais', async () => {
    const o = await ouvrirOnglet({ langue: 'en' });
    try { await regarder(o, 'en'); } finally { await o.fermer(); }
  });
});
