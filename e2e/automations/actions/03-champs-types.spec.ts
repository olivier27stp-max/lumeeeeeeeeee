/**
 * Le champ générique d'une action, type par type (carte de l'éditeur § 2.7 :
 * EDT-075 à EDT-086) et les saisies de « Mettre à jour un champ » (EDT-105 à 107).
 *
 * Pour chaque type — texte, zone, nombre, choix, bascule, membre, étiquette,
 * adresse, automatisation, champ personnalisé, et les trois types qui ne
 * servent qu'aux réglages d'un déclencheur (étape de pipeline, champ date,
 * service) — le fichier prouve :
 *  · vide : un champ obligatoire vide empêche d'enregistrer et dit lequel ;
 *  · valide : la valeur est enregistrée telle quelle, par son identifiant quand
 *    c'est une liste, et relue par son nom ;
 *  · invalide (nombre hors bornes, adresse en http://, courriel faux) : refusé
 *    AVANT l'enregistrement, avec la raison ;
 *  · trop long : rien n'est coupé en silence ;
 *  · accents, émojis, caractères spéciaux : gardés au caractère près.
 */
import { test, expect } from './_aides';
import { creerRegle } from '../_outils/banc';
import {
  CAPTURES, donnees, creerBrouillon, creerBrouillonAvecAction, ouvrirEditeur, panneauEtape, champ, boutonEnregistrer,
  attendreConfig, attendreEnregistre, finStable, quitterSansEnregistrer, carte, optionChoisie, etapesEnBase, configDe,
} from './_aides';
import type { Locator, Page } from '@playwright/test';

const SPECIAUX = 'Été à Québec — 50 % & "guillemets" <script>alert(1)</script> 😀 l’apostrophe';

/**
 * Remplit un champ jusqu'à sa limite, puis TAPE la suite au clavier, comme un
 * utilisateur qui continue d'écrire : la limite `maxLength` du navigateur s'applique.
 * Rend le texte que l'utilisateur a voulu écrire.
 */
async function ecrireAuDela(page: Page, el: Locator, max: number, suite: string): Promise<string> {
  const plein = 'ab'.repeat(Math.ceil(max / 2)).slice(0, max);
  await el.fill(plein);
  await el.press('End');
  await page.keyboard.type(suite);
  return plein + suite;
}

/** Ouvre la carte de l'unique action d'une règle préparée en base. */
async function ouvrirEtape(page: Page, idRegle: string, titre: string): Promise<Locator> {
  await ouvrirEditeur(page, idRegle);
  await carte(page, titre).click();
  const p = panneauEtape(page);
  await expect(p).toBeVisible();
  return p;
}

// ── texte ─────────────────────────────────────────────────────────────────

