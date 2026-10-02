/**
 * Éditeur — parcours longs.
 *
 * Ce que ce fichier prouve :
 *  · un parcours de 30 étapes (le maximum que le serveur accepte) s'ouvre, se lit, se modifie et s'enregistre ;
 *  · un parcours de 50 étapes (données d'avant la limite, ou venues d'ailleurs) s'ouvre aussi, reste
 *    utilisable — temps d'ouverture mesuré, défilement, zoom, panneau —, et l'éditeur DIT qu'il dépasse
 *    la limite au lieu d'échouer à l'enregistrement.
 */
import { lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, texto, attente, ouvrirEditeur, cartes, carte, indicateur, attendreEnregistre, corpsDuFil,
  panneauEtape, toasts, type EtapeBase,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

function parcours(n: number): EtapeBase[] {
  // Un texto, une attente, un texto… et un texto pour finir (jamais une attente en dernier).
  return Array.from({ length: n }, (_, i) => {
    const suivant = i < n - 1 ? `e${i + 2}` : null;
    return i % 2 === 1 && i < n - 1 ? attente(`e${i + 1}`, 86400 * ((i % 5) + 1), suivant) : texto(`e${i + 1}`, `Texto numéro ${i + 1}`, suivant);
  });
}

test.describe('parcours longs', () => {
  test('[EDT-037][EDT-012] 30 étapes : tout s’affiche dans l’ordre, la dernière se modifie et s’enregistre', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} trente étapes`, parcours(30));
    await ouvrirEditeur(page, r.id);
    const vues = await cartes(page);
    expect(vues.length).toBe(30);
    expect(vues[0]).toBe('Envoyer un texto | Texto numéro 1');
    expect(vues[29]).toBe('Envoyer un texto | Texto numéro 30');
    await carte(page, 'Texto numéro 30').click();
    await expect(carte(page, 'Texto numéro 30')).toBeInViewport();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Dernier texto modifié');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await attendreEnregistre(page, 90_000);
    const fil = await corpsDuFil(bureau, r.id);
    expect(fil.length).toBe(30);
    expect(fil[29]).toBe('Dernier texto modifié');
  });

  test('[EDT-037][EDT-049][EDT-051] 50 étapes : l’éditeur s’ouvre vite, défile jusqu’au bout, zoome, ouvre un panneau', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} cinquante étapes`, parcours(50));
    await page.goto(`/automations/${r.id}`);
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    // Le rendu du canevas lui-même, une fois les données arrivées (le réseau n'est pas dans la mesure).
    const t0 = Date.now();
    await expect(carte(page, 'Texto numéro 49')).toBeAttached();
    const rendu = Date.now() - t0;
    test.info().annotations.push({ type: 'rendu-50-etapes-ms', description: String(rendu) });
    expect(rendu).toBeLessThan(3000);
    const vues = await cartes(page);
    expect(vues.length).toBe(50);
    expect(vues[49]).toBe('Envoyer un texto | Texto numéro 50');
    // Défilement jusqu'à la dernière carte, puis clic : le panneau s'ouvre sans délai sensible.
    await carte(page, 'Texto numéro 50').scrollIntoViewIfNeeded();
    await expect(carte(page, 'Texto numéro 50')).toBeInViewport();
    const t1 = Date.now();
    await carte(page, 'Texto numéro 50').click();
    await expect(panneauEtape(page).getByLabel(/Texte du message/)).toHaveValue('Texto numéro 50');
    const ouverture = Date.now() - t1;
    test.info().annotations.push({ type: 'ouverture-panneau-50-etapes-ms', description: String(ouverture) });
    expect(ouverture).toBeLessThan(2000);
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();
    // Zoom arrière complet : le parcours rétrécit, les cartes restent cliquables.
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Réduire', exact: true }).click();
    await expect(page.getByText('40%', { exact: true })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-50-etapes-zoom-40.png` });
    await carte(page, 'Texto numéro 25').click();
    await expect(panneauEtape(page).getByLabel(/Texte du message/)).toHaveValue('Texto numéro 25');
    await panneauEtape(page).getByRole('button', { name: 'Fermer le panneau' }).click();
    // Rien n'a été écrit en se promenant.
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-012] 50 étapes : modifier un texte n’aboutit pas à un échec d’enregistrement présenté comme une panne @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} cinquante modif`, parcours(50));
    await ouvrirEditeur(page, r.id);
    await carte(page, 'Texto numéro 1').first().click();
    await panneauEtape(page).getByLabel(/Texte du message/).fill('Premier texto corrigé');
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    const panne = toasts(page).filter({ hasText: /nouvel essai automatique/ });
    const fini = indicateur(page).filter({ hasText: 'Enregistré' });
    await expect(panne.or(fini).first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-50-etapes-enregistrement.png` });
    const message = (await panne.isVisible()) ? await panne.innerText() : '';
    const enBase = (await corpsDuFil(bureau, r.id))[0];
    expect(message, `le serveur refuse (plus de 30 étapes) et l’écran dit : « ${message} » — la correction (« ${enBase} » en base) ne sera jamais enregistrée`).toBe('');
  });
});
