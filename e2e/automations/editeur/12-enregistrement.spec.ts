/**
 * Éditeur — l'enregistrement du parcours.
 *
 * Ce que ce fichier prouve :
 *  · l'enregistrement est AUTOMATIQUE (aucun bouton), environ 3 s après la dernière modification,
 *    et une rafale de modifications ne produit qu'un envoi ;
 *  · une panne du serveur est dite, puis rattrapée toute seule quand le serveur revient ;
 *  · un REFUS de validation du serveur n'est pas présenté comme une panne passagère, et ne tourne pas
 *    en boucle (piste S-04) — cas réel : une attente en fin de parcours ;
 *  · réseau coupé, débit dépassé : message propre ;
 *  · deux onglets sur la même automatisation (piste S-13).
 */
import type { Page } from '@playwright/test';
import { lireRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, ouvrirEditeur, cartes, carte, menuDeCarte, indicateur, attendreEnregistre,
  corpsDuFil, dialogue, panneauEtape, tiroirActions, toasts,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

const texte = (page: Page) => panneauEtape(page).getByLabel(/Texte du message/);
async function modifier(page: Page, cible: string, nouveau: string): Promise<void> {
  await carte(page, cible).click();
  await texte(page).fill(nouveau);
  await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
}

test.describe('enregistrement automatique', () => {
  test('[EDT-012] aucun bouton « Enregistrer » global : l’envoi part seul, ~3 s après la dernière modification, avec le parcours complet', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} auto`, troisTextos());
    await ouvrirEditeur(page, r.id);
    const envois: Array<{ quand: number; corps: { name?: string; steps?: unknown[] } }> = [];
    page.on('request', (req) => {
      if (req.method() === 'PATCH' && req.url().includes(`/api/automations/rules/${r.id}`)) envois.push({ quand: Date.now(), corps: req.postDataJSON() });
    });
    await modifier(page, 'Texto ALPHA', 'Texto ALPHA v2');
    const t0 = Date.now();
    await expect(indicateur(page)).toHaveText('Modifié');
    await expect.poll(() => envois.length, { timeout: 30_000 }).toBe(1);
    const delai = envois[0].quand - t0;
    expect(delai, `délai mesuré : ${delai} ms`).toBeGreaterThan(2000);
    expect(delai, `délai mesuré : ${delai} ms`).toBeLessThan(8000);
    expect(envois[0].corps.name).toBe(`${marque} auto`);
    expect(envois[0].corps.steps?.length).toBe(3);
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA v2', 'Texto BRAVO', 'Texto CHARLIE']);
  });

  test('[EDT-012] trois modifications en moins de 3 s : un seul envoi, avec les trois', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} rafale`, troisTextos());
    await ouvrirEditeur(page, r.id);
    let envois = 0;
    page.on('request', (req) => { if (req.method() === 'PATCH' && req.url().includes(`/api/automations/rules/${r.id}`)) envois += 1; });
    await modifier(page, 'Texto ALPHA', 'A2');
    await modifier(page, 'Texto BRAVO', 'B2');
    await modifier(page, 'Texto CHARLIE', 'C2');
    await attendreEnregistre(page);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['A2', 'B2', 'C2']);
    expect(envois).toBeLessThanOrEqual(2);
  });

  test('[EDT-012] panne du serveur : c’est dit, l’indicateur ne prétend pas « Enregistré », et ça se rattrape seul au retour du serveur', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} panne`, troisTextos());
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/500 PATCH .*\/api\/automations\/rules\//, 'panne simulée de l’enregistrement automatique');
    let panne = true;
    await page.route(`**/api/automations/rules/${r.id}`, (route) => (panne && route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Impossible de modifier l\'automatisation.' }) })
      : route.continue()));
    await modifier(page, 'Texto BRAVO', 'Texto BRAVO pendant la panne');
    await expect(toasts(page).filter({ hasText: 'Enregistrement impossible pour le moment — nouvel essai automatique.' })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-012-panne-enregistrement.png` });
    await expect(indicateur(page)).toHaveText(/Modifié|Enregistrement…/);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
    panne = false;
    await attendreEnregistre(page, 60_000);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO pendant la panne', 'Texto CHARLIE']);
  });

  /* @defaut depuis le tri du 2026-10-01 : après le 429, l'éditeur n'envoie PAS le deuxième essai (un seul PATCH
     dans la trace) et l'indicateur reste sur « Enregistrement… » pour de bon — la reprise prévue dans
     AutomationBuilderPage.tsx (`attentes = [1500, 4000]`) retombe sur `if (annule) return;`, vrai dès que
     l'effet s'est relancé en posant « en cours ». La modification n'atteint jamais la base. */
  test('[EDT-012] débit dépassé (429) : jamais « Too many requests » à l’écran, et l’enregistrement finit par passer @defaut', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} débit`, troisTextos());
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/429 PATCH .*\/api\/automations\/rules\//, 'plafond de débit simulé');
    let refus = 0;
    await page.route(`**/api/automations/rules/${r.id}`, (route) => {
      if (route.request().method() !== 'PATCH' || refus >= 1) return route.continue();
      refus += 1;
      return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many requests. Please try again later.' }) });
    });
    await modifier(page, 'Texto BRAVO', 'Texto BRAVO après le plafond');
    // La reprise est prévue 1,5 s après le refus : 20 s lui laissent largement le temps.
    await expect(indicateur(page), 'après le 429, aucun nouvel essai ne part : l’indicateur reste sur « Enregistrement… » et la modification n’atteint jamais la base')
      .toHaveText('Enregistré', { timeout: 20_000 });
    await expect(page.getByText(/Too many requests/i)).toHaveCount(0);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO après le plafond', 'Texto CHARLIE']);
  });

  test('[EDT-012] réseau coupé : « Connexion perdue », rien n’est marqué enregistré', async ({ page, context, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} hors ligne`, troisTextos());
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to fetch|Connexion perdue/, 'réseau coupé exprès');
    await context.setOffline(true);
    try {
      await modifier(page, 'Texto BRAVO', 'Texto BRAVO hors ligne');
      await expect(toasts(page).filter({ hasText: 'Connexion perdue — vérifiez votre réseau et réessayez.' })).toBeVisible({ timeout: 30_000 });
      await expect(indicateur(page)).not.toHaveText('Enregistré');
    } finally {
      await context.setOffline(false);
    }
    await attendreEnregistre(page, 90_000);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO hors ligne', 'Texto CHARLIE']);
  });
});

