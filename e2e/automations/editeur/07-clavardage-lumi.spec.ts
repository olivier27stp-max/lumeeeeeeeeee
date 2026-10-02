/**
 * Éditeur — le clavardage « Construire avec Lumi » (INTERFACE seulement).
 *
 * Lumi n'est pas branché sur cette instance. Ce fichier prouve :
 *  · ce que l'écran dit et fait quand Lumi ne répond pas (message, brouillon vide retiré, rien de cassé) ;
 *  · la carte, les pastilles, le bouton, Entrée / Maj+Entrée ;
 *  · le panneau latéral (fil gardé avec l'automatisation), le repli et le bouton flottant ;
 *  · la carte « inclus dans Autopilot » quand le forfait n'a pas Lumi.
 * Les tests marqués « réponse simulée » remplacent la SEULE réponse de `/rules/generer`
 * (page.route) pour exercer ce que l'éditeur fait d'une proposition : le reste est réel.
 */
import type { Page } from '@playwright/test';
import { lireRegle, reglesParNom, type Bureau, type LigneRegle } from '../_outils/banc';
import {
  test, expect, DELAI_TEST,
  CAPTURES, creerParcours, troisTextos, texto, ouvrirEditeur, cartes, barre, indicateur, attendreEnregistre,
  attendreRegle, corpsDuFil, toasts, dialogue, tiroirActions, panneauEtape,
  aucuneEcriture, rendreIncomplet, troisTextosEtUneIncomplete, carte,
} from './_aides';

test.describe.configure({ timeout: DELAI_TEST });

const champ = (page: Page) => page.getByRole('textbox', { name: 'Décris ton automatisation' });
const DEMANDE = 'Après un devis, attends 2 jours puis envoie un texto de suivi.';

async function neesDepuis(bureau: Bureau, depuis: string): Promise<LigneRegle[]> {
  const { data } = await bureau.admin.from('automation_rules').select('*').eq('org_id', bureau.orgA).gte('created_at', depuis);
  return (data ?? []) as LigneRegle[];
}

