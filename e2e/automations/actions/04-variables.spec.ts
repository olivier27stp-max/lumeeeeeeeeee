/**
 * Les variables insérables dans le texte d'une action (carte de l'éditeur
 * § 2.9 et § 3.d : EDT-109 à EDT-117, EDT-132, EDT-133).
 *
 * Ce que le fichier prouve :
 *  · les 6 boutons « information du client » écrivent `[cle]` dans le message ;
 *  · « Champs de base » se déplie et offre les 90 variables système, un clic écrit `{{objet.cle}}` ;
 *  · chaque champ personnalisé actif du bureau a son bouton (jamais une propriété) ;
 *  · une variable insérée par bouton est bien remplie par le serveur (aperçu) ;
 *  · la variable va là où est le curseur, dans le champ où l'on écrit ;
 *  · une variable inconnue écrite à la main est signalée (#840), et le texto
 *    affiche le nombre de SMS facturés (#840).
 */
import { test, expect } from './_aides';

import {
  CAPTURES, donnees, creerBrouillonAvecAction, ouvrirEditeur, panneauEtape, champ, boutonEnregistrer,
  attendreConfig, attendreEnregistre, carte,
} from './_aides';
import type { Locator, Page } from '@playwright/test';

async function ouvrirEtape(page: Page, idRegle: string, titre: string): Promise<Locator> {
  await ouvrirEditeur(page, idRegle);
  await carte(page, titre).click();
  const p = panneauEtape(page);
  await expect(p).toBeVisible();
  return p;
}

const SIX = [
  { id: 'EDT-109', fr: 'Nom du client', variable: '[client_name]' },
  { id: 'EDT-110', fr: 'Nom de votre entreprise', variable: '[company_name]' },
  { id: 'EDT-111', fr: 'Total', variable: '[invoice_total]' },
  { id: 'EDT-112', fr: 'Lien facture', variable: '[invoice_link]' },
  { id: 'EDT-113', fr: 'Lien du devis', variable: '[quote_link]' },
  { id: 'EDT-114', fr: 'Date du rendez-vous', variable: '[appointment_date]' },
];