test.describe('champ « texte »', () => {
  test('[EDT-086][CHA-03][CHA-05][EDT-126][EDT-130] obligatoire vide (ou fait d’espaces) : « Enregistrer » est grisé et le panneau dit quel champ est vide', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Objet de départ', body: 'Corps de départ' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un courriel');
    const objet = champ(p, 'Objet', true);
    await expect(boutonEnregistrer(p)).toBeEnabled();

    await objet.fill('');
    await expect(boutonEnregistrer(p)).toBeDisabled();
    // Dit deux fois : dans l'encadré, et à côté du bouton.
    await expect(p.getByText('« Objet » est vide.')).toHaveCount(2);

    await objet.fill('     ');
    await expect(boutonEnregistrer(p)).toBeDisabled();

    // Deux champs vides : l'encadré les liste tous les deux, le pied dit le premier.
    await champ(p, 'Message', true).fill('');
    await expect(p.getByRole('listitem').filter({ hasText: 'est vide.' })).toHaveText(['« Objet » est vide.', '« Message » est vide.']);
    await page.screenshot({ path: `${CAPTURES}/texte-obligatoire-vide.png` });

    await objet.fill('Objet corrigé');
    await champ(p, 'Message', true).fill('Corps corrigé');
    await expect(boutonEnregistrer(p)).toBeEnabled();
    await expect(p.getByText('est vide.')).toHaveCount(0);
    // Rien n'a été écrit pendant que l'étape était invalide.
    expect(configDe(await etapesEnBase(bureau, regle.id))).toEqual({ subject: 'Objet de départ', body: 'Corps de départ' });
  });

  test('[EDT-086][CHA-01][CHA-03][CHA-04] accents, émojis, guillemets, esperluette et balises : gardés au caractère près, jamais interprétés', async ({ page, bureau, marque }) => {
    const alertes: string[] = [];
    page.on('dialog', (d) => { alertes.push(d.message()); void d.dismiss(); });
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Objet de départ', body: 'Corps de départ' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un courriel');
    await champ(p, 'Nom de l’expéditeur', false).fill(SPECIAUX);
    await champ(p, 'Objet', true).fill(SPECIAUX);
    await champ(p, 'Aperçu', false).fill(SPECIAUX);
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { from_name: SPECIAUX, subject: SPECIAUX, preheader: SPECIAUX, body: 'Corps de départ' });
    await attendreEnregistre(page);

    await page.reload();
    await expect(carte(page, 'Envoyer un courriel')).toBeVisible({ timeout: 180_000 });
    await carte(page, 'Envoyer un courriel').click();
    const relu = panneauEtape(page);
    await expect(champ(relu, 'Nom de l’expéditeur', false)).toHaveValue(SPECIAUX);
    await expect(champ(relu, 'Objet', true)).toHaveValue(SPECIAUX);
    await expect(champ(relu, 'Aperçu', false)).toHaveValue(SPECIAUX);
    expect(alertes, 'aucune balise n’a été exécutée').toEqual([]);
  });

  test('[EDT-086][EDT-084][EDT-103][CHA-03][CHA-15][CHA-19] trop long : ce qu’on écrit au-delà de la limite n’est pas perdu en silence @defaut', async ({ page, bureau, marque }) => {
    const fautes: string[] = [];
    const essais: Array<{ action: string; titre: string; declencheur: string; config: Record<string, string>; libelle: string; obligatoire: boolean; max: number }> = [
      { action: 'send_email', titre: 'Envoyer un courriel', declencheur: 'quote.sent', config: { subject: 'x', body: 'x' }, libelle: 'Objet', obligatoire: true, max: 200 },
      { action: 'ajouter_etiquette', titre: 'Ajouter une étiquette', declencheur: 'lead.created', config: { etiquette: 'x' }, libelle: 'L’étiquette', obligatoire: true, max: 60 },
      { action: 'modifier_client', titre: 'Modifier le client', declencheur: 'lead.created', config: { source: 'x' }, libelle: 'Source', obligatoire: false, max: 60 },
    ];
    for (const e of essais) {
      const regle = await creerBrouillonAvecAction(bureau, marque, e.declencheur, e.action, e.config, { name: `${marque} long ${e.action}` });
      const p = await ouvrirEtape(page, regle.id, e.titre);
      const el = champ(p, e.libelle, e.obligatoire);
      const texte = await ecrireAuDela(page, el, e.max, ' — LA FIN QUI DÉPASSE');
      const garde = await el.inputValue();
      if (garde.length < texte.length) {
        // Le texte a été coupé : l'écran doit le dire (compteur, « limite atteinte », message).
        const bloc = el.locator('xpath=..');
        const dit = /limite|maximum|caractères|\/ ?\d+/i.test(await bloc.innerText());
        if (!dit) fautes.push(`« ${e.libelle} » (${e.titre}) : ${texte.length} caractères écrits, ${garde.length} gardés, aucun message ni compteur`);
      }
    }
    // Le nom de l'action (80) : même contrôle.
    {
      const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'x' }, { name: `${marque} long nom` });
      const p = await ouvrirEtape(page, regle.id, 'Créer une tâche');
      const el = p.getByLabel('Nom de l’action (facultatif)', { exact: true });
      const texte = await ecrireAuDela(page, el, 80, ' — LA FIN DU NOM');
      const garde = await el.inputValue();
      if (garde.length < texte.length && !/limite|maximum|\/ ?80/i.test(await el.locator('xpath=..').innerText())) {
        fautes.push(`« Nom de l’action » : ${texte.length} caractères écrits, ${garde.length} gardés, aucun message ni compteur`);
      }
    }
    expect(fautes, 'champs où le texte au-delà de la limite est perdu sans rien dire').toEqual([]);
  });

  test('[CHA-02][EDT-086] « Répondre à » : une adresse courriel fausse est signalée avant d’enregistrer @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Objet', body: 'Corps' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un courriel');
    await champ(p, 'Répondre à', false).fill('pas-une-adresse');
    // Attendu : l'étape n'est pas enregistrable telle quelle, et le panneau dit pourquoi.
    await expect.soft(boutonEnregistrer(p)).toBeDisabled();
    await expect(p.getByText(/adresse (courriel )?(invalide|incorrecte|non valide)|n’est pas une adresse/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ── zone ──────────────────────────────────────────────────────────────────

test.describe('champ « zone »', () => {
  test('[EDT-075][CHA-07] le compteur suit la saisie, prévient à l’approche de la limite, et la limite atteinte est dite', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    const zone = champ(p, 'Texte du message', true);
    await expect(p.getByText('7 / 1600', { exact: true })).toBeVisible();
    await zone.fill('a'.repeat(200));
    await expect(p.getByText(/^200 \/ 1600/)).toBeVisible();

    // À 1 600 caractères, continuer d'écrire ne garde rien de plus — et l'écran le dit.
    await ecrireAuDela(page, zone, 1600, ' SUITE PERDUE');
    expect((await zone.inputValue()).length).toBe(1600);
    await expect(p.getByText(/^1600 \/ 1600 · limite atteinte/)).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/zone-limite.png` });
  });

  test('[EDT-075][CHA-07][CHA-05] retours à la ligne, accents, émojis et caractères spéciaux : le texte enregistré et relu est exactement celui saisi', async ({ page, bureau, marque }) => {
    const texte = `Bonjour [client_name],\n\n${SPECIAUX}\n\tTabulation & fin — merci !`;
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: 'Bonjour' });
    const p = await ouvrirEtape(page, regle.id, 'Envoyer un texto');
    await champ(p, 'Texte du message', true).fill(texte);
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { body: texte });
    await attendreEnregistre(page);
    await page.reload();
    await expect(carte(page, 'Envoyer un texto')).toBeVisible({ timeout: 180_000 });
    await carte(page, 'Envoyer un texto').click();
    await expect(champ(panneauEtape(page), 'Texte du message', true)).toHaveValue(texte);
  });

  test('[CHA-07][EDT-037] la carte résume le texte tel qu’il est écrit, même avec « < » et « > » @defaut', async ({ page, bureau, marque }) => {
    const texte = 'Rabais si le total est < 500 $ ou > 1000 $';
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: texte });
    await ouvrirEditeur(page, regle.id);
    await expect(carte(page, 'Envoyer un texto')).toContainText(texte);
  });

  test('[EDT-075][CHA-07][CHA-23][EDT-126] obligatoire vide : « Enregistrer » est grisé et le panneau dit quel champ est vide', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'note.added', 'ajouter_note', { body: 'Note de départ' });
    const p = await ouvrirEtape(page, regle.id, 'Ajouter une note');
    await champ(p, 'La note', true).fill('\n  \n');
    await expect(boutonEnregistrer(p)).toBeDisabled();
    await expect(p.getByText('« La note » est vide.')).toHaveCount(2);
    await expect(p.getByText('0 / 4000').or(p.getByText('4 / 4000'))).toBeVisible();
  });
});

// ── nombre ────────────────────────────────────────────────────────────────

test.describe('champ « nombre »', () => {
  test('[EDT-077][CHA-29][CHA-20] une valeur aux bornes est enregistrée, les lettres sont refusées à la frappe', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'Rappeler [client_name]' });
    const p = await ouvrirEtape(page, regle.id, 'Créer une tâche');
    const jours = champ(p, 'À faire dans (jours)', false);
    await expect(jours).toHaveAttribute('min', '0');
    await expect(jours).toHaveAttribute('max', '365');
    await jours.click();
    await page.keyboard.type('abc');
    await expect(jours).toHaveValue('');
    await jours.fill('365');
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { title: 'Rappeler [client_name]', echeance_jours: '365' });
    await attendreEnregistre(page);
    await carte(page, 'Créer une tâche').click();
    await expect(champ(panneauEtape(page), 'À faire dans (jours)', false)).toHaveValue('365');
  });

  test('[EDT-077][CHA-29][CHA-20][EDT-126] hors bornes (999 jours, -5 jours, 10 000 001 $) : refusé dans le panneau, avec la borne @defaut', async ({ page, bureau, marque }) => {
    const fautes: string[] = [];
    const tache = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'Rappeler [client_name]' }, { name: `${marque} bornes tâche` });
    let p = await ouvrirEtape(page, tache.id, 'Créer une tâche');
    for (const v of ['999', '-5']) {
      await champ(p, 'À faire dans (jours)', false).fill(v);
      if (await boutonEnregistrer(p).isEnabled()) fautes.push(`« À faire dans (jours) » = ${v} (bornes 0 à 365) : « Enregistrer » reste actif, aucun message`);
    }
    const client = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'modifier_client', { source: 'x' }, { name: `${marque} bornes client` });
    p = await ouvrirEtape(page, client.id, 'Modifier le client');
    await champ(p, 'Valeur estimée ($)', false).fill('10000001');
    if (await boutonEnregistrer(p).isEnabled()) fautes.push('« Valeur estimée ($) » = 10000001 (maximum 10 000 000) : « Enregistrer » reste actif, aucun message');
    expect(fautes, 'valeurs hors bornes acceptées par le panneau').toEqual([]);
  });

  test('[EDT-077][CHA-29][EDT-130] un nombre hors bornes enregistré dans l’étape : le refus du serveur est expliqué clairement, sans boucle de « nouvel essai » @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(/400 PATCH .*\/api\/automations\/rules\//, 'le serveur refuse 999 jours (maximum 365)');
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'Rappeler [client_name]' });
    const p = await ouvrirEtape(page, regle.id, 'Créer une tâche');
    await champ(p, 'À faire dans (jours)', false).fill('999');
    await boutonEnregistrer(p).click();
    // Le panneau l'a laissé passer (voir le test précédent) : 3 s plus tard, l'enregistrement automatique part.
    const toast = page.getByRole('region', { name: /Notifications/ }).getByRole('listitem').filter({ hasText: /jours|Enregistrement/ }).first();
    await expect(toast).toBeVisible({ timeout: 120_000 });
    const texte = await toast.innerText();
    await page.screenshot({ path: `${CAPTURES}/nombre-hors-bornes-toast.png` });
    // La base n'a pas pris la valeur refusée.
    expect(configDe(await etapesEnBase(bureau, regle.id))).toEqual({ title: 'Rappeler [client_name]' });
    // Attendu : un message qui nomme le champ et la borne, en bon français, et qui ne promet pas un « nouvel essai » voué à échouer.
    expect.soft(texte, 'le message nomme le champ et la borne').toMatch(/À faire dans \(jours\).*365/);
    expect.soft(texte, 'en français accentué').not.toMatch(/doit etre/);
    expect.soft(texte, 'pas de « nouvel essai automatique » pour une saisie refusée').not.toMatch(/nouvel essai automatique/);
    // Et l'étape fautive est désignée : l'indicateur ne reste pas sur « Modifié » sans issue.
    await expect.soft(page.getByText('Modifié', { exact: true })).toBeHidden({ timeout: 10_000 });
    await quitterSansEnregistrer(page);
  });
});

// ── choix ─────────────────────────────────────────────────────────────────

test.describe('champ « choix »', () => {
  test('[EDT-076][CHA-31][EDT-126] obligatoire non choisi : « Enregistrer » est grisé et le panneau dit quel champ est vide', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'appointment.created', 'modifier_statut_rendezvous', {});
    const p = await ouvrirEtape(page, regle.id, 'Changer le statut du rendez-vous');
    await expect(champ(p, 'Nouveau statut', true)).toHaveValue('');
    await expect(boutonEnregistrer(p)).toBeDisabled();
    await expect(p.getByText('« Nouveau statut » est vide.')).toHaveCount(2);
    await champ(p, 'Nouveau statut', true).selectOption({ label: 'Annulé' });
    await expect(boutonEnregistrer(p)).toBeEnabled();
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { statut: 'cancelled' });
    await attendreEnregistre(page);
  });

  test('[EDT-076][CHA-18] revenir à l’option vide retire la valeur : la base ne garde pas l’ancien choix', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'modifier_client', { statut: 'active', source: 'Site web' });
    const p = await ouvrirEtape(page, regle.id, 'Modifier le client');
    expect(await optionChoisie(champ(p, 'Statut', false))).toBe('Client actif');
    await champ(p, 'Statut', false).selectOption({ label: '— Inchangé —' });
    await boutonEnregistrer(p).click();
    await attendre0(async () => {
      const c = configDe(await etapesEnBase(bureau, regle.id));
      return !c?.statut;
    });
    const config = configDe(await etapesEnBase(bureau, regle.id));
    expect(config?.source).toBe('Site web');
    expect(config?.statut ?? '').toBe('');
    await attendreEnregistre(page);
  });
});

/** Attend qu'une condition asynchrone devienne vraie (sans délai fixe). */
async function attendre0(ok: () => Promise<boolean>, delaiMs = 150_000): Promise<void> {
  await expect.poll(ok, { timeout: delaiMs, intervals: [500] }).toBe(true);
}

// ── bascule ───────────────────────────────────────────────────────────────

test.describe('champ « bascule »', () => {
  test('[EDT-078][CHA-16][CHA-17] « Retirer toutes les étiquettes » : cochée, elle masque « L’étiquette » ; l’état est enregistré et relu', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'client.tagged', 'retirer_etiquette', {});
    const p = await ouvrirEtape(page, regle.id, 'Retirer une étiquette');
    const toutes = p.getByLabel('Retirer toutes les étiquettes', { exact: true });
    await expect(toutes).not.toBeChecked();
    await expect(champ(p, 'L’étiquette', false)).toBeVisible();

    // Le libellé est cliquable (pas seulement la case).
    await p.getByText('Retirer toutes les étiquettes', { exact: true }).click();
    await expect(toutes).toBeChecked();
    await expect(champ(p, 'L’étiquette', false)).toBeHidden();
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { toutes: 'true' });
    await attendreEnregistre(page);

    await page.reload();
    await expect(carte(page, 'Retirer une étiquette')).toBeVisible({ timeout: 180_000 });
    await carte(page, 'Retirer une étiquette').click();
    const relu = panneauEtape(page);
    await expect(relu.getByLabel('Retirer toutes les étiquettes', { exact: true })).toBeChecked();
    await expect(champ(relu, 'L’étiquette', false)).toBeHidden();

    // Décochée : l'étiquette revient, et « false » est enregistré.
    await relu.getByLabel('Retirer toutes les étiquettes', { exact: true }).uncheck();
    await champ(relu, 'L’étiquette', false).fill('VIP QA');
    await boutonEnregistrer(relu).click();
    await attendreConfig(bureau, regle.id, { toutes: 'false', etiquette: 'VIP QA' });
    await attendreEnregistre(page);
  });

  test('[CHA-16][CHA-17][EDT-108] une étiquette saisie puis masquée par « toutes » n’est pas enregistrée en cachette @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'client.tagged', 'retirer_etiquette', {});
    const p = await ouvrirEtape(page, regle.id, 'Retirer une étiquette');
    await champ(p, 'L’étiquette', false).fill('VIP QA');
    await p.getByLabel('Retirer toutes les étiquettes', { exact: true }).check();
    await expect(champ(p, 'L’étiquette', false)).toBeHidden();
    await boutonEnregistrer(p).click();
    await attendre0(async () => configDe(await etapesEnBase(bureau, regle.id))?.toutes === 'true');
    await attendreEnregistre(page);
    // L'écran ne montre que la case cochée : la base ne doit rien porter d'autre.
    expect(configDe(await etapesEnBase(bureau, regle.id))).toEqual({ toutes: 'true' });
  });

  test('[CHA-11][CHA-12][EDT-108] « Le membre » n’apparaît que pour « Un membre précis », et un membre choisi puis masqué n’est pas enregistré en cachette @defaut', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_notification', { title: 'Suivi' });
    const p = await ouvrirEtape(page, regle.id, 'Notifier l’équipe');
    await expect(champ(p, 'Le membre', false)).toBeHidden();
    await champ(p, 'Pour qui', false).selectOption({ label: 'Un membre précis' });
    await expect(champ(p, 'Le membre', false)).toBeVisible();
    await champ(p, 'Le membre', false).selectOption({ label: d.membres.tech.nom });
    await champ(p, 'Pour qui', false).selectOption({ label: 'Le propriétaire' });
    await expect(champ(p, 'Le membre', false)).toBeHidden();
    await boutonEnregistrer(p).click();
    await attendre0(async () => configDe(await etapesEnBase(bureau, regle.id))?.destinataire === 'proprietaire');
    await attendreEnregistre(page);
    expect(configDe(await etapesEnBase(bureau, regle.id))).toEqual({ title: 'Suivi', destinataire: 'proprietaire' });
  });
});

// ── membre ────────────────────────────────────────────────────────────────

test.describe('champ « membre »', () => {
  test('[EDT-079][CHA-12][CHA-21][CHA-30][CHA-35] le menu liste les membres actifs du bureau, par leur nom, et personne d’un autre bureau', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'assigner_responsable', {});
    const p = await ouvrirEtape(page, regle.id, 'Assigner un responsable');
    const menu = champ(p, 'Le membre', false);
    await expect(menu.locator('option')).toHaveCount(4);
    const options = await menu.locator('option').evaluateAll((os) => os.map((o) => ({ valeur: (o as HTMLOptionElement).value, texte: (o.textContent ?? '').trim() })));
    expect(options).toEqual([
      { valeur: '', texte: '— Personne —' },
      { valeur: d.membres.admin.id, texte: 'QA Admin A' },
      { valeur: d.membres.proprio.id, texte: 'QA Proprio A' },
      { valeur: d.membres.tech.id, texte: 'QA Technicien A' },
    ]);
    expect(options.map((o) => o.valeur)).not.toContain(bureau.comptes.proprioB.id);
    await expect(p.getByText('Vide = retire le responsable actuel.')).toBeVisible();
  });

  test('[EDT-079] si la liste des membres ne peut pas être lue, le panneau le dit au lieu d’offrir un menu vide @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(/500 GET .*memberships/, 'panne simulée de la lecture des membres');
    await page.route(/\/rest\/v1\/memberships\?select=user_id%2Cfull_name&/, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"panne simulée"}' }));
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'assigner_responsable', {});
    const p = await ouvrirEtape(page, regle.id, 'Assigner un responsable');
    await expect(champ(p, 'Le membre', false).locator('option')).toHaveCount(1);
    await expect(p.getByText(/impossible de (lire|charger)|n’a pas pu être (lue|chargée)|réessay/i)).toBeVisible({ timeout: 5_000 });
  });
});

// ── étiquette ─────────────────────────────────────────────────────────────

test.describe('champ « étiquette »', () => {
  test('[EDT-084][CHA-15][EDT-126] les étiquettes du bureau sont proposées, une nouvelle peut être tapée, et vide elle empêche d’enregistrer', async ({ page, bureau, marque }) => {
    await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'ajouter_etiquette', {});
    const p = await ouvrirEtape(page, regle.id, 'Ajouter une étiquette');
    const saisie = champ(p, 'L’étiquette', true);
    await expect(boutonEnregistrer(p)).toBeDisabled();
    await expect(p.getByText('« L’étiquette » est vide.')).toHaveCount(2);

    // Les suggestions : la liste attachée au champ porte les étiquettes déjà utilisées.
    const idListe = await saisie.getAttribute('list');
    expect(idListe).toBeTruthy();
    const suggestions = await page.locator(`datalist[id="${idListe}"] option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    expect(suggestions).toEqual(expect.arrayContaining(['Ne pas relancer QA', 'VIP QA']));

    const nouvelle = `Nouvelle étiquette é à ç & <b> 😀`;
    await saisie.fill(nouvelle);
    await expect(boutonEnregistrer(p)).toBeEnabled();
    await boutonEnregistrer(p).click();
    await attendreConfig(bureau, regle.id, { etiquette: nouvelle });
    await attendreEnregistre(page);
    await carte(page, 'Ajouter une étiquette').click();
    await expect(champ(panneauEtape(page), 'L’étiquette', true)).toHaveValue(nouvelle);
  });
});

// ── adresse (url) ─────────────────────────────────────────────────────────

test.describe('champ « adresse »', () => {
  test('[EDT-085][CHA-38][EDT-126] vide : « Enregistrer » est grisé, le panneau dit quel champ est vide et rappelle « https:// »', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'webhook', {});
    const p = await ouvrirEtape(page, regle.id, 'Appeler un webhook');
    const adresse = champ(p, 'L’adresse', true);
    await expect(adresse).toHaveAttribute('placeholder', 'https://');
    await expect(p.getByText('Doit commencer par https://')).toBeVisible();
    await expect(boutonEnregistrer(p)).toBeDisabled();
    await expect(p.getByText('« L’adresse » est vide.')).toHaveCount(2);
  });

  test('[EDT-085][CHA-38][EDT-126] adresse en http://, malformée ou interne : refusée dans le panneau, avec la raison @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'webhook', {});
    const p = await ouvrirEtape(page, regle.id, 'Appeler un webhook');
    const fautes: string[] = [];
    for (const v of ['http://crochets.lume-qa.test/entrant', 'pas une adresse', 'ftp://crochets.lume-qa.test', 'https://localhost/interne']) {
      await champ(p, 'L’adresse', true).fill(v);
      if (await boutonEnregistrer(p).isEnabled()) fautes.push(`« ${v} » : « Enregistrer » reste actif, aucun message dans le panneau`);
    }
    await page.screenshot({ path: `${CAPTURES}/url-invalide-panneau.png` });
    expect(fautes, 'adresses que le serveur refusera, acceptées par le panneau').toEqual([]);
  });

  test('[EDT-085][CHA-38][EDT-130] une adresse en http:// enregistrée dans l’étape : le refus du serveur est expliqué clairement, sans boucle de « nouvel essai » @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(/400 PATCH .*\/api\/automations\/rules\//, 'le serveur refuse une adresse en http://');
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'webhook', { url: 'https://crochets.lume-qa.test/avant' });
    const p = await ouvrirEtape(page, regle.id, 'Appeler un webhook');
    await champ(p, 'L’adresse', true).fill('http://crochets.lume-qa.test/entrant');
    await boutonEnregistrer(p).click();
    const toast = page.getByRole('region', { name: /Notifications/ }).getByRole('listitem').filter({ hasText: /adresse|Enregistrement/i }).first();
    await expect(toast).toBeVisible({ timeout: 120_000 });
    const texte = await toast.innerText();
    await page.screenshot({ path: `${CAPTURES}/url-http-toast.png` });
    expect(configDe(await etapesEnBase(bureau, regle.id))).toEqual({ url: 'https://crochets.lume-qa.test/avant' });
    expect.soft(texte, 'le message dit que l’adresse doit commencer par https://').toMatch(/https:\/\//);
    expect.soft(texte, 'pas de « nouvel essai automatique » pour une saisie refusée').not.toMatch(/nouvel essai automatique/);
    await expect.soft(page.getByText('Modifié', { exact: true })).toBeHidden({ timeout: 10_000 });
    await quitterSansEnregistrer(page);
  });
});