test.describe('Lumi — la carte et le champ', () => {
  test('[EDT-134][EDT-024][EDT-025][EDT-026][EDT-027] la carte, son champ, ses 4 pastilles : chacune remplit le champ sans rien envoyer', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lumi carte`, troisTextos());
    let envois = 0;
    await page.route('**/api/automations/rules/generer', (route) => { envois += 1; return route.continue(); });
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Décris ton automatisation à Lumi')).toBeVisible();
    await expect(champ(page)).toHaveAttribute('placeholder', /Après l’envoi d’un devis, attends 24 h puis envoie un texto de suivi/);
    await expect(page.getByText('Déduit de tes crédits Lumi')).toBeVisible();
    const attendus: Array<[string, string]> = [
      ['Relance de devis', 'Après l’envoi d’un devis, attends 3 jours puis envoie un texto de suivi si le client n’a pas répondu.'],
      ['Rappel de rendez-vous', 'La veille d’un rendez-vous, envoie un texto de rappel au client avec l’heure.'],
      ['Facture en retard', 'Quand une facture dépasse son échéance, envoie un courriel poli, puis relance 7 jours plus tard.'],
      ['Demande d’avis', 'Deux jours après un job terminé, demande un avis au client par texto.'],
    ];
    for (const [pastille, texte] of attendus) {
      await page.getByRole('button', { name: pastille, exact: true }).click();
      await expect(champ(page)).toHaveValue(texte);
    }
    await expect(page.getByRole('button', { name: 'Construire' })).toBeEnabled();
    expect(envois).toBe(0);
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-135][EDT-136][EDT-137] moins de 10 caractères : bouton grisé, Entrée n’envoie rien ; Maj+Entrée va à la ligne', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lumi court`, troisTextos());
    let envois = 0;
    await page.route('**/api/automations/rules/generer', (route) => { envois += 1; return route.continue(); });
    await ouvrirEditeur(page, r.id);
    await expect(page.getByRole('button', { name: 'Construire' })).toBeDisabled();
    await champ(page).fill('relance');
    await expect(page.getByRole('button', { name: 'Construire' })).toBeDisabled();
    await champ(page).press('Enter');
    await expect(champ(page)).toHaveValue('relance');
    await champ(page).press('Shift+Enter');
    await champ(page).pressSequentially('x');
    await expect(champ(page)).toHaveValue('relance\nx');
    expect(envois).toBe(0);
    await expect(page.getByText('Lumi construit…')).toHaveCount(0);
  });

  test('[EDT-134] à l’ouverture d’un parcours de 3 étapes (1440×900), la carte de Lumi ne repousse pas le parcours sous l’écran', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lumi place`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await expect(page.getByRole('button', { name: /Texto ALPHA/ })).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/edt-134-lumi-prend-la-place.png` });
    const carteLumi = await page.getByText('Décris ton automatisation à Lumi').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').boundingBox();
    const derniere = page.getByRole('button', { name: /Texto CHARLIE/ });
    expect(carteLumi, 'la carte de Lumi est à l’écran').toBeTruthy();
    test.info().annotations.push({ type: 'hauteur-carte-lumi-px', description: String(Math.round(carteLumi!.height)) });
    await expect(derniere, `la carte de Lumi occupe ${Math.round(carteLumi!.height)} px en tête du canevas : la 3e étape d’un parcours de 3 étapes est sous l’écran`).toBeInViewport({ ratio: 1, timeout: 3000 });
  });

  test('[EDT-137] sous 10 caractères, l’écran dit POURQUOI le bouton est grisé (S-30) @defaut', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lumi pourquoi`, troisTextos());
    await ouvrirEditeur(page, r.id);
    await champ(page).fill('relance');
    await champ(page).press('Enter');
    const bouton = page.getByRole('button', { name: 'Construire' });
    const explication = page.getByText(/au moins 10|10 caractères|une phrase|plus de détail/i).or(page.locator('[role="alert"]')).first();
    const titre = (await bouton.getAttribute('title')) ?? '';
    expect((await explication.isVisible()) || titre.length > 0, 'bouton grisé et Entrée sans effet, sans un mot : on croit Lumi en panne').toBe(true);
  });
});

test.describe('Lumi — quand Lumi ne répond pas (instance sans IA)', () => {
  test('[EDT-137] envoyer une demande sur un parcours existant : message compréhensible en français, rien n’est cassé ni réécrit', async ({ page, bureau, marque, moniteur }) => {
    const r = await creerParcours(bureau, `${marque} lumi panne`, troisTextos());
    await ouvrirEditeur(page, r.id);
    moniteur.attendu(/4\d\d POST .*\/api\/automations\/rules\/generer|5\d\d POST .*\/api\/automations\/rules\/generer/, 'Lumi n’est pas branché sur cette instance');
    await champ(page).fill(DEMANDE);
    await page.getByRole('button', { name: 'Construire' }).click();
    const toast = toasts(page).first();
    await expect(toast).toBeVisible({ timeout: 90_000 });
    const message = (await toast.innerText()).trim();
    await page.screenshot({ path: `${CAPTURES}/edt-137-lumi-indisponible.png` });
    test.info().annotations.push({ type: 'message-lumi-indisponible', description: message });
    // Un message en français, sans jargon : ni clé d'API, ni nom de fournisseur, ni code d'erreur, ni anglais.
    expect(message, `message montré : « ${message} »`).not.toMatch(/api[ _-]?key|anthropic|claude|undefined|null|exception|stack|HTTP \d|ANTHROPIC|internal|missing|not configured|error/i);
    expect(message).toMatch(/[éèàêç’]|Lumi/);
    // L'écran revient à un état utilisable : bouton réactivé, demande gardée, canevas intact.
    await expect(page.getByRole('button', { name: 'Construire' })).toBeEnabled({ timeout: 30_000 });
    await expect(champ(page)).toHaveValue(DEMANDE);
    await expect(page.getByText('Lumi construit…')).toHaveCount(0);
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE']);
    await expect(indicateur(page)).toHaveText('Enregistré');
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);
  });

  test('[EDT-137] envoyer une demande sur une NOUVELLE automatisation : aucun brouillon vide ne reste en base @defaut', async ({ page, bureau, moniteur }) => {
    const depuis = new Date().toISOString();
    await page.goto('/automations/nouvelle?lumi=1');
    await expect(page.getByRole('tablist', { name: 'Sections' })).toBeVisible({ timeout: 90_000 });
    // « Construire avec Lumi » place le curseur dans le champ.
    await expect(champ(page)).toBeFocused();
    moniteur.attendu(/4\d\d POST .*\/api\/automations\/rules\/generer|5\d\d POST .*\/api\/automations\/rules\/generer/, 'Lumi n’est pas branché sur cette instance');
    await champ(page).fill(DEMANDE);
    await champ(page).press('Enter');
    await expect(toasts(page).first()).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('button', { name: 'Construire' })).toBeEnabled({ timeout: 30_000 });
    // L'éditeur redevient un brouillon local.
    await expect(page).toHaveURL(/\/automations\/nouvelle\?lumi=1$/, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Ajouter une première étape' })).toBeVisible();
    const restes = await neesDepuis(bureau, depuis);
    if (restes.length) await bureau.admin.from('automation_rules').delete().in('id', restes.map((x) => x.id));
    // Ce que le correctif L-7 garantit : aucun brouillon VIVANT ne reste dans la liste, et rien n'est publié.
    expect(restes.filter((x) => !x.deleted_at).map((x) => x.name), 'un brouillon vide VIVANT est resté dans la liste après l’échec de Lumi').toEqual([]);
    expect(restes.filter((x) => x.is_active)).toEqual([]);
    /* Ce qui reste : le serveur « retire » le brouillon par une suppression DOUCE (`retirerBrouillonVide`,
       server/routes/automation-rules.ts) — la ligne part à la corbeille, où l'onglet « Corbeille » de la
       liste la montre sous « Nouvelle automatisation ». Une de plus à chaque demande qui échoue. */
    expect(restes.map((x) => `${x.name}${x.deleted_at ? ' (à la corbeille)' : ''}`),
      'le brouillon vide né de la demande reste en base, à la CORBEILLE : l’onglet « Corbeille » de la liste montre une « Nouvelle automatisation » que personne n’a créée ni supprimée').toEqual([]);
  });
});

test.describe('Lumi — panneau latéral (fil gardé avec l’automatisation)', () => {
  const fil = [
    { role: 'user', content: 'Relance mes devis après 3 jours.' },
    { role: 'assistant', content: 'J’ai construit une relance de devis en deux textos.' },
  ];

  test('[EDT-138][EDT-020][EDT-134] le fil s’affiche à gauche, se replie, se redéplie avec le curseur dans le champ', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lumi fil`, troisTextos(), { lumi_conversation: fil });
    await ouvrirEditeur(page, r.id);
    const panneau = page.getByRole('complementary', { name: 'Clavardage avec Lumi' });
    await expect(panneau).toBeVisible();
    await expect(panneau.getByText('Lumi — ce parcours')).toBeVisible();
    await expect(panneau.getByText('Relance mes devis après 3 jours.')).toBeVisible();
    await expect(panneau.getByText('J’ai construit une relance de devis en deux textos.')).toBeVisible();
    await expect(champ(page)).toHaveAttribute('placeholder', 'Change le délai du deuxième message à 2 jours. Retire le courriel.');
    await expect(panneau.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
    // Les pastilles de départ ne sont plus proposées une fois la conversation engagée.
    await expect(page.getByRole('button', { name: 'Relance de devis', exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${CAPTURES}/edt-138-lumi-lateral.png` });

    await panneau.getByRole('button', { name: 'Replier le clavardage' }).click();
    await expect(panneau).toHaveCount(0);
    const flottant = page.getByRole('button', { name: 'Lumi', exact: true }).last();
    await expect(flottant).toBeVisible();
    await flottant.click();
    await expect(panneau).toBeVisible();
    await expect(champ(page)).toBeFocused();
    await expect(panneau.getByText('Relance mes devis après 3 jours.')).toBeVisible();
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-020] le canevas reste utilisable avec le fil ouvert ET un panneau d’étape (1440 px)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lumi largeur`, troisTextos(), { lumi_conversation: fil });
    await ouvrirEditeur(page, r.id);
    await page.getByRole('button', { name: /Texto BRAVO/ }).click();
    await expect(panneauEtape(page)).toBeVisible();
    const carteB = await page.getByRole('button', { name: /Texto BRAVO/ }).boundingBox();
    const lumi = await page.getByRole('complementary', { name: 'Clavardage avec Lumi' }).boundingBox();
    const droite = await panneauEtape(page).boundingBox();
    expect(carteB && lumi && droite).toBeTruthy();
    // La carte en cours d'édition est entièrement visible entre les deux panneaux.
    expect(carteB!.x).toBeGreaterThanOrEqual(lumi!.x + lumi!.width - 1);
    expect(carteB!.x + carteB!.width).toBeLessThanOrEqual(droite!.x + 1);
  });
});