test.describe('variables — information du client', () => {
  test('[EDT-109][EDT-110][EDT-111][EDT-112][EDT-113][EDT-114][CHA-07] chacun des 6 boutons écrit sa variable dans le texte ; le texte est enregistré et relu tel quel', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour ' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await expect(p.getByText('Insérer une information du client', { exact: true })).toBeVisible();
    const zone = champ(p, 'Texte du message', true);
    let attendu = 'Bonjour ';
    for (const v of SIX) {
      await p.getByRole('button', { name: v.fr, exact: true }).click();
      attendu += v.variable;
      await expect(zone, `bouton « ${v.fr} »`).toHaveValue(attendu);
    }
    await page.screenshot({ path: `${CAPTURES}/variables-six.png` });
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { body: attendu });
    await attendreEnregistre(page);
    await page.reload();
    await expect(carte(page, 'Envoyer un texto')).toBeVisible({ timeout: 180_000 });
    await carte(page, 'Envoyer un texto').click();
    await expect(champ(panneauEtape(page), 'Texte du message', true)).toHaveValue(attendu);
  });

  test('[EDT-109][EDT-108] une action sans zone de texte (étiquette, webhook) n’offre aucun bouton de variable', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'ajouter_etiquette', { etiquette: 'VIP QA' });
    const p = await ouvrirEtape(page, regle.id, 'Ajouter une étiquette');
    await expect(champ(p, 'L’étiquette', true)).toBeVisible();
    await expect(p.getByText('Insérer une information du client')).toHaveCount(0);
    await expect(p.getByRole('button', { name: 'Nom du client', exact: true })).toHaveCount(0);
    await expect(p.getByText('Champs de base')).toHaveCount(0);
  });

  test('[EDT-109][CHA-07] la variable s’insère là où est le curseur, pas à la fin du texte @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour , merci de votre confiance.' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    const zone = champ(p, 'Texte du message', true);
    await zone.click();
    // Le curseur juste après « Bonjour ».
    await zone.evaluate((el) => { (el as HTMLTextAreaElement).setSelectionRange(8, 8); });
    await p.getByRole('button', { name: 'Nom du client', exact: true }).click();
    await expect(zone).toHaveValue('Bonjour [client_name], merci de votre confiance.');
  });

  test('[EDT-109][CHA-03][CHA-26] la variable va dans le champ où l’on écrivait (objet du courriel, titre de la tâche), pas dans un autre @defaut', async ({ page, bureau, marque }) => {
    const courriel = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Un mot pour ', body: 'Corps du message' }, { name: `${marque} objet` });
    let p = await ouvrirEtape(page, courriel.id, 'Envoyer un courriel');
    const objet = champ(p, 'Objet', true);
    await objet.click();
    await objet.press('End');
    await p.getByRole('button', { name: 'Nom du client', exact: true }).click();
    await expect.soft(objet, 'la variable arrive dans « Objet », où était le curseur').toHaveValue('Un mot pour [client_name]');
    await expect.soft(champ(p, 'Message', true), 'le message n’a pas bougé').toHaveValue('Corps du message');

    const tache = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'Rappeler ' }, { name: `${marque} titre` });
    p = await ouvrirEtape(page, tache.id, 'Créer une tâche');
    const titre = champ(p, 'Titre de la tâche', true);
    await titre.click();
    await titre.press('End');
    await p.getByRole('button', { name: 'Nom du client', exact: true }).click();
    await expect.soft(titre, 'la variable arrive dans « Titre de la tâche »').toHaveValue('Rappeler [client_name]');
    await expect.soft(champ(p, 'Détail', false), '« Détail » reste vide').toHaveValue('');
  });

  test('[EDT-112][EDT-113][EDT-114] seules les variables que ce déclencheur sait remplir sont offertes (pas de « Lien facture » sur un devis) @defaut', async ({ page, bureau, marque }) => {
    // « Devis envoyé » fait arriver un devis : ni facture, ni rendez-vous.
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await expect(p.getByRole('button', { name: 'Lien du devis', exact: true })).toBeVisible();
    await expect.soft(p.getByRole('button', { name: 'Lien facture', exact: true }), '« Lien facture » sur un devis partirait vide').toHaveCount(0);
    await expect.soft(p.getByRole('button', { name: 'Date du rendez-vous', exact: true }), '« Date du rendez-vous » sur un devis partirait vide').toHaveCount(0);
  });
});