// ── automatisation ────────────────────────────────────────────────────────

test.describe('champ « automatisation »', () => {
  test('[EDT-080][CHA-39][EDT-126] le menu n’offre que les AUTRES automatisations publiées du bureau ; rien de choisi empêche d’enregistrer', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const brouillonVoisin = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'x' }, { name: `${marque} brouillon à ne pas offrir` });
    const corbeille = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'create_task', { title: 'x' }, { name: `${marque} à la corbeille`, is_active: true, deleted_at: new Date().toISOString() });
    const autreBureau = await creerRegle(bureau, bureau.orgB, { name: `${marque} publiée du bureau B`, is_active: true });
    // La règle éditée est elle-même PUBLIÉE : elle ne doit pas se proposer elle-même.
    const regle = await creerBrouillonAvecAction(bureau, marque, 'client.untagged', 'demarrer_automatisation', { rule_id: d.reglePubliee.id }, { name: `${marque} éditée et publiée`, is_active: true });

    const p = await ouvrirEtape(page, regle.id, 'Démarrer une automatisation');
    const menu = champ(p, 'Laquelle', true);
    await expect(menu).toHaveValue(d.reglePubliee.id);
    expect(await optionChoisie(menu)).toBe(d.reglePubliee.nom);
    const options = await menu.locator('option').evaluateAll((os) => os.map((o) => ({ valeur: (o as HTMLOptionElement).value, texte: (o.textContent ?? '').trim() })));
    expect(options[0]).toEqual({ valeur: '', texte: '— Choisir —' });
    const ids = options.map((o) => o.valeur);
    expect(ids).toContain(d.reglePubliee.id);
    expect(ids, 'un brouillon n’est pas offert').not.toContain(brouillonVoisin.id);
    expect(ids, 'une automatisation à la corbeille n’est pas offerte').not.toContain(corbeille.id);
    expect(ids, 'une automatisation d’un autre bureau n’est pas offerte').not.toContain(autreBureau.id);
    expect(ids, 'l’automatisation ouverte ne se propose pas elle-même').not.toContain(regle.id);
    // Ce que le menu offre est exactement ce que la base tient pour publié et vivant dans ce bureau —
    // moins le préréglage RETIRÉ (« Estimate Follow-Up », semé sur `estimate.sent` que plus rien n'émet) :
    // depuis le commit 098dd153, la liste, l'éditeur et Lumi ne le montrent plus (il ne partirait jamais).
    const { data: publiees } = await bureau.admin.from('automation_rules').select('id, preset_key, trigger_event')
      .eq('org_id', bureau.orgA).eq('is_active', true).is('deleted_at', null).neq('id', regle.id);
    const retire = (r: { preset_key: unknown; trigger_event: unknown }) => r.preset_key === 'estimate_followup' && r.trigger_event === 'estimate.sent';
    const retirees = (publiees ?? []).filter(retire).map((r) => String(r.id));
    for (const id of retirees) expect(ids, 'un préréglage retiré (déclencheur mort) n’est pas offert').not.toContain(id);
    expect(ids.slice(1).sort()).toEqual((publiees ?? []).filter((r) => !retire(r)).map((r) => String(r.id)).sort());
    await expect(p.getByText('Seules les automatisations PUBLIÉES sont proposées : un brouillon n’enverrait rien.')).toBeVisible();

    await menu.selectOption({ label: '— Choisir —' });
    await expect(boutonEnregistrer(p)).toBeDisabled();
    await expect(p.getByText('« Laquelle » est vide.')).toHaveCount(2);
  });

  test('[EDT-080][CHA-39] sans aucune autre automatisation publiée, le panneau le dit à la place du menu', async ({ page, bureau, marque }) => {
    // État provoqué : la réponse de l'éditeur est rendue sans « autres » (un bureau neuf sans rien de publié).
    await page.route('**/api/automations/editeur**', async (route) => {
      const r = await route.fetch();
      const j = await r.json();
      await route.fulfill({ response: r, json: { ...j, autres: [] } });
    });
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'demarrer_automatisation', {});
    const p = await ouvrirEtape(page, regle.id, 'Démarrer une automatisation');
    await expect(p.getByText('Aucune autre automatisation publiée à démarrer.')).toBeVisible();
    await expect(p.getByRole('combobox', { name: /Laquelle/ })).toHaveCount(0);
    await expect(boutonEnregistrer(p)).toBeDisabled();
    await expect(p.getByText('« Laquelle » est vide.')).toHaveCount(2);
  });
});

