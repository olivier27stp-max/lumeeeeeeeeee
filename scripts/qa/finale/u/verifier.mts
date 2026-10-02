/**
 * Vérifications au vrai navigateur des corrections de l'agent U — une par
 * ligne du triage `actions.md`. Voir `banc.mts`.
 *
 *   QA_AUTO_SUFFIXE=u npx tsx --env-file=.env.local scripts/qa/finale/u/verifier.mts l1 l4 …
 *   (sans argument : tous les scénarios)
 */
import type { Page } from '@playwright/test';
import { admin, carte, creerRegle, fermer, leBureau, lireRegle, ouvrirEditeur, ouvrirPage, panneau, pause, tiroir, verifier } from './banc.mts';

type Etapes = Array<{ id: string; action?: { config?: Record<string, unknown> } } & Record<string, unknown>>;
const etapes = async (id: string): Promise<Etapes> => ((await lireRegle(id)).steps ?? []) as Etapes;
const enregistrer = (page: Page) => panneau(page).getByRole('button', { name: /^(Enregistrer|Save|Save action)$/ });
const action = (type: string, config: Record<string, unknown>, id = 'e1', suivant: string | null = null) => ({ id, type: 'action', action: { type, config }, suivant });

const EXEMPLE = 'Bonjour [client_name], c’est [company_name]. Merci !';
const DE_LUMI = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard. Réglez-la ici : [invoice_link]. [company_name]';
/** La réponse de Lumi, fixe (route interceptée, sans modèle) : le même parcours, le texto réécrit. */
async function lumiReecritLeTexto(page: Page): Promise<void> {
  await page.route('**/api/automations/rules/generer', async (route) => {
    const corps = JSON.parse(route.request().postData() ?? '{}') as { parcours_actuel?: { trigger_event?: string; steps?: Array<Record<string, unknown>> } };
    const steps = (corps.parcours_actuel?.steps ?? []).map((e) => (e.type === 'action' ? { ...e, action: { type: 'send_sms', config: { body: DE_LUMI } } } : e));
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ nom: 'Relance', trigger_event: corps.parcours_actuel?.trigger_event ?? 'invoice.overdue', resume: `J’ai remplacé le texte d’exemple.\n\nNouveau texte :\n• Texto : « ${DE_LUMI} »`, steps, autre: null }),
    });
  });
}
async function demanderALumi(page: Page, demande: string): Promise<void> {
  await page.getByLabel('Décris ton automatisation').fill(demande);
  await page.getByRole('button', { name: /^(Construire|Envoyer)$/ }).click();
  await page.getByText('Nouveau texte', { exact: false }).first().waitFor({ timeout: 30_000 });
}
/** Une automatisation « Facture en retard » sans étape, puis « Envoyer un texto » : le panneau est ouvert. */
async function texteDExempleOuvert(page: Page): Promise<string> {
  const regle = await creerRegle({ trigger_event: 'invoice.overdue', steps: null, actions: [{ type: 'send_sms', config: { body: 'À compléter' } }] });
  await ouvrirEditeur(page, regle.id);
  await page.getByRole('button', { name: /Ajouter une première étape/ }).click();
  await tiroir(page).getByRole('button', { name: /Envoyer un texto/ }).click();
  await panneau(page).waitFor();
  return regle.id;
}
const zoneTexto = (page: Page) => panneau(page).getByLabel('Texte du message *', { exact: true });

