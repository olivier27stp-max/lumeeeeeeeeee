/**
 * [A] L'éditeur d'une automatisation pendant que Lumi la modifie — mission, points 1 et 3.
 * AU VRAI NAVIGATEUR (Chromium), sur le geste exact du propriétaire :
 *
 *   1. il choisit « Envoyer un texto » dans le tiroir : l'étape naît avec le texte d'exemple
 *      et SON PANNEAU S'OUVRE à droite ;
 *   2. sans y toucher, il écrit à Lumi (à gauche) : « change le message de l'automatisation » ;
 *   3. Lumi répond l'avoir fait et cite le nouveau texte.
 *
 *  · [A-01] le panneau resté ouvert garde l'ANCIEN texte (« aucun changement visible ») ; un clic
 *    sur « Enregistrer » y remet l'ancien texte par-dessus celui de Lumi, sans un mot ; le fermer
 *    demande « Fermer sans enregistrer ? » alors que rien n'y a été tapé ;
 *  · [A-04] la réponse de Lumi RENOMME l'automatisation sans qu'on l'ait demandé ;
 *  · [A-12] un message de moins de 10 caractères (« active-la », « oui », « non ») ne s'envoie pas.
 *
 * La réponse de la route `/generer` est INTERCEPTÉE (texte fixe) : ce fichier éprouve l'écran,
 * pas le modèle — le vrai modèle est joué par scripts/qa/finale/a/repro-bug1-panneau.mts
 * (variantes « frais », « ouvert », « ferme ») et jouer-conversations.mts.
 *
 * Projet `a-ui` de tests/automations-finale/a/vitest.config.ts (API et Vite démarrés par le harnais).
 */
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Page } from '@playwright/test';
import { admin, avecCapture, fermerNavigateur, lireRegle, marqueUi, nettoyer, ouvrirOnglet, type Onglet } from '../../../automations-suite/harnais/navigateur';

const ORG = () => inject('uiOrgA');
const MARQUE = marqueUi('lumi-panneau');
const UUID = /\/automations\/([0-9a-f-]{36})/;
const EXEMPLE = 'Bonjour [client_name], c’est [company_name]. Merci !';
const DE_LUMI = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard. Réglez-la ici : [invoice_link]. [company_name]';

let o: Onglet;
const crees: string[] = [];
beforeAll(async () => {
  o = await ouvrirOnglet();
  // Vite compile l'application à la première visite (plus d'une minute à froid sur un poste chargé) :
  // on paie ce délai ici, pas dans le premier test.
  await o.page.goto(`${o.base}/automations`, { timeout: 240_000, waitUntil: 'domcontentloaded' });
  await o.page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 240_000 });
}, 300_000);
afterEach(async () => { await o?.page.unrouteAll({ behavior: 'ignoreErrors' }); });
afterAll(async () => {
  await o?.fermer();
  await fermerNavigateur();
  await nettoyer(ORG(), MARQUE);
  // Une règle renommée par l'écran a perdu la marque : ménage par identifiant.
  if (crees.length) {
    const maintenant = new Date().toISOString();
    await admin.from('automation_rules').update({ is_active: false, deleted_at: maintenant, purged_at: maintenant }).in('id', crees);
  }
});

const panneau = (page: Page) => page.getByRole('complementary', { name: 'Modifier l’étape' });
const etat = (page: Page) => page.locator('header span.text-xs').last();
async function attendreEnregistre(page: Page): Promise<void> {
  await expect.poll(async () => (await etat(page).textContent())?.trim(), { timeout: 40_000 }).toBe('Enregistré');
}
async function choisirDansTiroir(page: Page, titre: 'Actions' | 'Déclencheurs', choix: string): Promise<void> {
  const t = page.getByRole('complementary', { name: titre });
  await t.waitFor();
  await t.getByRole('searchbox').fill(choix);
  await t.getByRole('button', { name: new RegExp(`^${choix}`) }).first().click();
}