// ── champ personnalisé (« Mettre à jour un champ ») ───────────────────────

test.describe('« Mettre à jour un champ personnalisé »', () => {
  test('[EDT-105][CHA-24][EDT-126] le menu n’offre que les champs de la fiche que le déclencheur fait arriver ; rien de choisi empêche d’enregistrer', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'update_custom_field', {});
    const p = await ouvrirEtape(page, regle.id, 'Mettre à jour un champ personnalisé');
    const menu = champ(p, 'Champ', true);
    await expect(boutonEnregistrer(p)).toBeDisabled();
    await expect(p.getByText('« Champ » est vide.')).toHaveCount(2);

    const options = await menu.locator('option').evaluateAll((os) => os.map((o) => ({ valeur: (o as HTMLOptionElement).value, texte: (o.textContent ?? '').trim() })));
    expect(options[0]).toEqual({ valeur: '', texte: '— Choisir un champ —' });
    const duClient = Object.values(d.champs).filter((c) => c.object_type === 'client');
    expect(options.slice(1).map((o) => o.valeur).sort()).toEqual(duClient.map((c) => c.id).sort());
    for (const c of duClient) expect(options.find((o) => o.valeur === c.id)?.texte).toBe(c.label);
    // Un seul groupe : « Client ».
    expect(await menu.locator('optgroup').evaluateAll((gs) => gs.map((g) => g.getAttribute('label')))).toEqual(['Client']);
  });

  test('[EDT-105][EDT-106][EDT-107][CHA-24][CHA-25] chaque type de champ a sa saisie ; la valeur est enregistrée telle qu’affichée et relue à l’identique', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'update_custom_field', { field_id: d.champs.qa_surnom.id, value: 'Départ' });
    await ouvrirEditeur(page, regle.id);
    const titre = 'Mettre à jour un champ personnalisé';
    const interets = d.champs.qa_interets;

    const essais: Array<{ cle: string; saisir: (valeur: Locator, p: Locator) => Promise<void>; enregistre: string; relire: (valeur: Locator, p: Locator) => Promise<void> }> = [
      {
        cle: 'qa_surnom', enregistre: SPECIAUX,
        saisir: async (v) => { await expect(v).toHaveAttribute('type', 'text'); await v.fill(SPECIAUX); },
        relire: async (v) => { await expect(v).toHaveValue(SPECIAUX); },
      },
      {
        cle: 'qa_remarques', enregistre: 'Première ligne\nDeuxième ligne — é à ç',
        saisir: async (v) => { await v.fill('Première ligne\nDeuxième ligne — é à ç'); },
        relire: async (v) => { await expect(v).toHaveValue('Première ligne\nDeuxième ligne — é à ç'); },
      },
      {
        cle: 'qa_nb_employes', enregistre: '12',
        saisir: async (v) => { await expect(v).toHaveAttribute('type', 'number'); await v.fill('12'); },
        relire: async (v) => { await expect(v).toHaveValue('12'); },
      },
      {
        cle: 'qa_budget', enregistre: '1250.5',
        saisir: async (v, p) => { await v.fill('1250.5'); await expect(p.getByText('En dollars. Vide = effacer le champ.')).toBeVisible(); },
        relire: async (v) => { await expect(v).toHaveValue('1250.5'); },
      },
      {
        cle: 'qa_fin_garantie', enregistre: '2027-03-15',
        saisir: async (v) => { await expect(v).toHaveAttribute('type', 'date'); await v.fill('2027-03-15'); },
        relire: async (v) => { await expect(v).toHaveValue('2027-03-15'); },
      },
      {
        cle: 'qa_infolettre', enregistre: 'true',
        saisir: async (v) => { await v.selectOption({ label: 'Oui (cochée)' }); },
        relire: async (v) => { expect(await optionChoisie(v)).toBe('Oui (cochée)'); },
      },
      {
        cle: 'qa_type_client', enregistre: d.champs.qa_type_client.options[0].id,
        saisir: async (v) => { await v.selectOption({ label: 'Résidentiel' }); },
        relire: async (v) => { expect(await optionChoisie(v)).toBe('Résidentiel'); },
      },
      {
        // Liste multiple : des cases, enregistrées dans l'ordre de la liste (pas celui des clics).
        cle: 'qa_interets', enregistre: `${interets.options[0].id},${interets.options[2].id}`,
        saisir: async (_v, p) => { await p.getByLabel('Lavage à pression', { exact: true }).check(); await p.getByLabel('Vitres', { exact: true }).check(); },
        relire: async (_v, p) => {
          await expect(p.getByLabel('Vitres', { exact: true })).toBeChecked();
          await expect(p.getByLabel('Gouttières', { exact: true })).not.toBeChecked();
          await expect(p.getByLabel('Lavage à pression', { exact: true })).toBeChecked();
        },
      },
      {
        cle: 'courriel_facturation', enregistre: 'facturation@lume-qa.test',
        saisir: async (v) => { await expect(v).toHaveAttribute('type', 'email'); await v.fill('facturation@lume-qa.test'); },
        relire: async (v) => { await expect(v).toHaveValue('facturation@lume-qa.test'); },
      },
    ];

    for (const e of essais) {
      await test.step(`type ${d.champs[e.cle].field_type} — « ${d.champs[e.cle].label} »`, async () => {
        await carte(page, titre).click();
        const p = panneauEtape(page);
        await champ(p, 'Champ', true).selectOption({ label: d.champs[e.cle].label });
        // Changer de champ vide la valeur : une option d'un autre champ n'aurait aucun sens.
        const valeur = p.locator(`[id="${await p.getByText('Nouvelle valeur', { exact: false }).first().getAttribute('for')}"]`);
        await e.saisir(valeur, p);
        await boutonEnregistrer(p).click();
        await attendreConfig(bureau, regle.id, { field_id: d.champs[e.cle].id, value: e.enregistre });
        await attendreEnregistre(page);
        await carte(page, titre).click();
        const relu = panneauEtape(page);
        expect(await optionChoisie(champ(relu, 'Champ', true))).toBe(d.champs[e.cle].label);
        const valeurRelue = relu.locator(`[id="${await relu.getByText('Nouvelle valeur', { exact: false }).first().getAttribute('for')}"]`);
        await e.relire(valeurRelue, relu);
        await relu.getByRole('button', { name: 'Annuler', exact: true }).click();
        await expect(relu).toBeHidden();
      });
    }
  });

  test('[EDT-106][CHA-25] valeur vide = effacer le champ : c’est dit, et c’est ce qui est enregistré', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'update_custom_field', { field_id: d.champs.qa_type_client.id, value: d.champs.qa_type_client.options[0].id });
    const p = await ouvrirEtape(page, regle.id, 'Mettre à jour un champ personnalisé');
    const valeur = champ(p, 'Nouvelle valeur', false);
    expect(await optionChoisie(valeur)).toBe('Résidentiel');
    await valeur.selectOption({ label: '— Effacer le champ —' });
    await expect(p.getByText('Vide = effacer le champ.')).toBeVisible();
    await boutonEnregistrer(p).click();
    await attendre0(async () => !configDe(await etapesEnBase(bureau, regle.id))?.value);
    expect(configDe(await etapesEnBase(bureau, regle.id))?.field_id).toBe(d.champs.qa_type_client.id);
    await attendreEnregistre(page);
  });

  test('[EDT-105][CHA-24][EDT-126] un champ d’une autre fiche est signalé et empêche d’enregistrer ; un champ disparu est signalé', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    // Champ du pipeline sur « Nouveau prospect » (qui fait arriver un client).
    const autreFiche = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'update_custom_field', { field_id: d.champs.qa_origine.id, value: 'x' }, { name: `${marque} autre fiche` });
    let p = await ouvrirEtape(page, autreFiche.id, 'Mettre à jour un champ personnalisé');
    await expect(p.getByText('« Origine QA » n’est pas un champ de la fiche que ce déclencheur fait arriver.')).toHaveCount(2);
    await expect(boutonEnregistrer(p)).toBeDisabled();

    // Champ qui n'existe plus.
    const disparu = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'update_custom_field', { field_id: '00000000-0000-4000-8000-000000000000', value: 'x' }, { name: `${marque} champ disparu` });
    p = await ouvrirEtape(page, disparu.id, 'Mettre à jour un champ personnalisé');
    await expect(p.getByText('Ce champ n’existe plus (archivé ou supprimé) : choisissez-en un autre.')).toBeVisible();
  });

  test('[EDT-105][CHA-24][EDT-126][EDT-022] une étape qui vise un champ disparu ne se réenregistre pas telle quelle, et le canevas la signale avant publication @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'lead.created', 'update_custom_field', { field_id: '00000000-0000-4000-8000-000000000000', value: 'x' });
    const p = await ouvrirEtape(page, regle.id, 'Mettre à jour un champ personnalisé');
    await expect(p.getByText('Ce champ n’existe plus (archivé ou supprimé) : choisissez-en un autre.')).toBeVisible();
    await expect.soft(boutonEnregistrer(p), '« Enregistrer » sur un champ qui n’existe plus').toBeDisabled();
    // Le titre du bandeau s'accorde au nombre depuis #859 : « 1 chose à corriger… », « 2 choses à corriger… ».
    await expect.soft(page.getByText(/^\d+ choses? à corriger avant de publier$/), 'le canevas annonce le problème').toBeVisible({ timeout: 5_000 });
  });
});

