/**
 * Vérifications au vrai navigateur des corrections de l'agent U — une par
 * ligne du triage `actions.md`. Voir `banc.mts`.
 *
 *   QA_AUTO_SUFFIXE=u npx tsx --env-file=.env.local scripts/qa/finale/u/verifier.mts l1 l4 …
 *   (sans argument : tous les scénarios)
 */
import type { Page } from '@playwright/test';
import { admin, assurerChamp, BASE, carte, creerRegle, fermer, leBureau, lireRegle, ouvrirEditeur, ouvrirPage, panneau, pause, tiroir, verifier } from './banc.mts';

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

  /** Ligne 4 (actions) — « Attendre » 3 jours : effacer et taper 5 au clavier donne 5 jours. */
  async l4() {
    const regle = await creerRegle({ trigger_event: 'lead.created', steps: [
      { id: 'e1', type: 'attendre', delai_secondes: 259200, suivant: 'e2' },
      action('create_task', { title: 'Rappeler [client_name]' }, 'e2', null),
    ] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Attendre').click();
    const p = panneau(page);
    const nombre = p.getByLabel('Attendre *', { exact: true });
    await nombre.click();
    await nombre.press('ControlOrMeta+a');
    await nombre.press('Backspace');
    await page.keyboard.type('5');
    verifier(await p.getByLabel('Unité de temps').inputValue() === 'jours', 'l’unité reste « jours »');
    verifier(await nombre.inputValue() === '5', 'le champ affiche « 5 » (pas « 05 »)');
    await enregistrer(page).click();
    await pause(6000);
    verifier((await etapes(regle.id))[0]?.delai_secondes === 5 * 86400, '5 jours sont en base');
    await page.context().close();
  },

  /** Lignes 5 et 7 (actions) — l'entité que fixe le champ surveillé : tiroir, canevas et serveur d'accord. */
  async l5() {
    const b = await leBureau();
    const datePipeline = await assurerChamp('deal', 'u_fermeture', 'Fermeture prévue U', 'date');
    const texteClient = await assurerChamp('client', 'u_surnom', 'Surnom U', 'single_line');
    const page = await ouvrirPage();
    const jeton = await page.evaluate(() => JSON.parse(localStorage.getItem('lume-auth-token') ?? '{}').access_token as string).catch(() => '');
    const publier = async (id: string) => {
      const r = await fetch(`http://127.0.0.1:3497/api/automations/rules/${id}/publication`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'x-org-id': b.orgA }, body: JSON.stringify({ actif: true }),
      });
      return { status: r.status, json: await r.json().catch(() => null) as { problemes?: string[] } | null };
    };
    // (5) « Date atteinte » sur un champ du pipeline + « Assigner l'opportunité ».
    const pipeline = await creerRegle({ trigger_event: 'date.reached', conditions: { champ_id: datePipeline, jours_avant: 7 }, steps: [
      action('send_sms', { body: 'Bonjour [client_first_name]' }, 'e1', 'e2'), action('assigner_deal', {}, 'e2', null),
    ] });
    await ouvrirEditeur(page, pipeline.id);
    await carte(page, 'Assigner l’opportunité').waitFor();
    await pause(1500);
    verifier(await page.getByText(/chose[s]? à corriger avant de publier/).count() === 0, 'champ du pipeline : aucun bandeau rouge sur le canevas');
    const jetonLu = await page.evaluate(() => JSON.parse(localStorage.getItem('lume-auth-token') ?? '{}').access_token as string);
    const pub = await (async () => {
      const r = await fetch(`http://127.0.0.1:3497/api/automations/rules/${pipeline.id}/publication`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jetonLu}`, 'x-org-id': b.orgA }, body: JSON.stringify({ actif: true }),
      });
      return { status: r.status, json: await r.json().catch(() => null) as { problemes?: string[] } | null };
    })();
    verifier(pub.status === 200, `champ du pipeline : le serveur publie (${pub.status} ${JSON.stringify(pub.json?.problemes ?? '')})`);
    await admin.from('automation_rules').update({ is_active: false }).eq('id', pipeline.id);
    void publier;
    // (7) « Champ personnalisé modifié » sur un champ du client + « Envoyer la facture ».
    const client = await creerRegle({ trigger_event: 'custom_field.changed', conditions: { field_id: { eq: texteClient } }, steps: [
      action('send_sms', { body: 'Bonjour [client_first_name]' }, 'e1', 'e2'), action('envoyer_facture', {}, 'e2', null),
    ] });
    const r7 = await fetch(`http://127.0.0.1:3497/api/automations/rules/${client.id}/publication`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jetonLu}`, 'x-org-id': b.orgA }, body: JSON.stringify({ actif: true }),
    });
    const j7 = await r7.json().catch(() => null) as { problemes?: string[] } | null;
    verifier(r7.status === 422 && JSON.stringify(j7?.problemes) === JSON.stringify(['« Envoyer la facture » ne peut pas suivre ce déclencheur.']), `champ du client : le serveur refuse « Envoyer la facture » (${r7.status})`);
    await ouvrirEditeur(page, client.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    verifier(await tiroir(page).getByRole('button', { name: /^Envoyer la facture/ }).isDisabled(), 'champ du client : le tiroir grise « Envoyer la facture » — comme le serveur');
    await page.context().close();
  },

  /** Ligne 6 (actions) — « Appel reçu de l'extérieur » : six actions grisées dans le tiroir, refusées à la publication. */
  async l6() {
    const b = await leBureau();
    const regle = await creerRegle({ trigger_event: 'webhook.received', steps: [
      action('send_sms', { body: 'Bonjour' }, 'e1', 'e2'), action('envoyer_facture', {}, 'e2', 'e3'), action('assigner_deal', {}, 'e3', null),
    ] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    for (const titre of ['Envoyer la facture', 'Envoyer le devis', 'Changer le statut du rendez-vous', 'Déplacer l’opportunité', 'Modifier l’opportunité', 'Assigner l’opportunité']) {
      const item = tiroir(page).getByRole('button', { name: new RegExp(`^${titre}`) });
      verifier(((await item.textContent()) ?? '').includes('Ne va pas avec ce déclencheur'), `le tiroir grise « ${titre} », avec la raison`);
    }
    const jeton = await page.evaluate(() => JSON.parse(localStorage.getItem('lume-auth-token') ?? '{}').access_token as string);
    const r = await fetch(`http://127.0.0.1:3497/api/automations/rules/${regle.id}/publication`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'x-org-id': b.orgA }, body: JSON.stringify({ actif: true }),
    });
    const j = await r.json().catch(() => null) as { problemes?: string[] } | null;
    verifier(r.status === 422 && (j?.problemes ?? []).length === 2, `le serveur refuse la publication (${r.status} : ${(j?.problemes ?? []).join(' · ')})`);
    await page.context().close();
  },

  /** EDT-166 — « Précédent » du navigateur avec une étape incomplète : on demande avant de perdre le travail. */
  async e166() {
    const regle = await creerRegle({ steps: [action('send_sms', { body: 'Texto ALPHA' }, 'e1', 'e2'), action('create_task', { title: '' }, 'e2', null)] });
    const page = await ouvrirPage();
    await page.goto(`${BASE}/automations`);
    await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 120_000 });
    await ouvrirEditeur(page, regle.id);
    // Du vrai travail : un texto réécrit — que l'étape incomplète empêche d'enregistrer.
    await carte(page, 'Envoyer un texto').click();
    await zoneTexto(page).fill('Texto ALPHA réécrit');
    await enregistrer(page).click();
    await page.locator('header').getByText('1 étape(s) à compléter').waitFor({ timeout: 10_000 });
    await page.goBack();
    const question = page.getByRole('dialog').filter({ hasText: 'Quitter sans enregistrer ?' });
    await question.waitFor({ timeout: 10_000 });
    verifier(page.url().includes(`/automations/${regle.id}`), '« Précédent » : la question est posée, l’éditeur n’est pas quitté');
    await question.getByRole('button', { name: 'Annuler', exact: true }).click();
    verifier(((await carte(page, 'Envoyer un texto').textContent()) ?? '').includes('Texto ALPHA réécrit'), '« Annuler » : le travail est toujours à l’écran');
    await page.goBack();
    await question.waitFor({ timeout: 10_000 });
    await question.getByRole('button', { name: 'Quitter', exact: true }).click();
    await page.waitForURL(/\/automations$/, { timeout: 20_000 });
    verifier(true, '« Quitter » : on revient à la liste');
    await pause(1500);
    verifier(await page.getByText('quittée sans enregistrer').count() === 0, 'sans toast d’après coup');
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
    const FR = 'Rabais de 10 % jusqu’au 1er mai.';
    const EN = '10% off until May 1st.';
    const b = await leBureau();
    const mettreLangue = async (langue: 'fr' | 'en') => {
      const { error } = await admin.from('company_settings').update({ default_language: langue }).eq('org_id', b.orgA);
      if (error) throw new Error(`langue du bureau : ${error.message}`);
    };
    const configDe = async (id: string) => ((await etapes(id))[0]?.action?.config ?? {}) as Record<string, string>;
    const TITRE_EN = 'Version anglaise — utilisée seulement si vos messages partent en anglais';
    const TITRE_FR = 'Version française — utilisée seulement si vos messages partent en français';
    try {
      // ── Bureau qui envoie en FRANÇAIS ──
      await mettreLangue('fr');
      let regle = await creerRegle({ steps: [action('send_sms', { body: FR, body_en: EN })] });
      let page = await ouvrirPage();
      await ouvrirEditeur(page, regle.id);
      await carte(page, 'Envoyer un texto').click();
      let p = panneau(page);
      const principal = () => p.getByLabel('Texte du message *', { exact: true });
      verifier(await principal().inputValue() === FR, 'bureau FR : le champ principal montre le français');
      const blocEn = p.getByRole('button', { name: TITRE_EN });
      verifier(await blocEn.getAttribute('aria-expanded') === 'false', 'bureau FR : la version anglaise est dans un bloc replié');
      await principal().fill('Rabais de 20 % jusqu’au 1er juin.');
      verifier(await enregistrer(page).isEnabled(), 'français corrigé, anglais intact : « Enregistrer » reste offert');
      verifier(await blocEn.getAttribute('aria-expanded') === 'true' && await p.getByText('Cette version n’est plus à jour.').isVisible(), 'le bloc se déplie et dit « Cette version n’est plus à jour. »');
      verifier(await p.getByLabel('La retirer (vos clients recevront le texte ci-dessus)').isChecked(), '« La retirer » est coché d’office');
      await enregistrer(page).click();
      await pause(6000);
      let config = await configDe(regle.id);
      verifier(config.body === 'Rabais de 20 % jusqu’au 1er juin.' && !('body_en' in config), `un clic : la version anglaise est retirée de l’étape (${JSON.stringify(config)})`);
      // « La garder telle quelle ».
      regle = await creerRegle({ steps: [action('send_sms', { body: FR, body_en: EN })] });
      await ouvrirEditeur(page, regle.id);
      await carte(page, 'Envoyer un texto').click();
      await principal().fill('Rabais de 20 % jusqu’au 1er juin.');
      await p.getByLabel('La garder telle quelle').check();
      await enregistrer(page).click();
      await pause(6000);
      config = await configDe(regle.id);
      verifier(config.body === 'Rabais de 20 % jusqu’au 1er juin.' && config.body_en === EN, '« La garder telle quelle » : elle reste en base');
      // La mettre à jour soi-même.
      regle = await creerRegle({ steps: [action('send_sms', { body: FR, body_en: EN })] });
      await ouvrirEditeur(page, regle.id);
      await carte(page, 'Envoyer un texto').click();
      await principal().fill('Rabais de 20 % jusqu’au 1er juin.');
      await p.getByLabel('Texte du message — version anglaise (facultatif)', { exact: true }).fill('20% off until June 1st.');
      verifier(await p.getByText('Cette version n’est plus à jour.').count() === 0, 'anglais mis à jour : les deux choix disparaissent');
      await enregistrer(page).click();
      await pause(6000);
      config = await configDe(regle.id);
      verifier(config.body === 'Rabais de 20 % jusqu’au 1er juin.' && config.body_en === '20% off until June 1st.', 'les deux textes sont en base');
      await page.context().close();

      // ── Bureau qui envoie en ANGLAIS ──
      await mettreLangue('en');
      regle = await creerRegle({ steps: [action('send_sms', { body: FR, body_en: EN })] });
      page = await ouvrirPage();
      await ouvrirEditeur(page, regle.id);
      await carte(page, 'Envoyer un texto').click();
      p = panneau(page);
      const principalEn = p.getByLabel('Texte du message *', { exact: true });
      await page.waitForFunction((attendu) => Array.from(document.querySelectorAll('textarea')).some((t) => t.value === attendu), EN, { timeout: 15_000 }).catch(() => undefined);
      verifier(await principalEn.inputValue() === EN, `bureau EN : le champ principal montre l’anglais (${await principalEn.inputValue()})`);
      const texteCarte = (await carte(page, 'Envoyer un texto').textContent()) ?? '';
      verifier(texteCarte.includes(EN) && !texteCarte.includes(FR), `bureau EN : la carte du canevas montre l’anglais (${texteCarte})`);
      const blocFr = p.getByRole('button', { name: TITRE_FR });
      verifier(await blocFr.getAttribute('aria-expanded') === 'false', 'bureau EN : la version française est dans un bloc replié');
      await principalEn.fill('20% off until June 1st.');
      verifier(await enregistrer(page).isEnabled() && await p.getByLabel('La retirer (vos clients recevront le texte ci-dessus)').isChecked(), 'anglais corrigé : « Enregistrer » offert, « La retirer » coché');
      await enregistrer(page).click();
      await pause(6000);
      config = await configDe(regle.id);
      verifier(config.body === '20% off until June 1st.' && !('body_en' in config), `bureau EN, un clic : il ne reste qu’un texte, sous body (${JSON.stringify(config)})`);
      await page.context().close();
    } finally {
      await mettreLangue('fr');
    }
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

  /** Lignes 8 et 9 (actions) — 999 jours, une adresse en http:// : refusés dans le panneau ; le serveur dit où et quoi. */
  async l8() {
    const b = await leBureau();
    const regle = await creerRegle({ trigger_event: 'lead.created', steps: [
      action('create_task', { title: 'Rappeler [client_name]', echeance_jours: '3' }, 'e1', 'e2'),
      action('webhook', { url: 'https://crochets.lume-qa.test/entrant' }, 'e2', null),
    ] });
    const page = await ouvrirPage();
    const ecritures: number[] = [];
    page.on('response', (r) => { if (r.request().method() === 'PATCH' && r.url().includes(`/api/automations/rules/${regle.id}`)) ecritures.push(r.status()); });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Créer une tâche').click();
    const p = panneau(page);
    const jours = p.getByLabel('À faire dans (jours)', { exact: false });
    await jours.fill('999');
    verifier(await enregistrer(page).isDisabled(), '999 jours : « Enregistrer » est désactivé');
    verifier(await p.getByText('« À faire dans (jours) » doit être au plus 365.').first().isVisible(), 'la borne est dite dans le panneau');
    await jours.fill('-5');
    verifier(await p.getByText('« À faire dans (jours) » doit être au moins 0.').first().isVisible(), '-5 jours : « au moins 0 »');
    await pause(5000);
    verifier(ecritures.length === 0, `aucun envoi au serveur pendant le refus (${ecritures.join(', ') || 'aucun'})`);
    await jours.fill('30');
    await enregistrer(page).click();
    await pause(5000);
    verifier((await etapes(regle.id))[0]?.action?.config?.echeance_jours === '30', '30 jours : enregistré');
    await carte(page, 'Appeler un webhook').click();
    const adresse = panneau(page).getByLabel('L’adresse', { exact: false });
    for (const v of ['http://crochets.lume-qa.test/entrant', 'pas une adresse', 'ftp://crochets.lume-qa.test']) {
      await adresse.fill(v);
      verifier(await enregistrer(page).isDisabled() && await panneau(page).getByText('« L’adresse » doit commencer par https://.').first().isVisible(), `« ${v} » : refusé dans le panneau, avec la raison`);
    }
    await adresse.fill('https://localhost/interne');
    verifier(await enregistrer(page).isDisabled() && await panneau(page).getByText('« L’adresse » ne peut pas viser une adresse interne.').first().isVisible(), 'une adresse interne : refusée');
    await pause(4000);
    verifier((await etapes(regle.id))[1]?.action?.config?.url === 'https://crochets.lume-qa.test/entrant', 'la base garde l’adresse valide');
    // Le vrai serveur, appelé sans l'éditeur : le refus nomme l'étape, avec ses accents — et en anglais.
    const jeton = await page.evaluate(() => JSON.parse(localStorage.getItem('lume-auth-token') ?? '{}').access_token as string);
    const refus = async (langue: string) => {
      const r = await fetch(`http://127.0.0.1:3497/api/automations/rules/${regle.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'x-org-id': b.orgA, 'Accept-Language': langue },
        body: JSON.stringify({ steps: [action('create_task', { title: 'Rappeler', echeance_jours: '999' }, 'e1', 'e2'), action('webhook', { url: 'http://x.test/a' }, 'e2', null)] }),
      });
      return { status: r.status, erreur: ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? '' };
    };
    const fr = await refus('fr');
    verifier(fr.status === 400 && fr.erreur.includes('Étape 1 (« Créer une tâche ») : « À faire dans (jours) » doit être au plus 365.') && fr.erreur.includes('Étape 2 (« Appeler un webhook ») : « L’adresse » doit commencer par https://.'), `le serveur, en français : ${fr.status} ${fr.erreur}`);
    const en = await refus('en');
    verifier(en.status === 400 && en.erreur.includes('Step 1 (“Create a task”): “Due in (days)” must be at most 365.') && !/Étape|doit/.test(en.erreur), `le serveur, en anglais : ${en.status} ${en.erreur}`);
    await page.context().close();
  },

  /** Déclencheurs 03:316, 03:581 et « jours avant » — plage impossible, mois et jours hors bornes : refusés dans le panneau, et par le serveur. */
  async d316() {
    const b = await leBureau();
    const notif = [action('create_notification', { title: 'Devis ouvert' })];
    const regle = await creerRegle({ trigger_event: 'quote.viewed', conditions: { ouverture: 'premiere' }, steps: notif });
    const page = await ouvrirPage();
    const ecritures: number[] = [];
    page.on('response', (r) => { if (r.request().method() === 'PATCH' && /\/api\/automations\/rules\/[0-9a-f-]{36}$/.test(r.url())) ecritures.push(r.status()); });
    await ouvrirEditeur(page, regle.id);
    const p = page.getByRole('complementary', { name: 'Réglages du déclencheur' });
    const sauver = p.getByRole('button', { name: 'Enregistrer', exact: true });
    await page.getByRole('button', { name: /^Quand/ }).first().click();
    await p.waitFor();
    await p.getByLabel(/^Montant minimum \(\$\)/).fill('5000');
    await p.getByLabel(/^Montant maximum \(\$\)/).fill('100');
    await sauver.click();
    verifier(await p.getByRole('alert').isVisible(), 'minimum 5 000 $, maximum 100 $ : le refus est écrit, « Enregistrer » ne ferme pas le panneau');
    verifier(await p.getByRole('alert').getByText(/Montant minimum \(\$\) » est plus grand que « Montant maximum \(\$\) »/).isVisible(), 'la raison est dite dans le panneau');
    await p.getByLabel(/^Montant maximum \(\$\)/).fill('');
    await p.getByLabel(/^Montant minimum \(\$\)/).fill('-5');
    await sauver.click();
    verifier(await p.getByText('« Montant minimum ($) » doit être au moins 0.').isVisible(), '-5 $ : refusé, « au moins 0 »');
    await pause(4500);
    verifier(ecritures.length === 0, `rien n’est parti vers le serveur (${ecritures.join(', ') || 'aucune écriture'})`);
    await p.getByLabel(/^Montant minimum \(\$\)/).fill('100');
    await p.getByLabel(/^Montant maximum \(\$\)/).fill('5000');
    await sauver.click();
    await pause(5000);
    verifier(JSON.stringify((await lireRegle(regle.id)).conditions) === JSON.stringify({ ouverture: 'premiere', montant__gte: 100, montant__lte: 5000 }), `une plage possible est enregistrée : ${JSON.stringify((await lireRegle(regle.id)).conditions)}`);

    // « Date atteinte » : 9999 jours avant.
    const champDate = await assurerChamp('client', 'u_fin_contrat', 'Fin de contrat U', 'date');
    const dates = await creerRegle({ trigger_event: 'date.reached', conditions: { champ_id: champDate, jours_avant: 7 }, steps: notif });
    await ouvrirEditeur(page, dates.id);
    await page.getByRole('button', { name: /^Quand/ }).first().click();
    await p.waitFor();
    ecritures.length = 0;
    await p.getByLabel(/^Combien de jours avant/).fill('9999');
    await sauver.click();
    verifier(await p.getByText('« Combien de jours avant » doit être un nombre entier, entre -365 et 365.').isVisible(), '9999 jours avant : refusé dans le panneau, bornes dites');
    await pause(4500);
    verifier(ecritures.length === 0 && (await lireRegle(dates.id)).conditions !== null && ((await lireRegle(dates.id)).conditions as { jours_avant?: number }).jours_avant === 7, 'rien ne part, la base garde 7 jours');

    // Le vrai serveur, sans l'éditeur.
    const jeton = await page.evaluate(() => JSON.parse(localStorage.getItem('lume-auth-token') ?? '{}').access_token as string);
    const ecrire = async (id: string, conditions: Record<string, unknown>) => {
      const r = await fetch(`http://127.0.0.1:3497/api/automations/rules/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jeton}`, 'x-org-id': b.orgA }, body: JSON.stringify({ conditions }),
      });
      return { status: r.status, erreur: ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? '' };
    };
    const plage = await ecrire(regle.id, { montant__gte: 5000, montant__lte: 100 });
    verifier(plage.status === 400 && plage.erreur.includes('est plus grand que'), `le serveur refuse la plage impossible : ${plage.status} ${plage.erreur}`);
    const inactif = await creerRegle({ trigger_event: 'client.inactive', conditions: { mois: 6, max_par_heure: 25 }, steps: notif });
    for (const mois of [0, 61, 2.5]) {
      const r = await ecrire(inactif.id, { mois, max_par_heure: 25 });
      verifier(r.status === 400 && r.erreur.includes('doit être un nombre entier, entre 1 et 60'), `le serveur refuse ${mois} mois : ${r.status} ${r.erreur}`);
    }
    verifier(((await lireRegle(inactif.id)).conditions as { mois?: number }).mois === 6, 'la base garde 6 mois');
    // Le panneau de « Client inactif » (le déclencheur est sous drapeau : la carte s'ouvre quand même sur une règle qui le porte).
    await ouvrirEditeur(page, inactif.id);
    await page.getByRole('button', { name: /^Quand/ }).first().click();
    if (await p.isVisible().catch(() => false)) {
      for (const faux of ['0', '61', '2.5']) {
        await p.getByLabel(/^Aucun job terminé depuis \(mois\)/).fill(faux);
        await sauver.click();
        verifier(await p.getByText('« Aucun job terminé depuis (mois) » doit être un nombre entier, entre 1 et 60.').isVisible(), `« ${faux} » mois : refusé dans le panneau`);
      }
    } else {
      console.log('  (panneau « Client inactif » non offert à ce bureau : vérifié par le serveur et par le test du composant)');
    }
    await page.context().close();
  },

  /** Déclencheurs 04:418 — « Filtres », valeur d'un champ nombre tapée touche par touche : « 12.5 » reste 12,5 ; pas de « NaN ». */
  async d418() {
    const b = await leBureau();
    const { data: deja } = await admin.from('custom_fields').select('id').eq('org_id', b.orgA).eq('object_type', 'client').eq('key', 'u_fenetres').is('archived_at', null).maybeSingle();
    const idChamp = deja?.id ? String(deja.id) : String((await admin.from('custom_fields')
      .insert({ org_id: b.orgA, object_type: 'client', key: 'u_fenetres', label: 'Fenêtres U', field_type: 'number', config: {}, position: 901 }).select('id').single()).data?.id);
    const regle = await creerRegle({ trigger_event: 'lead.created', conditions: {}, steps: [action('create_notification', { title: 'Nouveau prospect' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    const p = page.getByRole('complementary', { name: 'Réglages du déclencheur' });
    await page.getByRole('button', { name: /^Quand/ }).first().click();
    await p.waitFor();
    await p.getByRole('button', { name: 'Ajouter une condition' }).click();
    await p.getByLabel('Champ', { exact: true }).selectOption({ label: 'Fenêtres U' });
    const v = p.getByLabel('Valeur', { exact: true });
    await v.pressSequentially('12.5');
    verifier(await v.inputValue() === '12.5', `après 1, 2, point, 5 : le champ montre « ${await v.inputValue()} »`);
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await pause(5000);
    const filtres = ((await lireRegle(regle.id)).conditions as { champs_perso?: Array<{ field_id: string; op: string; value: unknown }> }).champs_perso ?? [];
    verifier(filtres.length === 1 && filtres[0].field_id === idChamp && filtres[0].value === 12.5, `12,5 est en base : ${JSON.stringify(filtres)}`);
    await page.getByRole('button', { name: /^Quand/ }).first().click();
    await p.waitFor();
    const v2 = p.getByLabel('Valeur', { exact: true });
    verifier(await v2.inputValue() === '12.5', 'rouvert, le panneau relit 12.5');
    await v2.fill('');
    await v2.pressSequentially('abc');
    verifier(await v2.inputValue() === '', `des lettres : le champ montre « ${await v2.inputValue()} » (jamais « NaN »)`);
    await page.context().close();
  },

  /** Déclencheurs 05:470 et 05:501 — étape « Si… » : lignes illisibles signalées ; « est l'un de » montré, modifiable, jamais effacé. */
  async d470() {
    const DE_LUMI = { source: { in: ['web', 'facebook'] }, statut: { not_in: ['perdu'] } };
    const regle = await creerRegle({ trigger_event: 'quote.sent', conditions: {}, steps: [
      { id: 's1', type: 'si', conditions: DE_LUMI, alors: 'e1', sinon: null },
      action('create_notification', { title: 'Devis à suivre' }),
    ] });
    const conditionsEnBase = async () => ((await etapes(regle.id))[0] as { conditions?: Record<string, unknown> }).conditions ?? {};
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Si…/ }).click();
    const p = panneau(page);
    const zone = p.getByLabel('Conditions');
    verifier(await zone.inputValue() === 'source est l’un de web, facebook\nstatut n’est aucun de perdu', `la zone montre les conditions de Lumi : ${JSON.stringify(await zone.inputValue())}`);
    await zone.click();
    await zone.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('montant 5000');
    verifier(await enregistrer(page).isDisabled(), '« montant 5000 » (sans signe) : « Enregistrer » est retenu');
    verifier(await p.getByRole('alert').getByText(/Ligne illisible « montant 5000 »/).isVisible(), 'la ligne illisible est nommée');
    await pause(4500);
    verifier(JSON.stringify(await conditionsEnBase()) === JSON.stringify(DE_LUMI), 'rien n’est parti : la base garde les conditions d’origine');
    await page.keyboard.press('ControlOrMeta+Backspace');
    await page.keyboard.type('> 100');
    verifier(await zone.inputValue() === 'source est l’un de web, facebook\nstatut n’est aucun de perdu\nmontant > 100', `la ligne corrigée : ${JSON.stringify(await zone.inputValue())}`);
    await enregistrer(page).click();
    await pause(5000);
    const apres = await conditionsEnBase();
    verifier(JSON.stringify(apres.source) === JSON.stringify(DE_LUMI.source) && JSON.stringify(apres.statut) === JSON.stringify(DE_LUMI.statut) && JSON.stringify(apres.montant) === JSON.stringify({ gt: 100 }),
      `les deux conditions d’origine ont survécu, la troisième est ajoutée : ${JSON.stringify(apres)}`);
    await page.reload();
    await page.getByRole('button', { name: /^Si…/ }).click();
    verifier((await p.getByLabel('Conditions').inputValue()).split('\n').length === 3, 'relu après rechargement : trois lignes');
    await page.context().close();
  },

  /** Régression de 6ce9a1cb (editeur/11:125) — saisie, « Enregistrer » du panneau, puis UN seul « Précédent » : retour à la liste. */
  async e166b() {
    const regle = await creerRegle({ trigger_event: 'quote.sent', steps: [action('send_sms', { body: 'Texte d’origine' })] });
    const page = await ouvrirPage();
    // Un vrai chemin : la liste, puis l'éditeur ouvert depuis elle.
    await page.goto(`${BASE}/automations`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 120_000 });
    // Ouvrir DEPUIS la liste, sans recharger la page (comme un clic sur une ligne) : c'est ce chemin-là
    // que « Précédent » remonte. `page.goto` chargerait un autre document, et le retour quitterait l'application.
    const ouvrirDepuisLaListe = async () => {
      await page.evaluate((chemin) => {
        window.history.pushState({}, '', chemin);
        window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
      }, `/automations/${regle.id}`);
      await page.getByRole('button', { name: /^(Quand|When)/ }).first().waitFor({ timeout: 120_000 });
    };
    await ouvrirDepuisLaListe();
    const longueurAvant = await page.evaluate(() => window.history.length);
    await carte(page, 'Envoyer un texto').click();
    const p = panneau(page);
    await p.getByLabel('Texte du message *', { exact: true }).fill('Texte réécrit avant de partir');
    await pause(300);
    const pendant = await page.evaluate(() => ({ n: window.history.length, garde: (window.history.state as Record<string, unknown> | null)?.lumeGardeEditeur === true }));
    verifier(pendant.garde && pendant.n === longueurAvant + 1, `saisie en cours : la garde pose UNE entrée d’historique (${longueurAvant} → ${pendant.n}, sur l’entrée de la garde : ${pendant.garde})`);
    await enregistrer(page).click();
    await p.waitFor({ state: 'hidden' });
    await pause(500);
    verifier(await page.evaluate(() => (window.history.state as Record<string, unknown> | null)?.lumeGardeEditeur !== true), 'panneau enregistré : on n’est plus sur l’entrée de la garde');
    await page.goBack();
    await page.waitForURL((url) => url.pathname === '/automations', { timeout: 15_000 }).catch(() => undefined);
    verifier(new URL(page.url()).pathname === '/automations', `UN seul « Précédent » ramène à la liste (${new URL(page.url()).pathname})`);
    await pause(4000);
    const enBase = (await etapes(regle.id))[0]?.action?.config?.body;
    verifier(enBase === 'Texte réécrit avant de partir', `la modification est enregistrée en partant (en base : ${JSON.stringify(enBase)})`);

    // La garde retient toujours quand il reste quelque chose à perdre.
    await ouvrirDepuisLaListe();
    await carte(page, 'Envoyer un texto').click();
    await p.getByLabel('Texte du message *', { exact: true }).fill('Saisie jamais enregistrée');
    await pause(300);
    verifier(await page.evaluate(() => (window.history.state as Record<string, unknown> | null)?.lumeGardeEditeur === true), 'nouvelle saisie : la garde est de nouveau posée');
    await page.goBack();
    await pause(500);
    console.log('  (après « Précédent » :', new URL(page.url()).pathname, '— dialogues :', await page.getByRole('dialog').count(), await page.getByRole('alertdialog').count(), ')');
    const question = page.getByRole('dialog').filter({ hasText: 'Quitter sans enregistrer ?' });
    await question.waitFor({ timeout: 10_000 });
    verifier(new URL(page.url()).pathname.endsWith(regle.id), 'saisie non enregistrée : « Précédent » pose la question, on est toujours dans l’éditeur');
    await question.getByRole('button', { name: 'Annuler', exact: true }).click();
    verifier(await p.getByLabel('Texte du message *', { exact: true }).inputValue() === 'Saisie jamais enregistrée', '« Annuler » : la saisie est intacte');
    // … et quitter par « Mes automatisations » depuis l'entrée de la garde ne la laisse pas sous la liste.
    await page.getByRole('button', { name: 'Mes automatisations' }).first().click();
    const quitter = page.getByRole('dialog').getByRole('button', { name: /^(Quitter|Fermer|Abandonner)/ });
    if (await quitter.first().isVisible().catch(() => false)) await quitter.first().click();
    await page.waitForURL((url) => url.pathname === '/automations', { timeout: 15_000 }).catch(() => undefined);
    verifier(new URL(page.url()).pathname === '/automations', 'sortie par « Mes automatisations » : la liste');
    await page.goBack();
    await pause(1500);
    const apres = new URL(page.url()).pathname;
    await page.goBack();
    await pause(1500);
    verifier(apres.endsWith(regle.id) && new URL(page.url()).pathname === '/automations', `depuis la liste, « Précédent » rouvre l’éditeur UNE fois, puis revient à la liste (${apres} → ${new URL(page.url()).pathname})`);
    await page.context().close();
  },

  /** Remarque (a) — fenêtre basse (1024 × 768) : ce qu'« Enregistrer » va retirer est écrit dans la zone visible, et le bloc vient dans la vue. */
  async pli() {
    const b = await leBureau();
    await admin.from('company_settings').update({ default_language: 'fr' }).eq('org_id', b.orgA);
    const long = Array.from({ length: 14 }, (_, i) => `Ligne ${i + 1} du message, assez longue pour occuper la largeur du champ.`).join('\n');
    const regle = await creerRegle({ trigger_event: 'quote.sent', steps: [action('send_email', {
      subject: 'Votre devis', subject_en: 'Your quote', body: long, body_en: 'Hello,\nYour quote is ready.',
    })] });
    const page = await ouvrirPage();
    await page.setViewportSize({ width: 1024, height: 768 });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un courriel').click();
    const p = panneau(page);
    await p.waitFor();
    /** L'élément est-il, au moins en partie, dans la fenêtre ET dans la zone défilante du panneau ? */
    const dansLaVue = (selecteur: string) => page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      let visible = r.bottom > 0 && r.top < window.innerHeight && r.height > 0;
      for (let parent = el.parentElement; visible && parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!/(auto|scroll|hidden)/.test(style.overflowY)) continue;
        const cadre = parent.getBoundingClientRect();
        visible = r.bottom > cadre.top + 4 && r.top < cadre.bottom - 4;
      }
      return visible;
    }, selecteur);
    const BLOC = '[data-testid="autre-version"]';
    const AVIS = '[data-testid="avis-retrait-autre-version"]';
    verifier(!(await dansLaVue(BLOC)), 'à l’ouverture (1024 × 768, message long) : le bloc de la version anglaise est SOUS le pli');
    await p.getByLabel('Objet *', { exact: true }).fill('Votre soumission');
    await pause(900);
    verifier(await dansLaVue(AVIS), '« La version anglaise sera retirée. » est écrit dans la zone visible, à côté d’« Enregistrer »');
    verifier(((await page.locator(AVIS).textContent()) ?? '').startsWith('La version anglaise sera retirée.'), 'le texte de l’avis');
    verifier(await dansLaVue(BLOC), 'le bloc qui vient de se déplier est venu dans la vue');
    // On remonte au début du panneau : le bloc repasse sous le pli, l'avis reste à côté du bouton, « Voir » y ramène.
    await p.getByLabel('Objet *', { exact: true }).scrollIntoViewIfNeeded();
    await page.evaluate(() => { document.querySelectorAll('aside').forEach((a) => a.querySelectorAll('*').forEach((el) => { if (el.scrollTop > 0) el.scrollTop = 0; })); });
    await pause(400);
    verifier(!(await dansLaVue(BLOC)) && await dansLaVue(AVIS), 'remonté en haut : le bloc est de nouveau sous le pli, l’avis toujours visible');
    await page.locator(AVIS).getByRole('button', { name: 'Voir' }).click();
    await pause(900);
    verifier(await dansLaVue(BLOC), '« Voir » ramène le bloc dans la vue');
    await p.getByLabel('La garder telle quelle').check();
    verifier(await page.locator(AVIS).count() === 0, '« La garder telle quelle » : l’avis disparaît');
    await p.getByLabel('La retirer (vos clients recevront le texte ci-dessus)').check();
    await enregistrer(page).click();
    await pause(6000);
    const config = ((await etapes(regle.id))[0]?.action?.config ?? {}) as Record<string, string>;
    verifier(config.subject === 'Votre soumission' && !('subject_en' in config) && !('body_en' in config), `enregistré : la version anglaise entière est retirée (${Object.keys(config).join(', ')})`);
    await page.context().close();
  },

  /** Remarque (b) — l'étape choisie dans le tiroir, pas encore enregistrée : carte en pointillé, indicateur « Étape non enregistrée ». */
  async attente() {
    const regle = await creerRegle({ trigger_event: 'quote.sent', steps: [action('send_sms', { body: 'Bonjour [client_first_name]' })] });
    const page = await ouvrirPage();
    await ouvrirEditeur(page, regle.id);
    const entete = page.locator('header').filter({ hasText: 'Mes automatisations' }).first();
    verifier(((await entete.textContent()) ?? '').includes('Enregistré'), 'avant : « Enregistré »');
    await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
    await tiroir(page).getByRole('button', { name: /^Créer une tâche/ }).click();
    await panneau(page).waitFor();
    const enAttente = page.locator('div.border-dashed').filter({ hasText: 'En cours d’ajout — pas encore enregistrée' });
    verifier(await enAttente.count() === 1 && ((await enAttente.textContent()) ?? '').includes('Créer une tâche'), 'la carte en cours d’ajout est en pointillé, avec sa mention');
    verifier(await enAttente.evaluate((el) => getComputedStyle(el).borderTopStyle) === 'dashed', 'la bordure est réellement pointillée à l’écran');
    const pendant = (await entete.textContent()) ?? '';
    verifier(pendant.includes('Étape non enregistrée') && !pendant.includes('Enregistré'), `l’indicateur dit « Étape non enregistrée » (${pendant.replace(/\s+/g, ' ').slice(-40)})`);
    await pause(5000);
    verifier(((await lireRegle(regle.id)).steps as unknown[]).length === 1, 'rien n’est écrit en base pendant l’ajout');
    await enregistrer(page).click();
    await pause(500);
    verifier(await enAttente.count() === 0, 'panneau enregistré : plus de pointillé ni de mention');
    await pause(5000);
    verifier(((await lireRegle(regle.id)).steps as unknown[]).length === 2 && ((await entete.textContent()) ?? '').includes('Enregistré'), 'l’étape est en base, l’indicateur dit « Enregistré »');
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