test.describe('Lumi — ce que l’éditeur fait d’une proposition (réponse simulée)', () => {
  const proposition = (marque: string, plus: Record<string, unknown> = {}) => ({
    nom: `${marque} proposée par Lumi`,
    trigger_event: 'quote.sent',
    resume: 'Relance de devis : un texto après 2 jours.',
    steps: [
      { id: 'e1', type: 'attendre', delai_secondes: 172800, suivant: 'e2' },
      { id: 'e2', type: 'action', action: { type: 'send_sms', config: { body: 'Texto de LUMI' } }, suivant: null },
    ],
    ...plus,
  });

  test('[EDT-137][EDT-053] pendant la génération puis après : bulle, « Lumi construit… », parcours posé, résumé qui se ferme, enregistré en base', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lumi propose`, [texto('e1', 'Texto ALPHA', null)]);
    let liberer: () => void = () => undefined;
    const retenue = new Promise<void>((res) => { liberer = res; });
    await page.route('**/api/automations/rules/generer', async (route) => {
      await retenue;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(proposition(marque)) });
    });
    await ouvrirEditeur(page, r.id);
    await champ(page).fill(DEMANDE);
    await page.getByRole('button', { name: 'Construire' }).click();
    const panneau = page.getByRole('complementary', { name: 'Clavardage avec Lumi' });
    await expect(panneau.getByText(DEMANDE).first()).toBeVisible();
    await expect(panneau.getByText('Lumi construit…').first()).toBeVisible();
    await expect(panneau.getByRole('button', { name: 'Lumi construit…' })).toBeDisabled();
    await page.screenshot({ path: `${CAPTURES}/edt-137-lumi-construit.png` });
    liberer();
    await expect(toasts(page).filter({ hasText: 'Lumi a construit le parcours — en pause, à publier quand tu es prêt.' })).toBeVisible({ timeout: 30_000 });
    expect(await cartes(page)).toEqual(['Attendre | 2 jour(s)', 'Envoyer un texto | Texto de LUMI']);
    await expect(barre(page).getByRole('button', { name: `${marque} proposée par Lumi` })).toBeVisible();
    await expect(panneau.getByText('Relance de devis : un texto après 2 jours.')).toBeVisible();
    await expect(champ(page)).toHaveValue('');
    /* Le résumé flottant (EDT-053) et sa croix. Depuis le 2026-10-01 (AutomationBuilderPage.tsx,
       `resumeLumi && !(lumiLateral && !lumiReduit)`), il ne s'affiche PLUS tant que la conversation est
       ouverte à gauche — la réponse y est déjà, en entier ; par-dessus le canevas il cachait la carte du
       déclencheur. Il apparaît quand on replie la conversation. */
    const resume = page.locator('div.absolute').filter({ hasText: 'Relance de devis : un texto après 2 jours.' }).filter({ has: page.getByRole('button', { name: 'Fermer', exact: true }) }).last();
    await expect(panneau).toBeVisible();
    await expect(resume).toHaveCount(0);
    await panneau.getByRole('button', { name: 'Replier le clavardage' }).click();
    await expect(panneau).toHaveCount(0);
    await expect(resume).toBeVisible();
    await expect(resume.getByRole('paragraph')).toHaveText('Relance de devis : un texto après 2 jours.');
    await resume.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect(resume).toHaveCount(0);
    // Rouvrir la conversation : la réponse de Lumi y est toujours.
    await page.getByRole('button', { name: 'Lumi', exact: true }).last().click();
    await expect(panneau.getByText('Relance de devis : un texto après 2 jours.')).toBeVisible();
    // « Annuler » rattrape la proposition.
    await expect(barre(page).getByRole('button', { name: 'Annuler', exact: true })).toBeEnabled();
    await attendreEnregistre(page, 90_000);
    const base = await attendreRegle(bureau, r.id, (x) => JSON.stringify(x.steps).includes('Texto de LUMI'), 60_000);
    expect(base.name).toBe(`${marque} proposée par Lumi`);
    expect(base.is_active).toBe(false);
  });

  test('[EDT-137] sur une automatisation PUBLIÉE, Lumi ne remplace pas le parcours en ligne sans question, et ne dit pas « en pause » (S-03)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} lumi publiée`, troisTextos(), { is_active: true });
    await page.route('**/api/automations/rules/generer', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(proposition(marque, { nom: `${marque} lumi publiée` })) }));
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Publiée', { exact: true })).toBeVisible();
    await champ(page).fill(DEMANDE);
    await page.getByRole('button', { name: 'Construire' }).click();
    const succes = toasts(page).filter({ hasText: /Lumi a construit le parcours/ });
    await expect(succes.or(dialogue(page)).first()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-s03-lumi-sur-publiee.png` });
    const aDemande = await dialogue(page).isVisible();
    const texte = aDemande ? '' : await succes.innerText();
    // Laisser l'enregistrement automatique faire ce qu'il fait, puis juger sur la base.
    if (!aDemande) await attendreEnregistre(page, 90_000);
    const base = await lireRegle(bureau, r.id);
    const remplace = JSON.stringify(base?.steps).includes('Texto de LUMI');
    // `soft` : les DEUX moitiés du défaut sont jugées, la seconde ne se cache plus derrière la première.
    expect.soft(texte, 'le toast dit « en pause, à publier » alors que l’automatisation est publiée').not.toContain('en pause');
    expect(remplace && base?.is_active === true && !aDemande,
      'le parcours d’une automatisation PUBLIÉE a été remplacé et enregistré sans aucune confirmation').toBe(false);

    /* AJOUTÉ à la revérification du 2026-10-02 (correctif 8174ff74) — les attentes ci-dessus sont celles
       d'origine, inchangées. Ce qui suit prouve la question elle-même : son texte, que RIEN n'est écrit tant
       qu'on n'a pas répondu, que « Annuler » laisse le parcours en ligne intact, et que « Appliquer » le
       remplace en le disant sans « en pause ». */
    const TROIS = ['Envoyer un texto | Texto ALPHA', 'Envoyer un texto | Texto BRAVO', 'Envoyer un texto | Texto CHARLIE'];
    await expect(dialogue(page).getByRole('heading', { name: 'Appliquer les changements de Lumi ?' })).toBeVisible();
    await expect(dialogue(page)).toContainText('Cette automatisation est en ligne : appliquer les changements de Lumi ?');
    await expect(dialogue(page)).toContainText('Relance de devis : un texto après 2 jours.');
    await expect(dialogue(page)).toContainText('Ils s’appliqueront dès le prochain déclenchement. Sans votre accord, le parcours en ligne ne change pas.');
    // Question à l'écran, sans réponse : 6 s (deux fois le délai de l'enregistrement automatique) sans aucune écriture.
    await aucuneEcriture(page);
    expect(await cartes(page), 'la proposition est déjà sur le canevas avant la réponse').toEqual(TROIS);
    expect((await lireRegle(bureau, r.id))?.updated_at, 'la règle a été écrite avant la réponse à la question').toBe(r.updated_at);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Texto ALPHA', 'Texto BRAVO', 'Texto CHARLIE']);

    // « Annuler » : rien n'est appliqué, c'est dit, le parcours en ligne est intact.
    await dialogue(page).getByRole('button', { name: 'Annuler' }).click();
    await expect(toasts(page).filter({ hasText: 'Changements de Lumi non appliqués : le parcours en ligne est inchangé.' })).toBeVisible();
    expect(await cartes(page)).toEqual(TROIS);
    await aucuneEcriture(page);
    await expect(indicateur(page)).toHaveText('Enregistré');
    const apresRefus = await lireRegle(bureau, r.id);
    expect(apresRefus?.updated_at).toBe(r.updated_at);
    expect(apresRefus?.is_active).toBe(true);

    // Même demande, « Appliquer » : le parcours de Lumi est mis en ligne, et le message ne dit pas « en pause ».
    await champ(page).fill(DEMANDE);
    await page.getByRole('button', { name: /^(Construire|Envoyer)$/ }).click();
    await expect(dialogue(page).getByRole('heading', { name: 'Appliquer les changements de Lumi ?' })).toBeVisible({ timeout: 30_000 });
    await dialogue(page).getByRole('button', { name: 'Appliquer', exact: true }).click();
    await expect(toasts(page).filter({ hasText: 'Changements de Lumi appliqués — l’automatisation est en ligne : ils valent dès le prochain déclenchement.' })).toBeVisible();
    await expect(toasts(page).filter({ hasText: /en pause/ })).toHaveCount(0);
    expect(await cartes(page)).toEqual(['Attendre | 2 jour(s)', 'Envoyer un texto | Texto de LUMI']);
    await attendreEnregistre(page, 90_000);
    const applique = await attendreRegle(bureau, r.id, (x) => JSON.stringify(x.steps).includes('Texto de LUMI'), 60_000);
    expect(applique.is_active).toBe(true);
    expect(JSON.stringify(applique.steps)).not.toContain('Texto ALPHA');
  });

  test('[EDT-139] « Ouvrir » sur le toast de la 2e automatisation, réseau lent : chacune garde SON parcours et SON nom (S-01)', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} première`, [texto('e1', 'Texto ALPHA', null)]);
    await page.route('**/api/automations/rules/generer', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(proposition(marque, {
        nom: `${marque} première`,
        autre: {
          nom: `${marque} deuxième`, trigger_event: 'client.replied', resume: 'Quand le client répond, envoie le lien.',
          steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Texto de la DEUXIÈME' } }, suivant: null }],
        },
      })) }));
    await ouvrirEditeur(page, r.id);
    // Réseau lent : le chargement d'une AUTRE automatisation met 6 s (plus que les 3 s de l'enregistrement automatique).
    await page.route((url) => url.pathname.endsWith('/api/automations/editeur') && !!url.searchParams.get('rule_id') && url.searchParams.get('rule_id') !== r.id, async (route) => {
      await new Promise((res) => setTimeout(res, 6000));
      await route.continue();
    });
    await champ(page).fill(DEMANDE);
    await page.getByRole('button', { name: 'Construire' }).click();
    const toast = toasts(page).filter({ hasText: `« ${marque} deuxième » créée en brouillon` });
    await expect(toast).toBeVisible();
    // Le toast ne reste que 10 s : on clique tout de suite, comme le ferait l'utilisateur.
    await toast.getByRole('button', { name: 'Ouvrir' }).click();
    const [deuxieme] = await reglesParNom(bureau, bureau.orgA, `${marque} deuxième`);
    expect(deuxieme, 'la 2e automatisation existe en base, en brouillon').toBeTruthy();
    expect(deuxieme.is_active).toBe(false);
    await expect(page).toHaveURL(new RegExp(`/automations/${deuxieme.id}$`));
    await expect(barre(page).getByRole('button', { name: `${marque} deuxième` })).toBeVisible({ timeout: 120_000 });
    await expect(indicateur(page)).toHaveText('Enregistré', { timeout: 90_000 });
    await page.screenshot({ path: `${CAPTURES}/edt-139-ouvrir-deuxieme.png` });
    const premiereApres = await lireRegle(bureau, r.id);
    const deuxiemeApres = await lireRegle(bureau, deuxieme.id);
    expect(deuxiemeApres?.name, 'le nom de la 1re a été écrit dans la 2e').toBe(`${marque} deuxième`);
    expect(JSON.stringify(deuxiemeApres?.steps), 'le parcours de la 1re a été écrit dans la 2e').toContain('Texto de la DEUXIÈME');
    expect(JSON.stringify(deuxiemeApres?.steps)).not.toContain('Texto de LUMI');
    expect(JSON.stringify(premiereApres?.steps), 'le parcours que Lumi venait de poser dans la 1re n’a jamais été enregistré').toContain('Texto de LUMI');
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto de la DEUXIÈME']);
    // AJOUTÉ à la revérification du 2026-10-02 (073e719f) : la 1re garde aussi SON nom, SON déclencheur, et rien de la 2e.
    expect(premiereApres?.name).toBe(`${marque} première`);
    expect(premiereApres?.trigger_event).toBe('quote.sent');
    expect(JSON.stringify(premiereApres?.steps)).not.toContain('Texto de la DEUXIÈME');
    expect(deuxiemeApres?.trigger_event).toBe('client.replied');
    expect((deuxiemeApres?.steps ?? []).length).toBe(1);
    // … et l'éditeur de la 2e reste utilisable : aucune écriture retardataire de la 1re n'y arrive après coup.
    await aucuneEcriture(page);
    const deuxiemeEnfin = await lireRegle(bureau, deuxieme.id);
    expect(deuxiemeEnfin?.name).toBe(`${marque} deuxième`);
    expect(deuxiemeEnfin?.updated_at).toBe(deuxiemeApres?.updated_at);
  });

  /*
   * AJOUTÉ à la revérification du 2026-10-02 — constat A-01 (correctif 2b27e032), le « bug n° 1 » du
   * propriétaire : « Lumi dit avoir changé le message, rien ne change ». Aucun test du dossier ne le portait.
   * Le panneau d'étape resté ouvert gardait l'ancien texte, et son « Enregistrer » le remettait par-dessus
   * celui de Lumi. Comportement décidé : rien de tapé → le panneau prend la version de Lumi ; saisie en cours
   * → un bandeau le dit, laisse choisir, et « Enregistrer » attend ce choix.
   */
  test('[EDT-137][EDT-037] Lumi réécrit le message d’une étape dont le panneau est OUVERT : sans saisie le panneau prend son texte ; avec une saisie en cours il le dit et laisse choisir (A-01)', async ({ page, bureau, marque }) => {
    const nom = `${marque} lumi panneau ouvert`;
    const r = await creerParcours(bureau, nom, [texto('e1', 'Texto ALPHA', null)]);
    const versions = ['Texto de LUMI un', 'Texto de LUMI deux', 'Texto de LUMI trois'];
    let demandes = 0;
    await page.route('**/api/automations/rules/generer', (route) => {
      const corps = versions[Math.min(demandes, versions.length - 1)];
      demandes += 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        nom, trigger_event: 'quote.sent', resume: `Message du texto changé (${demandes}).`,
        steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: corps } }, suivant: null }],
      }) });
    });
    await ouvrirEditeur(page, r.id);
    const zone = panneauEtape(page).getByLabel(/Texte du message/);
    const enregistrer = panneauEtape(page).getByRole('button', { name: 'Enregistrer' });
    const alerte = panneauEtape(page).getByRole('alert');
    const demander = async () => {
      await champ(page).fill('Change le message du texto, plus chaleureux.');
      await page.getByRole('button', { name: /^(Construire|Envoyer)$/ }).click();
    };

    // ── 1. Le geste exact du propriétaire : panneau ouvert, rien de tapé, on demande à Lumi, puis « Enregistrer ».
    await carte(page, 'Texto ALPHA').click();
    await expect(zone).toHaveValue('Texto ALPHA');
    await demander();
    await expect(zone, 'le panneau resté ouvert garde l’ancien texte alors que Lumi l’a changé').toHaveValue('Texto de LUMI un', { timeout: 30_000 });
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto de LUMI un']);
    await expect(alerte).toHaveCount(0);
    await enregistrer.click();
    await attendreEnregistre(page, 90_000);
    expect(await corpsDuFil(bureau, r.id), '« Enregistrer » du panneau a remis l’ancien texte par-dessus celui de Lumi').toEqual(['Texto de LUMI un']);

    // ── 2. Une saisie est en cours dans le panneau quand Lumi change la même étape : rien n'est écrasé, on choisit.
    await carte(page, 'Texto de LUMI un').click();
    await zone.fill('Ma version tapée à la main');
    await demander();
    await expect(alerte).toContainText('Lumi a modifié cette étape pendant que vous l’éditiez.', { timeout: 30_000 });
    await expect(alerte).toContainText('Rien n’est écrasé : choisissez la version à garder.');
    await page.screenshot({ path: `${CAPTURES}/edt-a01-lumi-pendant-la-saisie.png` });
    await expect(zone).toHaveValue('Ma version tapée à la main');
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto de LUMI deux']);
    await expect(enregistrer).toBeDisabled();
    await expect(panneauEtape(page).getByText('Choisissez d’abord quelle version garder.')).toBeVisible();
    await alerte.getByRole('button', { name: 'Voir la version de Lumi' }).click();
    await expect(zone).toHaveValue('Texto de LUMI deux');
    await expect(alerte).toHaveCount(0);
    await expect(enregistrer).toBeEnabled();

    // ── 3. Même situation, « Garder ma version » : c'est elle qui s'enregistre, en connaissance de cause.
    await zone.fill('Ma version, gardée');
    await demander();
    await expect(alerte).toContainText('Lumi a modifié cette étape pendant que vous l’éditiez.', { timeout: 30_000 });
    expect(await cartes(page)).toEqual(['Envoyer un texto | Texto de LUMI trois']);
    await alerte.getByRole('button', { name: 'Garder ma version' }).click();
    await expect(alerte).toHaveCount(0);
    await expect(zone).toHaveValue('Ma version, gardée');
    await enregistrer.click();
    expect(await cartes(page)).toEqual(['Envoyer un texto | Ma version, gardée']);
    await attendreEnregistre(page, 90_000);
    expect(await corpsDuFil(bureau, r.id)).toEqual(['Ma version, gardée']);
    expect(demandes).toBe(3);
  });
});