test.describe('variables — champs de base et champs personnalisés', () => {
  test('[EDT-115][EDT-116] « Champs de base » est replié, se déplie sur 90 variables système, et un clic écrit {{objet.cle}}', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour ' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await expect(p.getByText('Insérer un champ', { exact: true })).toBeVisible();
    const bloc = p.locator('details').filter({ hasText: 'Champs de base' });
    await expect(bloc).not.toHaveAttribute('open', '');
    await expect(p.getByRole('button', { name: 'Client · Prénom', exact: true })).toBeHidden();

    await bloc.locator('summary').click();
    await expect(bloc).toHaveAttribute('open', '');
    const boutons = bloc.getByRole('button');
    await expect(boutons).toHaveCount(90);
    const lus = await boutons.evaluateAll((bs) => bs.map((b) => ({ texte: (b.textContent ?? '').trim(), titre: b.getAttribute('title') ?? '' })));
    const parObjet = (prefixe: string) => lus.filter((b) => b.texte.startsWith(`${prefixe} · `)).length;
    expect({ client: parObjet('Client'), pipeline: parObjet('Pipeline'), job: parObjet('Job'), devis: parObjet('Devis'), facture: parObjet('Facture') })
      .toEqual({ client: 20, pipeline: 11, job: 25, devis: 22, facture: 12 });
    // L'infobulle montre exactement ce qui sera écrit.
    expect(lus.find((b) => b.texte === 'Client · Prénom')?.titre).toBe('{{client.first_name}}');
    expect(lus.find((b) => b.texte === 'Devis · Numéro de devis' || b.titre === '{{quote.quote_number}}')?.titre).toBe('{{quote.quote_number}}');
    await page.screenshot({ path: `${CAPTURES}/variables-champs-de-base.png` });

    const zone = champ(p, 'Texte du message', true);
    await p.getByRole('button', { name: 'Client · Prénom', exact: true }).click();
    await expect(zone).toHaveValue('Bonjour {{client.first_name}}');
    await bloc.locator('button[title="{{invoice.total}}"]').click();
    await expect(zone).toHaveValue('Bonjour {{client.first_name}}{{invoice.total}}');

    await bloc.locator('summary').click();
    await expect(p.getByRole('button', { name: 'Client · Prénom', exact: true })).toBeHidden();
  });

  test('[EDT-117] chaque champ personnalisé actif du bureau a son bouton « Objet · nom » ; un clic écrit {{objet.cle}} ; les champs de propriété n’y sont pas', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Objet', body: 'Bonjour ' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un courriel');
    const LIBELLE: Record<string, string> = { client: 'Client', deal: 'Pipeline', job: 'Job', quote: 'Devis', invoice: 'Facture' };
    const attendus = Object.values(d.champs).filter((c) => c.object_type !== 'property');
    for (const c of attendus) {
      const b = p.getByRole('button', { name: `${LIBELLE[c.object_type]} · ${c.label}`, exact: true });
      await expect(b, `bouton du champ ${c.key}`).toBeVisible();
      await expect(b).toHaveAttribute('title', `{{${c.object_type}.${c.key}}}`);
    }
    for (const c of Object.values(d.champs).filter((x) => x.object_type === 'property')) {
      await expect(p.getByRole('button', { name: new RegExp(`· ${c.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })).toHaveCount(0);
    }
    const zone = champ(p, 'Message', true);
    await p.getByRole('button', { name: 'Client · Fin de garantie QA', exact: true }).click();
    await p.getByRole('button', { name: 'Pipeline · Fermeture prévue QA', exact: true }).click();
    await expect(zone).toHaveValue('Bonjour {{client.qa_fin_garantie}}{{deal.qa_fermeture}}');
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { subject: 'Objet', body: 'Bonjour {{client.qa_fin_garantie}}{{deal.qa_fermeture}}' });
    await attendreEnregistre(page);
  });

  test('[EDT-109][EDT-110][EDT-116][EDT-017] une variable insérée par bouton est bien remplie par le serveur : l’aperçu montre le nom du client et de l’entreprise', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'send_sms', { body: 'Début ' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await p.getByRole('button', { name: 'Nom du client', exact: true }).click();
    await p.getByRole('button', { name: 'Nom de votre entreprise', exact: true }).click();
    await p.locator('details').filter({ hasText: 'Champs de base' }).locator('summary').click();
    await p.getByRole('button', { name: 'Client · Nom de famille', exact: true }).click();
    await expect(champ(p, 'Texte du message', true)).toHaveValue('Début [client_name][company_name]{{client.last_name}}');
    await champ(p, 'Texte du message', true).fill('Bonjour [client_name] — [company_name] — {{client.last_name}} — fin');
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { body: 'Bonjour [client_name] — [company_name] — {{client.last_name}} — fin' });
    await attendreEnregistre(page);

    await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ce qui partirait' })).toBeVisible({ timeout: 120_000 });
    await page.screenshot({ path: `${CAPTURES}/variables-apercu.png` });
    // Le client d'exemple est le plus récent qui a un courriel ; on lit son nom dans l'aperçu lui-même.
    const { data: client } = await bureau.admin.from('clients').select('first_name, last_name').eq('org_id', bureau.orgA).is('deleted_at', null).not('email', 'is', null).order('created_at', { ascending: false }).limit(1).single();
    const nom = `${client?.first_name ?? ''} ${client?.last_name ?? ''}`.trim();
    await expect(page.getByText(`Bonjour ${nom} — Nettoyage Test A — ${client?.last_name ?? ''} — fin`)).toBeVisible();
    await page.getByRole('button', { name: 'Fermer l’aperçu' }).click();
  });
});

test.describe('variables — écrites à la main', () => {
  test('[EDT-132][CHA-07] une variable inconnue écrite à la main est signalée : « Variable inconnue : [x] — sera vide dans le message envoyé. » (corrigé par #840, absent de cette copie)', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await champ(p, 'Texte du message', true).fill('Bonjour [prenom], votre devis est prêt.');
    await page.screenshot({ path: `${CAPTURES}/variable-inconnue.png` });
    await expect(p.getByRole('alert')).toHaveText('Variable inconnue : [prenom] — sera vide dans le message envoyé.', { timeout: 5_000 });
  });

  test('[EDT-132][CHA-03][CHA-26] l’alerte vaut aussi pour l’objet d’un courriel et le titre d’une tâche, et en nomme plusieurs (corrigé par #840, absent de cette copie)', async ({ page, bureau, marque }) => {
    const courriel = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Objet', body: 'Corps' }, { name: `${marque} objet inconnu` });
    let p = await ouvrirEtape(page, courriel.id, 'Envoyer un courriel');
    await champ(p, 'Objet', true).fill('Pour [prenom]');
    await champ(p, 'Message', true).fill('Bonjour [surnom], à bientôt.');
    await expect.soft(p.getByRole('alert')).toHaveText('Variables inconnues : [prenom], [surnom] — sera vide dans le message envoyé.', { timeout: 5_000 });

    const tache = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'Rappeler' }, { name: `${marque} titre inconnu` });
    p = await ouvrirEtape(page, tache.id, 'Créer une tâche');
    await champ(p, 'Titre de la tâche', true).fill('Rappeler [prenom]');
    await expect.soft(p.getByRole('alert')).toHaveText('Variable inconnue : [prenom] — sera vide dans le message envoyé.', { timeout: 5_000 });
  });

  test('[EDT-132][EDT-109][EDT-116][EDT-117] aucune variable offerte par un bouton ne déclenche l’alerte « Variable inconnue »', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: '' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    for (const v of SIX) await p.getByRole('button', { name: v.fr, exact: true }).click();
    await p.locator('details').filter({ hasText: 'Champs de base' }).locator('summary').click();
    // Toutes les variables système, puis tous les champs personnalisés.
    const systeme = p.locator('details').getByRole('button');
    const n = await systeme.count();
    for (let i = 0; i < n; i++) await systeme.nth(i).click();
    const perso = p.locator('button[title^="{{"]').and(p.locator(':not(details button)'));
    const m = await perso.count();
    for (let i = 0; i < m; i++) await perso.nth(i).click();
    const texte = await champ(p, 'Texte du message', true).inputValue();
    expect(texte).toContain('[appointment_date]');
    expect(texte).toContain('{{invoice.total}}');
    expect(texte).toContain('{{client.qa_fin_garantie}}');
    await expect(p.getByRole('alert')).toHaveCount(0);
  });

  test('[EDT-133][CHA-07] le texto affiche le nombre de SMS facturés : « 200 / 1600 · 2 SMS » (corrigé par #840, absent de cette copie)', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await champ(p, 'Texte du message', true).fill('a'.repeat(200));
    await page.screenshot({ path: `${CAPTURES}/texto-compteur.png` });
    await expect(p.getByText('200 / 1600 · 2 SMS', { exact: true })).toBeVisible({ timeout: 5_000 });
  });
});
