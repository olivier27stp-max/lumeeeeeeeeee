/**
 * LISTE — plus de 200 automatisations dans le bureau, et la pagination.
 *
 * Ce que ce fichier prouve :
 *  · avec 205 automatisations de plus, la liste s'affiche, reste utilisable
 *    et le temps d'affichage est mesuré (consigné dans le rapport du test) ;
 *  · la pagination : « Précédent », « Suivant », « sur N », 10 / 25 / 50 par
 *    page (retenu d'une visite à l'autre), bornes désactivées ;
 *  · la recherche et les tris portent sur TOUTES les pages, pas seulement la
 *    page affichée ;
 *  · « Tout cocher » : ce qu'il coche réellement ;
 *  · au-delà de 200 échecs récents, ce que devient l'onglet « À vérifier ».
 */
import { randomUUID } from 'node:crypto';
import { capturesDe } from '../_outils/banc';
import {
  test, expect, creerRegle, ouvrirListe, chercher, toast, onglet, nomsAffiches, attendre, reglesAffichables, type Bureau,
} from './_aides';

const N = 205;
const numero = (i: number) => String(i).padStart(3, '0');

/** 205 automatisations d'un coup (une seule écriture), nommées « <marque> vol-001 » … « vol-205 ». */
async function creerEnMasse(bureau: Bureau, org: string, marque: string, combien = N): Promise<string[]> {
  const lignes = Array.from({ length: combien }, (_, i) => ({
    org_id: org, name: `${marque} vol-${numero(i + 1)}`, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'log_activity', config: {} }], is_active: i % 2 === 0,
    created_at: new Date(Date.UTC(2026, 0, 1) + i * 3600_000).toISOString(),
  }));
  const { data, error } = await bureau.admin.from('automation_rules').insert(lignes).select('id');
  if (error) throw new Error(`creerEnMasse : ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

test.describe('plus de 200 automatisations', () => {
  test('[LST-087][LST-088][LST-089] 205 automatisations de plus : affichage mesuré, pagination juste', async ({ page, bureau, marque }, testInfo) => {
    await creerEnMasse(bureau, bureau.orgA, marque);
    // Ce que « Toutes » montre, lu en base à l'instant : les vivantes, sans le préréglage retiré de l'affichage (098dd153).
    // (Tous les préréglages du bureau sont publiés : `remettreEnEtat` y veille après chaque test.)
    const vivantes = (await reglesAffichables(bureau, bureau.orgA)).filter((r) => !r.deleted_at);
    expect(vivantes.filter((r) => r.is_preset && !r.is_active)).toHaveLength(0);
    const total = vivantes.length;
    expect(total).toBeGreaterThanOrEqual(N + 30);

    // Mesure : du départ de la navigation jusqu'au tableau ; et la part du NAVIGATEUR (après l'arrivée des données).
    let donneesArrivees = 0;
    page.on('response', (r) => { if (r.url().includes('/rest/v1/automation_rules?') && r.request().method() === 'GET' && !donneesArrivees) donneesArrivees = Date.now(); });
    const depart = Date.now();
    await page.goto('/automations');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(10);
    const fin = Date.now();
    const mesure = { automatisations: total, total_ms: fin - depart, apres_les_donnees_ms: donneesArrivees ? fin - donneesArrivees : null };
    testInfo.annotations.push({ type: 'mesure', description: JSON.stringify(mesure) });
    console.log(`[mesure] liste à ${total} automatisations :`, JSON.stringify(mesure));

    // 10 par page par défaut.
    const pages = Math.ceil(total / 10);
    await expect(page.getByText(`sur ${pages}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Précédent' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Suivant' })).toBeEnabled();
    const page1 = await nomsAffiches(page);
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect.poll(async () => (await nomsAffiches(page))[0]).not.toBe(page1[0]);
    const page2 = await nomsAffiches(page);
    expect(page2).toHaveLength(10);
    expect(page2.filter((n) => page1.includes(n))).toEqual([]);
    await expect(page.getByRole('button', { name: 'Précédent' })).toBeEnabled();
    await page.getByRole('button', { name: 'Précédent' }).click();
    await expect.poll(() => nomsAffiches(page)).toEqual(page1);

    // Le rendu lui-même (hors réseau) reste rapide.
    expect(mesure.apres_les_donnees_ms ?? 0).toBeLessThan(15_000);
  });

  test('[LST-089][LST-090][LST-091][LST-092] 10 / 25 / 50 par page : le nombre de lignes et de pages suit, le choix est retenu', async ({ page, bureau, marque }) => {
    await creerEnMasse(bureau, bureau.orgA, marque);
    await ouvrirListe(page);
    await chercher(page, marque);
    const parPage = page.getByRole('combobox', { name: 'Lignes par page' });
    await expect(parPage.getByRole('option')).toHaveText(['10 / page', '25 / page', '50 / page']);
    await expect(parPage).toHaveValue('10');
    await expect(page.getByText('sur 21')).toBeVisible();

    await parPage.selectOption('25');
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(25);
    await expect(page.getByText('sur 9')).toBeVisible();
    await parPage.selectOption('50');
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(50);
    await expect(page.getByText('sur 5')).toBeVisible();

    // Dernière page : 205 = 4 × 50 + 5.
    for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Suivant' }).click();
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(5);
    await expect(page.getByRole('button', { name: 'Suivant' })).toBeDisabled();
    // Changer la taille de page ramène à la première.
    await parPage.selectOption('10');
    await expect(page.getByRole('button', { name: 'Précédent' })).toBeDisabled();
    await parPage.selectOption('50');

    // Retenu au retour sur la page.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('combobox', { name: 'Lignes par page' })).toHaveValue('50');
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(50);
  });

  test('[LST-035][LST-062] la recherche et le tri portent sur toutes les pages', async ({ page, bureau, marque }) => {
    await creerEnMasse(bureau, bureau.orgA, marque);
    await ouvrirListe(page);
    // « vol-205 » est très loin de la première page : la recherche la trouve quand même.
    await chercher(page, `${marque} vol-205`);
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} vol-205`]);
    await expect(page.getByText('sur 1')).toBeVisible();

    await chercher(page, `${marque} vol-1`);
    // vol-100 … vol-199 : cent automatisations, dix pages.
    await expect(page.getByText('sur 10')).toBeVisible();

    await chercher(page, marque);
    await expect(page.getByText('sur 21')).toBeVisible();
    const nom = page.getByRole('columnheader', { name: 'Nom' }).getByRole('button');
    await nom.click();
    await expect.poll(async () => (await nomsAffiches(page))[0]).toBe(`${marque} vol-001`);
    await nom.click();
    // Tri décroissant : la première ligne est la DERNIÈRE des 205, pas la dernière de la page.
    await expect.poll(async () => (await nomsAffiches(page))[0]).toBe(`${marque} vol-205`);
    const creee = page.getByRole('columnheader', { name: 'Créée le' }).getByRole('button');
    await creee.click();
    await expect.poll(async () => (await nomsAffiches(page)).slice(0, 3)).toEqual([1, 2, 3].map((i) => `${marque} vol-${numero(i)}`));
    // Changer de tri ramène en page 1.
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect.poll(async () => (await nomsAffiches(page))[0]).toBe(`${marque} vol-011`);
    await creee.click();
    await expect(page.getByRole('button', { name: 'Précédent' })).toBeDisabled();
    await expect.poll(async () => (await nomsAffiches(page))[0]).toBe(`${marque} vol-205`);
  });

  test('[LST-061][LST-054] « Tout cocher » coche la page affichée (pas les 205) et le lot ne touche que celle-là', async ({ page, bureau, marque }) => {
    const ids = await creerEnMasse(bureau, bureau.orgA, marque);
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('combobox', { name: 'Lignes par page' }).selectOption('50');
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(50);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await expect(page.getByText('50 sélectionnée(s)')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Cocher /, checked: true })).toHaveCount(50);
    // vol-001 à vol-050 : 25 publiées (rangs impairs), 25 brouillons.
    await expect(page.getByRole('button', { name: 'Repasser en brouillon (25)' })).toBeVisible();
    // Changer de page vide la sélection : un lot ne porte jamais sur des lignes qu'on ne voit pas.
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(page.getByText(/sélectionnée\(s\)/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Précédent' }).click();
    await expect(page.getByRole('checkbox', { name: /^Cocher /, checked: true })).toHaveCount(0);

    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await page.getByRole('button', { name: 'Repasser en brouillon (25)' }).click();
    await expect(toast(page, '25 automatisation(s) repassée(s) en brouillon')).toBeVisible({ timeout: 120_000 });
    const { count: publiees } = await bureau.admin.from('automation_rules').select('id', { count: 'exact', head: true })
      .in('id', ids).eq('is_active', true);
    // 103 publiées au départ (rangs impairs de 1 à 205), moins les 25 de la page.
    expect(publiees).toBe(103 - 25);
  });

  test('[LST-061] avec plus d’une page, on peut tout sélectionner d’un coup (les 205) @defaut', async ({ page, bureau, marque }) => {
    await creerEnMasse(bureau, bureau.orgA, marque, 60);
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await expect(page.getByText('10 sélectionnée(s)')).toBeVisible();
    // « Tout cocher » ne coche que 10 lignes sur 60, et rien ne propose d'étendre aux 60 : dépublier 60 automatisations = 6 tours (ou 2 à 50 par page).
    await expect(page.getByRole('button', { name: /Sélectionner les 60|Tout sélectionner \(60\)/ })).toBeVisible({ timeout: 5_000 });
  });

  test('[LST-088] supprimer toute la dernière page ramène sur la page précédente, pas sur un écran vide', async ({ page, bureau, marque }) => {
    await creerEnMasse(bureau, bureau.orgA, marque, 11);
    await ouvrirListe(page);
    await chercher(page, marque);
    await expect(page.getByText('sur 2')).toBeVisible();
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect.poll(() => nomsAffiches(page)).toEqual([`${marque} vol-011`]);
    await page.getByRole('checkbox', { name: 'Tout cocher' }).check();
    await page.getByRole('button', { name: 'Supprimer (1)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(toast(page, '1 automatisation(s) à la corbeille')).toBeVisible();
    await expect(page.getByText('sur 1')).toBeVisible();
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(10);
    await expect(page.getByText('Aucune automatisation')).toHaveCount(0);
  });

  test('[LST-089][LST-088] en bas de liste, la bulle « Aide et support » ne recouvre ni « Suivant » ni le choix du nombre de lignes', async ({ page }) => {
    await ouvrirListe(page);
    await expect.poll(async () => (await nomsAffiches(page)).length).toBe(10);
    const parPage = page.getByRole('combobox', { name: 'Lignes par page' });
    await parPage.scrollIntoViewIfNeeded();
    // On descend tout en bas, comme le fait quelqu'un qui va chercher la pagination.
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 5000);
    await expect(parPage).toBeInViewport();
    await page.screenshot({ path: `${capturesDe('liste')}/bulle-aide-sur-pagination.png` });
    const boite = async (l: import('@playwright/test').Locator) => (await l.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
    const bulle = await boite(page.getByRole('button', { name: 'Aide et support' }));
    for (const [nom, cible] of [['Lignes par page', parPage], ['Suivant', page.getByRole('button', { name: 'Suivant' })]] as const) {
      const c = await boite(cible);
      const recouvrementX = Math.min(c.x + c.width, bulle.x + bulle.width) - Math.max(c.x, bulle.x);
      const recouvrementY = Math.min(c.y + c.height, bulle.y + bulle.height) - Math.max(c.y, bulle.y);
      expect(recouvrementX > 0 && recouvrementY > 0, `« ${nom} » est en partie sous la bulle d’aide (${Math.round(recouvrementX)} × ${Math.round(recouvrementY)} px)`).toBe(false);
    }
  });

  test('[LST-021] au-delà de 200 échecs récents, une automatisation en échec ne disparaît pas de « À vérifier » @defaut', async ({ page, bureau, marque }) => {
    const bruyante = await creerRegle(bureau, bureau.orgA, { name: `${marque} A bruyante`, is_active: true });
    const discrete = await creerRegle(bureau, bureau.orgA, { name: `${marque} B discrete`, is_active: true });
    const echec = (ruleId: string, quand: string) => ({
      org_id: bureau.orgA, automation_rule_id: ruleId, trigger_event: 'lead.created', entity_type: 'lead', entity_id: randomUUID(),
      action_type: 'send_sms', result_success: false, result_error: 'No recipient phone', created_at: quand,
    });
    // La discrète a échoué avant-hier ; depuis, la bruyante a échoué 205 fois.
    const avantHier = new Date(Date.now() - 2 * 86400_000).toISOString();
    const hier = new Date(Date.now() - 86400_000).toISOString();
    const { error } = await bureau.admin.from('automation_execution_logs')
      .insert([echec(discrete.id, avantHier), ...Array.from({ length: 205 }, () => echec(bruyante.id, hier))]);
    expect(error).toBeNull();
    await page.goto('/automations?onglet=verifier');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 120_000 });
    await chercher(page, marque);
    await attendre(() => nomsAffiches(page), (n) => n.includes(bruyante.name), 60_000);
    // La lecture s'arrête aux 200 échecs les plus récents : la discrète sort de l'onglet alors qu'elle échoue toujours.
    await expect.poll(() => nomsAffiches(page), { timeout: 5_000 }).toEqual([bruyante.name, discrete.name]);
    await expect(onglet(page, 'À vérifier')).toHaveText('À vérifier (2)');
  });
});
