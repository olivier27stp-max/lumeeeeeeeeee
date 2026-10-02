/**
 * Vérifications au vrai navigateur des corrections de l'agent U — une par
 * ligne du triage `actions.md`. Voir `banc.mts`.
 *
 *   QA_AUTO_SUFFIXE=u npx tsx --env-file=.env.local scripts/qa/finale/u/verifier.mts l1 l4 …
 *   (sans argument : tous les scénarios)
 */
import type { Page } from '@playwright/test';
import { admin, carte, creerRegle, fermer, lireRegle, ouvrirEditeur, ouvrirPage, panneau, pause, tiroir, verifier } from './banc.mts';

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
