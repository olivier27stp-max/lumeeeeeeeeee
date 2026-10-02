// Passe prod, étape 1 : la liste telle qu'un propriétaire la voit. Lecture seule (aucun clic qui écrit).
import { ouvrir, capture, inventaire } from '../nav-prod.mjs';

const o = await ouvrir({});
const { page, m } = o;
const noms = (inv) => inv.elements.filter((e) => e.dansEcran).map((e) => `${e.tag}${e.role ? `[${e.role}]` : ''}:${e.nom || '(sans nom)'}${e.desactive ? ' (désactivé)' : ''}${e.couvert ? ` ⚠couvert par ${e.couvert}` : ''}`);
try {
  await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
  await o.temoins();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await capture(page, 'p1-01-liste', true);
  const inv = await inventaire(page);
  const sansNom = inv.elements.filter((e) => !e.nom);
  console.log('LISTE :', inv.elements.length, 'éléments ;', sansNom.length, 'sans nom accessible ; défilement horizontal :', inv.defilementX);
  console.log(noms(inv).slice(0, 45).join('\n'));

  for (const onglet of ['À vérifier', 'Modèles', 'Corbeille', 'Toutes']) {
    await page.getByRole('tab', { name: new RegExp(`^${onglet}`) }).first().click();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(500);
    await capture(page, `p1-02-onglet-${onglet}`);
    const texte = (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ');
    console.log(`\nONGLET ${onglet} :`, texte.slice(texte.indexOf('Mes automatisations'), texte.indexOf('Mes automatisations') + 420));
  }
  // Menu Créer
  await page.getByRole('button', { name: /^Créer/ }).click();
  await page.waitForTimeout(400);
  await capture(page, 'p1-03-menu-creer');
  console.log('\nMENU CRÉER :', (await inventaire(page)).elements.filter((e) => e.role === 'menuitem' || /zéro|modèle|Lumi/i.test(e.nom)).map((e) => e.nom).join(' | '));
  await page.keyboard.press('Escape');
  // Filtres avancés
  await page.getByRole('button', { name: /Filtres avancés/ }).click();
  await page.waitForTimeout(400);
  await capture(page, 'p1-04-filtres');
  console.log('\nFILTRES :', (await inventaire(page)).elements.filter((e) => e.dansEcran && e.y > 300 && e.y < 620 && (e.tag === 'select' || e.tag === 'input' || e.tag === 'button')).map((e) => `${e.tag}:${e.nom}`).slice(0, 25).join(' | '));
  await page.getByRole('button', { name: /Filtres avancés/ }).click();
  // Menu ⋮, chevron des messages et « Stats » de la première ligne
  const ligne = page.locator('tbody tr').first();
  console.log('\nPREMIÈRE LIGNE :', (await ligne.innerText()).replace(/\s+/g, ' ').slice(0, 200));
  const boutons = await ligne.getByRole('button').all();
  console.log('boutons de la ligne :', (await Promise.all(boutons.map(async (b) => (await b.getAttribute('aria-label')) || (await b.getAttribute('title')) || (await b.innerText()).trim() || '(sans nom)'))).join(' | '));
  await ligne.getByRole('button').last().click();
  await page.waitForTimeout(400);
  await capture(page, 'p1-05-menu-ligne');
  console.log('MENU ⋮ :', (await page.getByRole('menuitem').allInnerTexts()).join(' | ') || (await page.locator('[role=menu]').innerText().catch(() => '(pas de role=menu)')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  console.log('menu fermé par Échap :', (await page.getByRole('menuitem').count()) === 0);
} catch (e) {
  console.log('ÉCHEC :', String(e).slice(0, 300));
  await capture(page, 'p1-echec', true);
} finally {
  console.log('\nMONITEUR : console', m.console.length, '| exceptions', m.exceptions.length, '| réseau >=400', m.reseau.length, '| échecs', m.echecs.length);
  for (const x of [...m.console, ...m.exceptions, ...m.reseau, ...m.echecs].slice(0, 10)) console.log('  ', JSON.stringify(x).slice(0, 260));
  await o.fermer();
}