// ── types réservés aux réglages d'un déclencheur ──────────────────────────

test.describe('champs « étape de pipeline », « service », « champ date » (réglages du déclencheur)', () => {
  test('[EDT-081][EDT-083][EDT-084] « Devis ouvert par le client » : les menus portent les étapes du pipeline et les services du bureau ; le choix est enregistré par identifiant et relu par nom', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.viewed', 'create_task', { title: 'Rappeler [client_name]' }, { conditions: { ouverture: 'premiere' } });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Quand/ }).click();
    const p = page.getByRole('complementary', { name: 'Réglages du déclencheur' });
    await expect(p).toBeVisible();

    const etape = p.getByLabel('L’opportunité est à l’étape (facultatif)', { exact: true });
    await expect(etape.locator('option')).toHaveCount(d.etapes.length + 1);
    const etapesLues = await etape.locator('option').allInnerTexts();
    expect(etapesLues[0]).toBe('— Toutes les étapes —');
    expect(etapesLues.slice(1).sort()).toEqual(d.etapes.map((e) => `${d.pipeline.name} · ${e.name_fr}`).sort());

    const service = p.getByLabel('Contient le service (facultatif)', { exact: true });
    await expect.poll(async () => (await service.locator('option').count()) >= d.services.length + 1, { timeout: 120_000 }).toBe(true);
    const servicesLus = await service.locator('option').allInnerTexts();
    expect(servicesLus[0]).toBe('— N’importe quel service —');
    expect(servicesLus).toEqual(expect.arrayContaining(d.services.map((s) => s.name)));

    const etiquette = p.getByLabel('Le client a l’étiquette (facultatif)', { exact: true });
    const idListe = await etiquette.getAttribute('list');
    expect(await page.locator(`datalist[id="${idListe}"] option`).evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)))
      .toEqual(expect.arrayContaining(['Ne pas relancer QA', 'VIP QA']));

    await etape.selectOption({ label: `${d.pipeline.name} · ${d.etapes[2].name_fr}` });
    await service.selectOption({ label: d.services[0].name });
    await etiquette.fill('VIP QA');
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Réglages enregistrés')).toBeVisible();
    await expect(p).toBeHidden();
    const { data } = await bureau.admin.from('automation_rules').select('conditions').eq('id', regle.id).single();
    expect(data?.conditions).toMatchObject({ stage_id: d.etapes[2].id, service_id: d.services[0].id, etiquette: 'VIP QA' });
    // La carte « Quand » redit les choix par leur nom, jamais par leur identifiant.
    const quand = page.getByRole('button', { name: /^Quand/ });
    await expect(quand).toContainText(`${d.pipeline.name} · ${d.etapes[2].name_fr}`);
    await expect(quand).toContainText(d.services[0].name);
    await expect(quand).not.toContainText(d.etapes[2].id);

    await page.reload();
    await expect(page.getByRole('button', { name: /^Quand/ })).toBeVisible({ timeout: 180_000 });
    await page.getByRole('button', { name: /^Quand/ }).click();
    const relu = page.getByRole('complementary', { name: 'Réglages du déclencheur' });
    // Les listes se chargent après le panneau : on attend que le nom apparaisse.
    await expect.poll(() => optionChoisie(relu.getByLabel('L’opportunité est à l’étape (facultatif)', { exact: true })), { timeout: 120_000 }).toBe(`${d.pipeline.name} · ${d.etapes[2].name_fr}`);
    await expect.poll(() => optionChoisie(relu.getByLabel('Contient le service (facultatif)', { exact: true })), { timeout: 120_000 }).toBe(d.services[0].name);
    await expect(relu.getByLabel('Le client a l’étiquette (facultatif)', { exact: true })).toHaveValue('VIP QA');
  });

  test('[EDT-082][EDT-077] « Date atteinte » : le menu porte les champs date du client et du pipeline ; le choix est enregistré par identifiant et relu par nom', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillonAvecAction(bureau, marque, 'date.reached', 'create_task', { title: 'Rappeler [client_name]' });
    await ouvrirEditeur(page, regle.id);
    await page.getByRole('button', { name: /^Quand/ }).click();
    const p = page.getByRole('complementary', { name: 'Réglages du déclencheur' });
    const menu = p.getByLabel('Quelle date surveiller *', { exact: true });
    await expect(menu.locator('option')).toHaveCount(3, { timeout: 120_000 });
    const dates = await menu.locator('option').allInnerTexts();
    expect(dates[0]).toBe('— Choisir une date —');
    expect(dates.slice(1).sort()).toEqual(['Client · Fin de garantie QA', 'Pipeline · Fermeture prévue QA']);
    await menu.selectOption({ label: 'Client · Fin de garantie QA' });
    await p.getByLabel('Combien de jours avant (facultatif)', { exact: true }).fill('7');
    await p.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect(page.getByText('Réglages enregistrés')).toBeVisible();
    const { data } = await bureau.admin.from('automation_rules').select('conditions').eq('id', regle.id).single();
    expect(data?.conditions).toMatchObject({ champ_id: d.champs.qa_fin_garantie.id });
    expect(String((data?.conditions as Record<string, unknown>).jours_avant)).toBe('7');
    await expect(page.getByRole('button', { name: /^Quand/ })).toContainText('Client · Fin de garantie QA');
    await finStable(page);
  });
});