const SCENARIOS: Record<string, () => Promise<void>> = {
  /** A-01 — le bug n° 1 : Lumi change le message, le panneau resté ouvert le montre. */
  async a01() {
    const page = await ouvrirPage();
    await lumiReecritLeTexto(page);
    const id = await texteDExempleOuvert(page);
    verifier(await zoneTexto(page).inputValue() === EXEMPLE, 'au départ : le texte d’exemple dans le panneau');
    await demanderALumi(page, 'change le message de l’automatisation');
    verifier(await zoneTexto(page).inputValue() === DE_LUMI, 'le panneau resté ouvert montre le texte de Lumi');
    await pause(5000);
    verifier((await etapes(id))[0]?.action?.config?.body === DE_LUMI, 'la base porte le texte de Lumi (enregistrement automatique)');
    await panneau(page).getByRole('button', { name: 'Fermer le panneau' }).click();
    await pause(700);
    verifier(await page.getByRole('dialog').count() === 0, 'fermer le panneau sans y avoir rien tapé ne demande rien');
    await page.context().close();
  },

  /** A-01 — « Enregistrer » dans le panneau resté ouvert n'écrase pas le texte de Lumi. */
  async a01b() {
    const page = await ouvrirPage();
    await lumiReecritLeTexto(page);
    const id = await texteDExempleOuvert(page);
    await demanderALumi(page, 'change le message de l’automatisation');
    await enregistrer(page).click();
    await panneau(page).waitFor({ state: 'hidden' });
    await pause(6000);
    verifier((await etapes(id))[0]?.action?.config?.body === DE_LUMI, 'après « Enregistrer » du panneau : la base garde le texte de Lumi');
    await page.context().close();
  },

  /** A-01 — une saisie en cours quand Lumi répond : bandeau, deux choix, rien d'écrasé. */
  async a01c() {
    const page = await ouvrirPage();
    await lumiReecritLeTexto(page);
    const regle = await creerRegle({ trigger_event: 'invoice.overdue', steps: [action('send_sms', { body: 'Texte d’origine' })] });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    await zoneTexto(page).fill('Mon texte à moi.');
    await demanderALumi(page, 'change le message de l’automatisation');
    verifier(await zoneTexto(page).inputValue() === 'Mon texte à moi.', 'la saisie en cours n’est pas écrasée');
    verifier(await panneau(page).getByText('Lumi a modifié cette étape pendant que vous l’éditiez.').isVisible(), 'le bandeau nomme Lumi');
    verifier(await enregistrer(page).isDisabled(), '« Enregistrer » attend le choix');
    await panneau(page).getByRole('button', { name: 'Garder ma version' }).click();
    await enregistrer(page).click();
    await pause(6000);
    verifier((await etapes(regle.id))[0]?.action?.config?.body === 'Mon texte à moi.', '« Garder ma version » puis « Enregistrer » : la base porte ma version');
    await page.context().close();
  },

  /** S-01 — « Ouvrir » la 2e automatisation sur réseau lent : rien de la 1re n'est écrit dans la 2e. */
  async s01() {
    const marque = `U-S01-${Date.now()}`;
    const regle = await creerRegle({ name: `${marque} première`, steps: [action('send_sms', { body: 'Texto ALPHA' })] });
    const page = await ouvrirPage();
    await page.route('**/api/automations/rules/generer', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        nom: `${marque} première`, trigger_event: 'quote.sent', resume: 'Relance : un texto.',
        steps: [action('send_sms', { body: 'Texto de LUMI' })],
        autre: { nom: `${marque} deuxième`, trigger_event: 'client.replied', resume: 'Quand le client répond.', steps: [action('send_sms', { body: 'Texto de la DEUXIÈME' })] },
      }),
    }));
    await ouvrirEditeur(page, regle.id);
    // Réseau lent : charger une AUTRE automatisation prend 6 s (plus que les 3 s de l'enregistrement automatique).
    await page.route((url) => url.pathname.endsWith('/api/automations/editeur') && !!url.searchParams.get('rule_id') && url.searchParams.get('rule_id') !== regle.id, async (route) => {
      await pause(6000);
      await route.continue();
    });
    await page.getByLabel('Décris ton automatisation').fill('relance mon devis, et réponds au client quand il écrit');
    await page.getByRole('button', { name: /^(Construire|Envoyer)$/ }).click();
    const toast = page.getByRole('region', { name: /Notifications/ }).getByRole('listitem').filter({ hasText: 'créée en brouillon' });
    await toast.getByRole('button', { name: 'Ouvrir' }).click();
    await page.waitForURL((url) => /\/automations\/[0-9a-f-]{36}$/.test(url.pathname) && !url.pathname.endsWith(regle.id), { timeout: 20_000 });
    const idDeuxieme = new URL(page.url()).pathname.split('/').pop() as string;
    await carte(page, 'Envoyer un texto').waitFor({ timeout: 60_000 });
    await pause(6000);
    const premiere = await lireRegle(regle.id);
    const deuxieme = await lireRegle(idDeuxieme);
    verifier(deuxieme.name === `${marque} deuxième`, `la 2e garde son nom (${String(deuxieme.name)})`);
    verifier(JSON.stringify(deuxieme.steps).includes('Texto de la DEUXIÈME') && !JSON.stringify(deuxieme.steps).includes('Texto de LUMI'), 'la 2e garde son parcours');
    verifier(JSON.stringify(premiere.steps).includes('Texto de LUMI') && premiere.name === `${marque} première`, 'ce que Lumi a posé dans la 1re y est enregistré, sous son nom');
    verifier(((await carte(page, 'Envoyer un texto').textContent()) ?? '').includes('Texto de la DEUXIÈME'), 'l’écran montre le parcours de la 2e');
    await page.context().close();
  },

  /** S-08 — basculer un réglage n'efface pas `arreter_si_resolu: false`. */
  async s08() {
    const regle = await creerRegle({ trigger_event: 'invoice.sent', settings: { arreter_si_resolu: false }, steps: [action('create_task', { title: 'Tâche' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('tab', { name: 'Réglages' }).click();
    await page.getByRole('switch', { name: /Jours ouvrables seulement/ }).click();
    await pause(4000);
    const reglages = (await lireRegle(regle.id)).settings;
    verifier(JSON.stringify(reglages) === JSON.stringify({ arreter_si_resolu: false, jours_ouvrables: true }) || JSON.stringify(reglages) === JSON.stringify({ jours_ouvrables: true, arreter_si_resolu: false }),
      `la case décochée du déclencheur reste décochée en base (${JSON.stringify(reglages)})`);
    await page.context().close();
  },

  /** S-32 — bureau en pause globale : l'éditeur d'une automatisation publiée le dit. */
  async s32() {
    const b = await leBureau();
    const regle = await creerRegle({ trigger_event: 'client.untagged', steps: [action('create_task', { title: 'Tâche' })], is_active: true });
    const page = await ouvrirPage();
    try {
      const { data: pose } = await admin.from('company_settings')
        .update({ automations_paused: true, automations_paused_at: new Date().toISOString(), automations_paused_by: b.users.proprioA })
        .eq('org_id', b.orgA).select('org_id');
      verifier((pose ?? []).length === 1, 'la pause globale est posée en base pour le bureau de test');
      await ouvrirEditeur(page, regle.id);
      await page.getByRole('status').filter({ hasText: 'Vos automatisations sont en pause.' }).waitFor({ timeout: 20_000 });
      verifier(await page.getByText('elle n’envoie rien tant que la pause dure').isVisible(), 'le bandeau dit que l’automatisation publiée n’envoie rien');
    } finally {
      await admin.from('company_settings').update({ automations_paused: false, automations_paused_at: null, automations_paused_by: null }).eq('org_id', b.orgA);
      await admin.from('automation_rules').update({ is_active: false }).eq('id', regle.id);
    }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('status').filter({ hasText: 'Vos automatisations sont en pause.' }).waitFor({ state: 'hidden', timeout: 20_000 });
    verifier(true, 'pause levée : au retour sur la fenêtre, le bandeau part');
    await page.context().close();
  },

  /** S-12 — « Arrêter ici » au milieu et suppression d'une condition : annoncé, et rien d'orphelin en base. */
  async s12() {
    const texto = (id: string, body: string, suivant: string | null) => action('send_sms', { body }, id, suivant);
    const page = await ouvrirPage();
    // (a) « Arrêter ici » entre le 1er et le 2e texto.
    const trois = await creerRegle({ steps: [texto('e1', 'Texto ALPHA', 'e2'), texto('e2', 'Texto BRAVO', 'e3'), texto('e3', 'Texto CHARLIE', null)] });
    await ouvrirEditeur(page, trois.id);
    await page.getByRole('button', { name: 'Ajouter une étape ici' }).nth(1).click();
    await tiroir(page).getByRole('button', { name: /^Arrêter ici/ }).click();
    const d = page.getByRole('dialog');
    await d.getByText('les 2 étapes qui suivent ne seront plus jamais atteintes').waitFor({ timeout: 10_000 });
    verifier(true, '« Arrêter ici » au milieu : la question dit que 2 étapes seront retirées');
    await d.getByRole('button', { name: 'Arrêter ici', exact: true }).click();
    await enregistrer(page).click();
    await pause(6000);
    const apres = await etapes(trois.id);
    verifier(apres.length === 2 && !JSON.stringify(apres).includes('Texto BRAVO'), `la suite est retirée de la base (${apres.map((e) => e.id).join(', ')})`);
    // (b) Supprimer une condition dont la branche « si non » porte une étape.
    const branches = await creerRegle({ steps: [
      texto('e1', 'Texto ALPHA', 'e2'),
      { id: 'e2', type: 'si', conditions: { statut: 'envoye' }, alors: 'e3', sinon: 'e4' },
      texto('e3', 'Texto OUI', null), texto('e4', 'Texto NON', null),
    ] });
    await ouvrirEditeur(page, branches.id);
    await page.getByRole('button', { name: 'Options de l’étape Si…' }).click();
    await page.getByRole('button', { name: 'Supprimer l’étape', exact: true }).click();
    await page.getByRole('dialog').getByText('La branche « si non » (1 étape) sera retirée avec la condition.').waitFor({ timeout: 10_000 });
    verifier(true, 'supprimer une condition : le dialogue annonce le retrait de la branche « si non »');
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click();
    await pause(6000);
    const reste = await etapes(branches.id);
    verifier(reste.length === 2 && !JSON.stringify(reste).includes('Texto NON'), `aucune étape orpheline en base (${reste.map((e) => e.id).join(', ')})`);
    await page.context().close();
  },

  /** S-03 — automatisation PUBLIÉE : la proposition de Lumi demande une confirmation avant d'être appliquée. */
  async s03() {
    const regle = await creerRegle({ trigger_event: 'client.untagged', steps: [action('send_sms', { body: 'Texto EN LIGNE' })], is_active: true });
    const page = await ouvrirPage();
    await lumiReecritLeTexto(page);
    await ouvrirEditeur(page, regle.id);
    const demander = async () => {
      await page.getByLabel('Décris ton automatisation').fill('change le message de l’automatisation');
      await page.getByRole('button', { name: /^(Construire|Envoyer)$/ }).click();
      await page.getByRole('dialog').filter({ hasText: 'Appliquer les changements de Lumi ?' }).waitFor({ timeout: 30_000 });
    };
    await demander();
    verifier(await page.getByRole('dialog').getByText('Cette automatisation est en ligne : appliquer les changements de Lumi ?').isVisible(), 'la question est posée, avec la proposition');
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
    await pause(6000);
    verifier((await etapes(regle.id))[0]?.action?.config?.body === 'Texto EN LIGNE', 'refusé : le parcours en ligne est inchangé en base');
    await demander();
    await page.getByRole('dialog').getByRole('button', { name: 'Appliquer', exact: true }).click();
    await pause(6000);
    verifier((await etapes(regle.id))[0]?.action?.config?.body === DE_LUMI, 'accepté : le texte de Lumi est en base');
    verifier(await page.getByText('en pause, à publier').count() === 0, 'aucun message « en pause » sur une automatisation publiée');
    await admin.from('automation_rules').update({ is_active: false }).eq('id', regle.id);
    await page.context().close();
  },

  /** 05b:303 — parcours converti du format d'origine : supprimer la dernière étape le vide vraiment. */
  async c303() {
    const regle = await creerRegle({ steps: null, actions: [{ type: 'send_sms', config: { body: 'Texto d’origine' } }] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Convertir en parcours modifiable' }).click();
    await page.getByText('Parcours converti — il est modifiable').waitFor({ timeout: 60_000 });
    await pause(1000);
    const convertie = await lireRegle(regle.id);
    verifier(Array.isArray(convertie.steps) && (convertie.steps as unknown[]).length === 1, 'converti : une étape en base');
    await page.getByRole('button', { name: /^Options de l’étape/ }).click();
    await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await page.getByRole('button', { name: 'Ajouter une première étape' }).waitFor({ timeout: 20_000 });
    verifier(await page.getByText('Parcours au format d’origine').count() === 0, 'canevas vide : l’étape supprimée ne revient pas sous « Parcours au format d’origine »');
    await pause(6000);
    const videe = await lireRegle(regle.id);
    verifier(((videe.steps as unknown[] | null) ?? []).length === 0, 'la base n’a plus d’étape');
    verifier(JSON.stringify(videe.actions) === JSON.stringify([{ type: 'send_sms', config: { body: 'À compléter' } }]), `\`actions\` ne garde pas l’ancien message (${JSON.stringify(videe.actions)})`);
    await page.reload();
    await page.getByRole('button', { name: 'Ajouter une première étape' }).waitFor({ timeout: 120_000 });
    verifier(await page.getByText('Parcours au format d’origine').count() === 0, 'après rechargement : toujours un canevas vide');
    await page.context().close();
  },

  /** 05b:303 — automatisation PUBLIÉE : supprimer sa seule étape est refusé, la base est intacte. */
  async c303b() {
    const regle = await creerRegle({ trigger_event: 'client.untagged', steps: [action('create_task', { title: 'Tâche' })], actions: [{ type: 'create_task', config: { title: 'Ancienne tâche' } }], is_active: true });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Options de l’étape/ }).click();
    await page.getByRole('button', { name: 'Supprimer l’action', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await page.getByRole('alert').filter({ hasText: 'Cette automatisation est publiée' }).first().waitFor({ timeout: 20_000 });
    const relue = await lireRegle(regle.id);
    verifier((relue.steps as unknown[]).length === 1 && relue.is_active === true, 'refusé : la règle publiée garde son étape');
    verifier(await page.getByText('nouvel essai automatique').count() === 0, 'sans « nouvel essai automatique »');
    await admin.from('automation_rules').update({ is_active: false }).eq('id', regle.id);
    await page.context().close();
  },

  /** S-04 — « Attendre » en dernière étape : un refus dit comme un refus, sans boucle ; puis la suite s'enregistre. */
  async s04() {
    const regle = await creerRegle({ steps: [action('send_sms', { body: 'Texto ALPHA' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    const reponses: number[] = [];
    page.on('response', (r) => { if (r.request().method() === 'PATCH' && r.url().includes(`/api/automations/rules/${regle.id}`)) reponses.push(r.status()); });
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroir(page).getByRole('button', { name: /^Attendre/ }).click();
    await enregistrer(page).click();
    await page.locator('header').getByText('Refusé — à corriger').waitFor({ timeout: 20_000 });
    await pause(12_000);
    verifier(reponses.filter((s) => s >= 400).length === 1, `le parcours refusé n’est envoyé qu’une fois (réponses : ${reponses.join(', ')})`);
    verifier(await page.getByText('nouvel essai automatique').count() === 0, 'aucun « nouvel essai automatique »');
    verifier(await page.getByRole('alert').filter({ hasText: 'se termine par une attente' }).first().isVisible(), 'le refus reste à l’écran, avec sa raison');
    // On corrige : une étape après l'attente. Tout s'enregistre.
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroir(page).getByRole('button', { name: /Envoyer un texto/ }).click();
    await enregistrer(page).click();
    await page.locator('header').getByText('Enregistré', { exact: true }).waitFor({ timeout: 20_000 });
    verifier((await etapes(regle.id)).length === 3, 'une fois corrigé, le parcours entier est en base');
    await page.context().close();
  },

  /** 12-enregistrement:86 — après un 429, un nouvel essai part et l'enregistrement finit par passer. */
  async e429() {
    const regle = await creerRegle({ steps: [action('send_sms', { body: 'Texto BRAVO' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    let refus = 0;
    await page.route(`**/api/automations/rules/${regle.id}`, (route) => {
      if (route.request().method() !== 'PATCH' || refus >= 1) return route.continue();
      refus += 1;
      return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many requests. Please try again later.' }) });
    });
    await carte(page, 'Envoyer un texto').click();
    await zoneTexto(page).fill('Texto BRAVO après le plafond');
    await enregistrer(page).click();
    await page.locator('header').getByText('Enregistré', { exact: true }).waitFor({ timeout: 20_000 });
    verifier(refus === 1, 'le serveur a répondu 429 une fois');
    verifier((await etapes(regle.id))[0]?.action?.config?.body === 'Texto BRAVO après le plafond', 'l’indicateur dit « Enregistré » et la modification est en base');
    verifier(await page.getByText(/Too many requests/i).count() === 0, 'jamais « Too many requests » à l’écran');
    await page.context().close();
  },

  /** A-09 — l'éditeur ouvert n'écrase pas ce qui a été écrit ailleurs : 409, bandeau, « Recharger ». */
  async a09() {
    const regle = await creerRegle({ trigger_event: 'invoice.overdue', steps: [action('send_sms', { body: 'Texte d’origine' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    // « Lumi », ailleurs (clavardage général, autre onglet) : le texto est réécrit en base.
    await admin.from('automation_rules').update({ steps: [action('send_sms', { body: DE_LUMI })] }).eq('id', regle.id);
    // L'éditeur, qui n'en sait rien, enregistre une modification : son parcours en mémoire repart en entier.
    await carte(page, 'Envoyer un texto').click();
    await panneau(page).getByLabel('Nom de l’action (facultatif)', { exact: true }).fill('Relance');
    await enregistrer(page).click();
    await page.getByRole('alert').filter({ hasText: 'Cette automatisation a été modifiée ailleurs' }).waitFor({ timeout: 20_000 });
    verifier(true, 'le bandeau « modifiée ailleurs (par Lumi ou dans un autre onglet) » s’affiche');
    await pause(8000);
    verifier((await etapes(regle.id))[0]?.action?.config?.body === DE_LUMI, 'rien n’a été écrasé : la base garde le texte de Lumi');
    verifier(await page.getByText('nouvel essai automatique').count() === 0, 'aucun « nouvel essai automatique »');
    await page.getByRole('button', { name: 'Recharger', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'modifiée ailleurs' }).waitFor({ state: 'hidden', timeout: 20_000 });
    verifier(((await carte(page, 'Envoyer un texto').textContent()) ?? '').includes('Bonjour [client_first_name], votre facture'), '« Recharger » : la carte montre le texte de Lumi');
    // Et l'éditeur rechargé enregistre de nouveau normalement.
    await carte(page, 'Envoyer un texto').click();
    await panneau(page).getByLabel('Nom de l’action (facultatif)', { exact: true }).fill('Relance');
    await enregistrer(page).click();
    await pause(6000);
    const relue = (await etapes(regle.id))[0];
    verifier(relue?.nom === 'Relance' && relue?.action?.config?.body === DE_LUMI, 'après rechargement, l’enregistrement passe et garde le texte de Lumi');
    await page.context().close();
  },

  /** A-09 — au retour sur la fenêtre, une règle modifiée ailleurs est rechargée en silence (rien de non enregistré ici). */
  async a09b() {
    const regle = await creerRegle({ trigger_event: 'invoice.overdue', steps: [action('send_sms', { body: 'Texte d’origine' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await admin.from('automation_rules').update({ steps: [action('send_sms', { body: DE_LUMI })] }).eq('id', regle.id);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => document.body.innerText.includes('Bonjour [client_first_name], votre facture'), null, { timeout: 20_000 });
    verifier(true, 'la carte montre le texte écrit ailleurs, sans rechargement de la page');
    verifier(await page.getByRole('alert').count() === 0 && await page.getByRole('dialog').count() === 0, 'sans bandeau ni question');
    await page.context().close();
  },

  /** A-09 — la garde ne se retourne pas contre l'éditeur lui-même : publier, régler, puis enregistrer. */
  async a09c() {
    const regle = await creerRegle({ trigger_event: 'client.untagged', steps: [action('create_task', { title: 'Tâche' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    const renommerEtape = async (nom: string) => {
      await carte(page, nom === 'Un' ? 'Créer une tâche' : 'Un').click();
      await panneau(page).getByLabel('Nom de l’action (facultatif)', { exact: true }).fill(nom);
      await enregistrer(page).click();
      await pause(6000);
    };
    // 1. Publier (la publication touche la règle), puis modifier le parcours.
    await page.getByRole('switch', { name: 'Publier l’automatisation' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publier', exact: true }).click();
    await pause(3000);
    verifier((await lireRegle(regle.id)).is_active === true, 'publiée');
    await renommerEtape('Un');
    verifier((await etapes(regle.id))[0]?.nom === 'Un', 'après la publication, l’enregistrement du parcours passe');
    // 2. Un réglage (autre écriture de l'éditeur), puis le parcours de nouveau.
    await page.getByRole('tab', { name: 'Réglages' }).click();
    await page.getByText('Jours ouvrables seulement').first().click();
    await pause(3000);
    verifier(((await lireRegle(regle.id)).settings as { jours_ouvrables?: boolean } | null)?.jours_ouvrables === true, 'le réglage est en base');
    await page.getByRole('tab', { name: 'Parcours' }).click();
    await renommerEtape('Deux');
    verifier((await etapes(regle.id))[0]?.nom === 'Deux', 'après un réglage, l’enregistrement du parcours passe');
    verifier(await page.getByRole('alert').filter({ hasText: 'modifiée ailleurs' }).count() === 0, 'aucun faux « modifiée ailleurs »');
    await admin.from('automation_rules').update({ is_active: false }).eq('id', regle.id);
    await page.context().close();
  },

  /** Ligne 1 — publiée : une étape choisie dans le tiroir n'est pas écrite avant d'être enregistrée. */
  async l1() {
    const regle = await creerRegle({ trigger_event: 'client.untagged', steps: [action('create_task', { title: 'Tâche existante' })], is_active: true });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroir(page).getByRole('button', { name: /Envoyer un texto/ }).click();
    await panneau(page).waitFor();
    await pause(6000);
    verifier((await etapes(regle.id)).map((e) => e.id).join() === 'e1', 'après 6 s, panneau ouvert et non enregistré : la base ne porte que e1');
    await enregistrer(page).click();
    await pause(6000);
    verifier((await etapes(regle.id)).length === 2, 'après « Enregistrer » dans le panneau : l’étape est en base');
    await page.context().close();
  },

  /** Ligne 2 — la version anglaise d'un texto est visible, modifiable, et ne reste pas périmée en silence. */
  async l2() {
    const regle = await creerRegle({ steps: [action('send_sms', { body: 'Rabais de 10 % jusqu’au 1er mai.', body_en: '10% off until May 1st.' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneau(page);
    const anglais = p.getByLabel('Texte du message — version anglaise (facultatif)', { exact: true });
    verifier(await anglais.inputValue() === '10% off until May 1st.', 'le texte anglais est dans un champ du panneau');
    await p.getByLabel('Texte du message *', { exact: true }).fill('Rabais de 20 % jusqu’au 1er juin.');
    verifier(await enregistrer(page).isDisabled(), 'français corrigé, anglais intact : « Enregistrer » est refusé');
    verifier(await p.getByText('a changé, pas sa version anglaise').first().isVisible(), 'le panneau dit pourquoi');
    await anglais.fill('20% off until June 1st.');
    await enregistrer(page).click();
    await pause(6000);
    const config = (await etapes(regle.id))[0]?.action?.config ?? {};
    verifier(config.body === 'Rabais de 20 % jusqu’au 1er juin.' && config.body_en === '20% off until June 1st.', 'les deux textes sont en base');
    await page.context().close();
  },

  /** Ligne 3 — le courriel d'une automatisation fournie, converti au clic, s'ouvre en texte lisible. */
  async l3() {
    const HTML = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Vous nous avez contactés récemment.</p><p>Merci,<br/>[company_name]</p></div>';
    const regle = await creerRegle({ trigger_event: 'lead.created', steps: null, actions: [{ type: 'send_email', config: { subject: 'Votre demande n’est pas oubliée', body: HTML } }] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un courriel').click();
    const p = panneau(page);
    await p.waitFor({ timeout: 120_000 });
    const affiche = await p.getByLabel('Message *', { exact: true }).inputValue();
    verifier(!/<div|<p>|<h2>|style=/.test(affiche) && affiche.startsWith('Bonjour [client_first_name],'), `« Message » est du texte : ${JSON.stringify(affiche.slice(0, 60))}`);
    await enregistrer(page).click();
    await pause(5000);
    verifier((await etapes(regle.id))[0]?.action?.config?.body === HTML, 'réenregistré sans rien changer : le HTML d’origine est intact en base');
    await page.context().close();
  },
};

const demandes = process.argv.slice(2);
const aJouer = demandes.length ? demandes : Object.keys(SCENARIOS);
let echecs = 0;
for (const nom of aJouer) {
  const scenario = SCENARIOS[nom];
  if (!scenario) { console.error(`scénario inconnu : ${nom}`); echecs += 1; continue; }
  console.log(`▶ ${nom}`);
  try { await scenario(); console.log(`✔ ${nom}`); } catch (e) { echecs += 1; console.error(`✘ ${nom} — ${e instanceof Error ? e.message : String(e)}`); }
}
await fermer();
process.exit(echecs ? 1 : 0);