/** La réponse de Lumi, fixe : le même parcours, le texto réécrit (même id d'étape, comme le vrai modèle). */
async function lumiRepond(page: Page, nom: string): Promise<void> {
  await page.route('**/api/automations/rules/generer', async (route) => {
    const corps = JSON.parse(route.request().postData() ?? '{}') as { parcours_actuel?: { trigger_event?: string; steps?: Array<Record<string, unknown>> } };
    const steps = (corps.parcours_actuel?.steps ?? []).map((e) => (e.type === 'action' ? { ...e, action: { type: 'send_sms', config: { body: DE_LUMI } } } : e));
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ nom, trigger_event: corps.parcours_actuel?.trigger_event ?? 'invoice.overdue', resume: `J’ai remplacé le texte d’exemple par un vrai texto de relance.\n\nNouveau texte :\n• Texto : « ${DE_LUMI} »`, steps, autre: null }),
    });
  });
}

/** Le geste du propriétaire : « Facture en retard », puis « Envoyer un texto » — le panneau reste ouvert. */
async function creerAvecPanneauOuvert(page: Page, base: string, nom: string): Promise<string> {
  await page.goto(`${base}/automations/nouvelle`);
  await page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur/ }).waitFor({ timeout: 90_000 });
  await page.getByRole('button', { name: /Nouvelle automatisation/ }).click();
  const champNom = page.getByRole('textbox', { name: 'Nom de l’automatisation' });
  await champNom.fill(nom);
  await champNom.press('Enter');
  await page.waitForURL(UUID, { timeout: 30_000 });
  const id = page.url().match(UUID)![1];
  crees.push(id);
  await page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur/ }).click();
  await choisirDansTiroir(page, 'Déclencheurs', 'Facture en retard');
  await expect.poll(async () => (await lireRegle(id)).trigger_event).toBe('invoice.overdue');
  await page.getByRole('button', { name: /Ajouter une première étape/ }).click();
  await choisirDansTiroir(page, 'Actions', 'Envoyer un texto');
  await panneau(page).waitFor();
  await attendreEnregistre(page);
  return id;
}

async function demanderALumi(page: Page, demande: string): Promise<void> {
  await page.getByLabel('Décris ton automatisation').fill(demande);
  await page.getByRole('button', { name: /^(Construire|Envoyer)$/ }).click();
  await page.getByRole('complementary', { name: 'Clavardage avec Lumi' }).getByText('Nouveau texte', { exact: false }).waitFor({ timeout: 30_000 });
}

const texteDuParcours = async (id: string): Promise<string> => {
  const etape = ((await lireRegle(id)).steps ?? [])[0] as { action?: { config?: { body?: string } } } | undefined;
  return String(etape?.action?.config?.body ?? '');
};