// ── ce que la carte dit d'une action sans texte ───────────────────────────

test.describe('carte d’une action sans texte', () => {
  test('[CHA-15][CHA-21][CHA-38][CHA-32][EDT-037] la carte dit ce que l’étape fera (quelle étiquette, quel membre, quelle adresse, quelle étape) @defaut', async ({ page, bureau, marque }) => {
    const d = await donnees(bureau);
    const regle = await creerBrouillon(bureau, marque, 'quote.sent', {
      steps: [
        { id: 'e1', type: 'action', action: { type: 'ajouter_etiquette', config: { etiquette: 'VIP QA' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'assigner_responsable', config: { membre_id: d.membres.tech.id } }, suivant: 'e3' },
        { id: 'e3', type: 'action', action: { type: 'webhook', config: { url: 'https://crochets.lume-qa.test/entrant' } }, suivant: 'e4' },
        { id: 'e4', type: 'action', action: { type: 'move_deal_stage', config: { cible: 'gagne' } }, suivant: null },
      ],
    });
    await ouvrirEditeur(page, regle.id);
    await expect(carte(page, 'Ajouter une étiquette')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/cartes-sans-detail.png` });
    await expect.soft(carte(page, 'Ajouter une étiquette')).toContainText('VIP QA');
    await expect.soft(carte(page, 'Assigner un responsable')).toContainText(d.membres.tech.nom);
    await expect.soft(carte(page, 'Appeler un webhook')).toContainText('crochets.lume-qa.test');
    await expect.soft(carte(page, 'Déplacer l’opportunité')).toContainText('Gagné');
  });
});