test.describe('Lumi — forfait sans Lumi', () => {
  async function sansLumi(page: Page): Promise<void> {
    await page.route('**/api/billing/current', async (route) => {
      const reponse = await route.fetch();
      const json = await reponse.json() as { feature_overrides?: Record<string, boolean> };
      json.feature_overrides = { ...(json.feature_overrides ?? {}), includes_ai: false };
      await route.fulfill({ response: reponse, json });
    });
  }

  test('[EDT-023] sans Lumi au forfait : la carte explique et « Voir Autopilot » mène à la facturation', async ({ page, bureau, marque }) => {
    const r = await creerParcours(bureau, `${marque} sans lumi`, troisTextos());
    await sansLumi(page);
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Construire avec Lumi — inclus dans Autopilot')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Décris ton automatisation en une phrase et Lumi la monte pour toi/)).toBeVisible();
    await expect(champ(page)).toHaveCount(0);
    await page.screenshot({ path: `${CAPTURES}/edt-023-sans-lumi.png` });
    // Le reste de l'éditeur marche sans Lumi.
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await expect(tiroirActions(page)).toBeVisible();
    await tiroirActions(page).getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('button', { name: 'Voir Autopilot' }).click();
    await expect(page).toHaveURL(/\/settings\/billing/, { timeout: 30_000 });
    expect((await lireRegle(bureau, r.id))?.updated_at).toBe(r.updated_at);
  });

  test('[EDT-023] « Voir Autopilot » avec une étape incomplète en cours : on demande avant de quitter (S-14) @defaut', async ({ page, bureau, marque }) => {
    /* L'état « étape incomplète » ne s'obtient plus par le tiroir (3b739958) : le parcours de départ en porte
       une, et un texto réécrit ne peut pas s'enregistrer (voir `rendreIncomplet`). L'attente est inchangée. */
    const r = await creerParcours(bureau, `${marque} sans lumi incomplet`, troisTextosEtUneIncomplete());
    await sansLumi(page);
    await ouvrirEditeur(page, r.id);
    await expect(page.getByText('Construire avec Lumi — inclus dans Autopilot')).toBeVisible({ timeout: 60_000 });
    await rendreIncomplet(page);
    await page.getByRole('button', { name: 'Voir Autopilot' }).click();
    await page.screenshot({ path: `${CAPTURES}/edt-s14-voir-autopilot-incomplet.png` });
    await expect(dialogue(page).getByRole('heading', { name: 'Quitter sans enregistrer ?' }),
      'l’éditeur est quitté sans question : l’étape ajoutée est perdue (un toast le dit après coup)').toBeVisible({ timeout: 4000 });
  });
});