describe('[A-01] Lumi modifie l’étape dont le panneau est ouvert', () => {
  it('le panneau ouvert montre le texte que Lumi vient d’écrire — pas l’ancien', async () => {
    await avecCapture(o, 'A-01-panneau', async () => {
      const nom = `${MARQUE} relance`;
      const id = await creerAvecPanneauOuvert(o.page, o.base, nom);
      expect(await panneau(o.page).getByLabel(/Texte du message/).inputValue()).toBe(EXEMPLE);
      await lumiRepond(o.page, nom);
      await demanderALumi(o.page, 'change le message de l’automatisation');
      // L'enregistrement automatique pose le texte de Lumi en base…
      await expect.poll(() => texteDuParcours(id), { timeout: 30_000 }).toBe(DE_LUMI);
      // … et le panneau, resté ouvert, doit le montrer. ROUGE aujourd'hui : il garde le texte d'exemple
      // (PanneauEtape ne recharge son brouillon que si l'identifiant de l'étape change).
      expect(await panneau(o.page).getByLabel(/Texte du message/).inputValue()).toBe(DE_LUMI);
    });
  });

  it('« Enregistrer » dans le panneau resté ouvert n’écrase pas le texte de Lumi', async () => {
    await avecCapture(o, 'A-01-ecrasement', async () => {
      const nom = `${MARQUE} écrasement`;
      const id = await creerAvecPanneauOuvert(o.page, o.base, nom);
      await lumiRepond(o.page, nom);
      await demanderALumi(o.page, 'change le message de l’automatisation');
      await expect.poll(() => texteDuParcours(id), { timeout: 30_000 }).toBe(DE_LUMI);
      // Le propriétaire n'a rien tapé dans le panneau : il clique « Enregistrer » pour le fermer.
      await panneau(o.page).getByRole('button', { name: 'Enregistrer' }).click();
      await panneau(o.page).waitFor({ state: 'hidden' });
      await attendreEnregistre(o.page);
      // ROUGE aujourd'hui : la base revient à « Bonjour [client_name], c’est [company_name]. Merci ! ».
      expect(await texteDuParcours(id)).toBe(DE_LUMI);
    });
  });

  it('fermer le panneau sans y avoir rien tapé ne demande pas « Fermer sans enregistrer ? »', async () => {
    await avecCapture(o, 'A-01-fermeture', async () => {
      const nom = `${MARQUE} fermeture`;
      await creerAvecPanneauOuvert(o.page, o.base, nom);
      await lumiRepond(o.page, nom);
      await demanderALumi(o.page, 'change le message de l’automatisation');
      await o.page.waitForTimeout(4000);
      await panneau(o.page).getByRole('button', { name: 'Fermer le panneau' }).click();
      await o.page.waitForTimeout(700);
      // ROUGE aujourd'hui : « Les modifications de cette étape ne sont pas enregistrées : elles seront perdues. »
      expect(await o.page.getByRole('dialog').filter({ hasText: 'Fermer sans enregistrer' }).count()).toBe(0);
    });
  });
});

describe('[A-04] Lumi ne renomme pas une automatisation qu’on lui demande seulement de modifier', () => {
  it('le nom donné par l’utilisateur survit à « change le message »', async () => {
    await avecCapture(o, 'A-04-nom', async () => {
      const nom = `${MARQUE} Mauvais payeurs — Longueuil`;
      const id = await creerAvecPanneauOuvert(o.page, o.base, nom);
      await panneau(o.page).getByRole('button', { name: 'Enregistrer' }).click();
      await panneau(o.page).waitFor({ state: 'hidden' });
      // Ce que le vrai modèle renvoie (mesuré : D01, D02, D04 de demandes-modification.json) : un nom à lui.
      await lumiRepond(o.page, 'Relance facture en retard');
      await demanderALumi(o.page, 'change le message de l’automatisation');
      await expect.poll(() => texteDuParcours(id), { timeout: 30_000 }).toBe(DE_LUMI);
      // ROUGE aujourd'hui : l'éditeur applique `propose.nom` sans condition (AutomationBuilderPage.construireAvecLumi).
      expect((await lireRegle(id)).name).toBe(nom);
    });
  });
});

describe('[A-12] une conversation accepte les réponses courtes', () => {
  it('« active-la » (9 caractères) peut être envoyé à Lumi depuis l’éditeur', async () => {
    await avecCapture(o, 'A-12-court', async () => {
      const nom = `${MARQUE} court`;
      await creerAvecPanneauOuvert(o.page, o.base, nom);
      await panneau(o.page).getByRole('button', { name: 'Enregistrer' }).click();
      await panneau(o.page).waitFor({ state: 'hidden' });
      await lumiRepond(o.page, nom);
      await demanderALumi(o.page, 'change le message de l’automatisation');
      await o.page.getByLabel('Décris ton automatisation').fill('active-la');
      // ROUGE aujourd'hui : le bouton reste grisé sous 10 caractères — « oui », « non », « active-la » ne partent pas.
      expect(await o.page.getByRole('button', { name: 'Envoyer', exact: true }).isDisabled()).toBe(false);
    });
  });
});