test.describe('refus de validation du serveur (S-04)', () => {
  test('[EDT-060][EDT-012] ajouter « Attendre » en dernière étape (geste normal) : pas de message de panne, pas d’essais en boucle @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} attente finale`, troisTextos());
    await ouvrirEditeur(page, r.id);
    const reponses: number[] = [];
    page.on('response', (resp) => {
      if (resp.request().method() === 'PATCH' && resp.url().includes(`/api/automations/rules/${r.id}`)) reponses.push(resp.status());
    });
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroirActions(page).getByRole('button', { name: /^Attendre/ }).click();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    expect((await cartes(page)).at(-1)).toBe('Attendre | 1 jour(s)');
    // On laisse le temps de deux essais (3 s puis 6 s).
    await expect.poll(() => reponses.length, { timeout: 40_000 }).toBeGreaterThanOrEqual(1);
    const premier = toasts(page).first();
    const message = (await premier.isVisible()) ? await premier.innerText() : '';
    await page.screenshot({ path: `${CAPTURES}/edt-s04-attente-finale.png` });
    await page.waitForResponse((resp) => resp.request().method() === 'PATCH' && resp.url().includes(`/api/automations/rules/${r.id}`), { timeout: 20_000 }).catch(() => undefined);
    const refus = reponses.filter((s) => s >= 400).length;
    expect(message, `toast affiché : « ${message} »`).not.toContain('nouvel essai automatique');
    expect(refus, `le serveur a refusé ${refus} fois le même parcours (réponses : ${reponses.join(', ')}) : l’éditeur le renvoie en boucle`).toBeLessThanOrEqual(1);
  });

  test('[EDT-012] pendant qu’un refus de validation dure, les AUTRES modifications ne sont pas perdues en silence @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} refus bloque tout`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroirActions(page).getByRole('button', { name: /^Attendre/ }).click();
    await panneauEtape(page).getByRole('button', { name: 'Enregistrer' }).click();
    await modifier(page, 'Texto ALPHA', 'Texto ALPHA réécrit');
    // L'utilisateur voit-il un indicateur qui dit la vérité ? « Modifié » en boucle ne dit pas que RIEN ne s'enregistre.
    await page.waitForResponse((resp) => resp.request().method() === 'PATCH' && resp.url().includes(`/api/automations/rules/${r.id}`), { timeout: 30_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-s04-autres-modifs.png` });
    const sauve = (await corpsDuFil(bureau, r.id)).includes('Texto ALPHA réécrit');
    const dit = await page.getByText(/attente.*(rien ne se passera|fin)|se termine par une attente/i).first().isVisible();
    const indic = await indicateur(page).innerText();
    expect(sauve || (dit && !/^(Modifié|Enregistré|Enregistrement…)$/.test(indic)),
      `le texto réécrit n’est pas en base, et l’indicateur dit « ${indic} » comme si l’enregistrement allait venir`).toBe(true);
  });

  test('[EDT-047][EDT-012] casser une automatisation PUBLIÉE (supprimer sa seule étape) : refus expliqué, pas « pour le moment — nouvel essai automatique » @defaut', async ({ page, bureau, marque, moniteur }) => {
    /* Une règle NÉE DANS L'ÉDITEUR : son champ `actions` porte l'action provisoire « À compléter », que le
       serveur compte pour un parcours vide. (Avec `actions` = le vrai texto — ce que posait `creerParcours` —
       le serveur accepte `steps: []` : la règle retombe au « format d'origine » et le refus attendu ici
       n'arrive jamais. Ce cas-là est un autre défaut, porté par 05b « converti … la dernière étape ».) */
    const r = await creerParcours(bureau, `${marque} publiée vidée`, [
      { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto ALPHA' } }, suivant: null },
    ], { is_active: true, actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] });
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/422 PATCH .*\/api\/automations\/rules\//, 'le serveur refuse de casser une automatisation publiée');
    await menuDeCarte(page, 'Texto ALPHA').click();
    await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
    await dialogue(page).getByRole('button', { name: 'Supprimer' }).click();
    const toast = toasts(page).filter({ hasText: /Cette automatisation est publiée/ });
    await expect(toast).toBeVisible({ timeout: 40_000 });
    const message = await toast.innerText();
    await page.screenshot({ path: `${CAPTURES}/edt-s04-publiee-cassee.png` });
    // La base est protégée : la règle publiée a toujours son étape.
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA']);
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(true);
    expect(message, `toast : « ${message} »`).not.toContain('nouvel essai automatique');
  });
});

test.describe('deux onglets sur la même automatisation (S-13)', () => {
  test('[EDT-012] le second onglet n’écrase pas en silence ce que le premier vient d’enregistrer @defaut', async ({ page, bureau, marque, autreOnglet }) => {
    const r = await creerParcours(bureau, `${marque} deux onglets`, troisTextos());
    await ouvrirEditeur(page, r.id);
    const autre = await autreOnglet();
    await ouvrirEditeur(autre.page, r.id);
    await modifier(page, 'Texto ALPHA', 'ALPHA modifié dans l’onglet 1');
    await attendreEnregistre(page, 60_000);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['ALPHA modifié dans l’onglet 1', 'Texto BRAVO', 'Texto CHARLIE']);
    // L'onglet 2, ouvert AVANT, modifie une AUTRE étape.
    await carte(autre.page, 'Texto CHARLIE').click();
    await panneauEtape(autre.page).getByLabel(/Texte du message/).fill('CHARLIE modifié dans l’onglet 2');
    await panneauEtape(autre.page).getByRole('button', { name: 'Enregistrer' }).click();
    const averti = dialogue(autre.page).or(toasts(autre.page).filter({ hasText: /modifi|autre onglet|recharg|conflit/i })).first();
    await expect(indicateur(autre.page).filter({ hasText: 'Enregistré' }).or(averti).first()).toBeVisible({ timeout: 60_000 });
    const fil = await corpsDuFil(bureau, r.id);
    await autre.page.screenshot({ path: `${CAPTURES}/edt-s13-deux-onglets.png` });
    expect(fil.includes('ALPHA modifié dans l’onglet 1') || await averti.isVisible(),
      `la modification de l’onglet 1 a disparu de la base sans avertissement (base : ${fil.join(' / ')})`).toBe(true);
  });
});
