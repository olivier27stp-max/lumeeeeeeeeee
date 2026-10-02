/**
 * LISTE — le dialogue de confirmation (supprimer, supprimer définitivement,
 * supprimer un dossier, tout arrêter…).
 *
 * Ce que ce fichier prouve :
 *  · c'est un vrai dialogue (rôle, titre, message reliés) ;
 *  · le focus arrive sur « Annuler » : Entrée par réflexe n'exécute jamais
 *    l'action ; Échap et un clic sur le fond annulent aussi ;
 *  · le bouton d'une action destructrice est rouge ;
 *  · au clavier : Tab passe d'« Annuler » au bouton d'action, Entrée le
 *    déclenche ; le focus reste dans le dialogue et revient d'où il est parti.
 */
import {
  test, expect, creerRegle, lireRegle, ouvrirListe, chercher, ligne, toast, boutonActions, couleurDeFond, activerClientInactif,
} from './_aides';

async function ouvrirSuppression(page: import('@playwright/test').Page, nom: string) {
  await boutonActions(page, nom).click();
  await page.getByRole('menuitem', { name: 'Supprimer' }).click();
  const dialogue = page.getByRole('dialog', { name: 'Supprimer cette automatisation ?' });
  await expect(dialogue).toBeVisible();
  return dialogue;
}

test.describe('dialogue de confirmation', () => {
  test('[LST-093][LST-094] un vrai dialogue : titre et message reliés, « Annuler » puis l’action, bouton rouge pour une suppression', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} dialogue` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const dialogue = await ouvrirSuppression(page, r.name);
    await expect(dialogue).toHaveAttribute('aria-modal', 'true');
    await expect(dialogue).toHaveAccessibleDescription(new RegExp(`part à la corbeille`));
    await expect(dialogue.getByRole('button')).toHaveText(['Annuler', 'Supprimer']);
    // Rouge = destructif. La couleur est PEINTE puis relue : le navigateur l'écrit en `oklch(…)`, pas en `rgb(…)`.
    const [rouge, vert, bleu] = await couleurDeFond(dialogue.getByRole('button', { name: 'Supprimer', exact: true }));
    expect(rouge).toBeGreaterThan(180);
    expect(vert).toBeLessThan(90);
    expect(bleu).toBeLessThan(90);
    await dialogue.getByRole('button', { name: 'Annuler' }).click();
  });

  test('[LST-097] le focus arrive sur « Annuler » : Entrée par réflexe ne supprime rien', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} entree` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const dialogue = await ouvrirSuppression(page, r.name);
    await expect(dialogue.getByRole('button', { name: 'Annuler' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialogue).toHaveCount(0);
    await expect(ligne(page, r.name)).toBeVisible();
    await expect(toast(page, 'Automatisation mise à la corbeille')).toHaveCount(0);
    expect((await lireRegle(bureau, r.id))?.deleted_at).toBeNull();
  });

  test('[LST-095] Échap annule', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} echap` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const dialogue = await ouvrirSuppression(page, r.name);
    await page.keyboard.press('Escape');
    await expect(dialogue).toHaveCount(0);
    await expect(ligne(page, r.name)).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.deleted_at).toBeNull();
  });

  test('[LST-096] un clic sur le fond annule ; un clic DANS la carte ne ferme rien', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} fond` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const dialogue = await ouvrirSuppression(page, r.name);
    await dialogue.getByRole('heading').click();
    await expect(dialogue).toBeVisible();
    await page.mouse.click(20, 20);
    await expect(dialogue).toHaveCount(0);
    await expect(ligne(page, r.name)).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.deleted_at).toBeNull();
  });

  test('[LST-094][LST-097] au clavier : Tab va d’« Annuler » à « Supprimer », Entrée supprime', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} clavier` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const dialogue = await ouvrirSuppression(page, r.name);
    await page.keyboard.press('Tab');
    await expect(dialogue.getByRole('button', { name: 'Supprimer', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toast(page, 'Automatisation mise à la corbeille')).toBeVisible();
    await expect.poll(async () => (await lireRegle(bureau, r.id))?.deleted_at ?? null).not.toBeNull();
  });

  test('[LST-093] le focus reste dans le dialogue (Tab ne part pas dans la page derrière) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerRegle(bureau, bureau.orgA, { name: `${marque} piege` });
    await ouvrirListe(page);
    await chercher(page, marque);
    const dialogue = await ouvrirSuppression(page, r.name);
    try {
      for (let i = 0; i < 4; i += 1) {
        await page.keyboard.press('Tab');
        const dedans = await dialogue.evaluate((d) => d.contains(document.activeElement));
        expect(dedans, `après ${i + 1} Tab, le focus est encore dans le dialogue`).toBe(true);
      }
    } finally {
      await page.keyboard.press('Escape');
    }
  });

  test('[LST-093][LST-095] à la fermeture, le focus revient sur le bouton qui a ouvert le dialogue @defaut', async ({ page, bureau }) => {
    void bureau;
    await ouvrirListe(page);
    const arreter = page.getByRole('button', { name: 'Tout arrêter' });
    await arreter.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Le focus retombe sur le corps de la page : au clavier, on repart du tout début.
    await expect(arreter).toBeFocused({ timeout: 5_000 });
  });

  test('[LST-097] S-16 : « Activer « Client inactif » ? » — Entrée par réflexe n’active pas', async ({ page, bureau, marque, jetonDe, baseURL }) => {
    // La capacité vit derrière un drapeau d'entreprise, absent d'un bureau de test neuf (sans lui : 404 sur le décompte).
    await activerClientInactif(bureau, String(baseURL), await jetonDe('proprioA'));
    const r = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} inactifs`, trigger_event: 'client.inactive', conditions: { mois: 6 }, actions: [],
      steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour, cela fait longtemps.' } } }],
    });
    await ouvrirListe(page);
    await chercher(page, marque);
    await page.getByRole('switch', { name: `Publier ${r.name}` }).click();
    const dialogue = page.getByRole('dialog', { name: 'Activer « Client inactif » ?' });
    await expect(dialogue.getByRole('button', { name: 'Annuler' })).toBeFocused();
    // Un bouton non destructif : ni rouge, ni déclenché par un Entrée réflexe.
    // (Comparée à `rgb(220, 38, 38)`, la couleur — écrite en `oklch(…)` — passait toujours : on la peint et on la relit.)
    const [rouge, vert, bleu] = await couleurDeFond(dialogue.getByRole('button', { name: 'Activer' }));
    expect(rouge > 180 && vert < 90 && bleu < 90, `« Activer » n’est pas rouge (rgb ${rouge}, ${vert}, ${bleu})`).toBe(false);
    await page.keyboard.press('Enter');
    await expect(dialogue).toHaveCount(0);
    expect((await lireRegle(bureau, r.id))?.is_active).toBe(false);
  });
});
