/**
 * Les messages au client (texto, courriel) : la langue et la fidélité du texte.
 *
 * Ce que le fichier prouve :
 *  · une étape écrite dans l'éditeur n'a qu'UN texte par message (pas de champs
 *    FR et EN distincts), enregistré puis relu tel quel, sans réécriture ni balise ;
 *  · quand une étape porte AUSSI une version anglaise (`body_en`, `subject_en` —
 *    c'est le cas des automatisations fournies, que « Convertir » rend
 *    modifiables), le panneau la montre : sinon on corrige un texte pendant
 *    qu'un autre, invisible, continue de partir aux clients d'un bureau anglais.
 *    Le champ principal est le texte que le bureau ENVOIE ; l'autre langue est
 *    dans un bloc replié ; corriger le principal ne retient jamais « Enregistrer »
 *    et dit, avant qu'on enregistre, ce que l'autre version devient ;
 *  · un courriel fourni, écrit en HTML, ne s'ouvre pas en balises brutes.
 */
import { test, expect } from './_aides';
import { creerRegle } from '../_outils/banc';
import {
  CAPTURES, creerBrouillonAvecAction, ouvrirEditeur, panneauEtape, champ, boutonEnregistrer,
  attendreConfig, attendreEtapes, attendreEnregistre, carte, etapesEnBase, configDe, enregistrerEtape,
} from './_aides';

test.describe('messages — un seul texte, gardé tel quel', () => {
  test('[CHA-05][CHA-03][EDT-075] courriel : le texte saisi (lignes vides, guillemets, « & », « < ») est enregistré sans balise ajoutée et relu à l’identique', async ({ page, bureau, marque }) => {
    const corps = 'Bonjour [client_name],\n\nVotre devis « été » est prêt : 2 options & 1 rabais si total < 500 $.\n\n— L’équipe';
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_email', { subject: 'Objet', body: 'Corps' });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un courriel').click();
    const p = panneauEtape(page);
    // Un seul champ « Message », un seul « Objet » : pas de variante par langue à l'écran.
    await expect(p.getByRole('textbox', { name: /Message/ })).toHaveCount(1);
    await expect(p.getByRole('textbox', { name: /Objet/ })).toHaveCount(1);
    await champ(p, 'Message', true).fill(corps);
    await boutonEnregistrer(p).click();
    const etapes = await attendreConfig(bureau, regle.id, { subject: 'Objet', body: corps });
    expect(Object.keys(configDe(etapes) ?? {}).sort()).toEqual(['body', 'subject']);
    await attendreEnregistre(page);
    await page.reload();
    await expect(carte(page, 'Envoyer un courriel')).toBeVisible({ timeout: 180_000 });
    await carte(page, 'Envoyer un courriel').click();
    await expect(champ(panneauEtape(page), 'Message', true)).toHaveValue(corps);
  });

  test('[CHA-07][EDT-108] texto : rouvrir l’étape et la réenregistrer sans rien changer ne réécrit rien', async ({ page, bureau, marque }) => {
    const texte = 'Bonjour [client_name], c’est [company_name].\nRépondez OUI pour confirmer 👍';
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: texte });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    await expect(champ(p, 'Texte du message', true)).toHaveValue(texte);
    await boutonEnregistrer(p).click();
    await expect(p).toBeHidden();
    await attendreEnregistre(page);
    expect(await etapesEnBase(bureau, regle.id)).toEqual([{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: texte } }, suivant: null }]);
  });
});

/*
 * Comportement décidé (539be241 ajusté par a80b2c25) :
 *  · le champ principal montre le texte que le bureau ENVOIE (`body` en bureau français, `body_en` en bureau anglais) ;
 *  · l'autre langue est dans un bloc replié, annoncé par son titre ;
 *  · corriger le texte principal ne retient jamais « Enregistrer » : le bloc se déplie, dit « Cette version n'est
 *    plus à jour. », et offre « La retirer » (coché d'office) ou « La garder telle quelle ».
 */
const FR_AVANT = 'Rabais de 10 % jusqu’au 1er mai.';
const EN_AVANT = '10% off until May 1st.';
const FR_APRES = 'Rabais de 20 % jusqu’au 1er juin.';
const BLOC_ANGLAIS = 'Version anglaise (Texte du message) — utilisée seulement si vos messages partent en anglais';
const BLOC_FRANCAIS = 'Version française (Texte du message) — utilisée seulement si vos messages partent en français';
const RETIRER = 'La retirer (vos clients recevront le texte ci-dessus)';
const GARDER = 'La garder telle quelle';

test.describe('messages — la version anglaise d’une étape', () => {
  test('[CHA-07][EDT-108] une étape qui porte un texte anglais (`body_en`) le montre dans le panneau : annoncé par un bloc replié, lisible et modifiable une fois déplié', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', {
      body: 'Bonjour [client_name], votre devis est prêt.', body_en: 'Hi [client_name], your quote is ready.',
    });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    await expect(champ(p, 'Texte du message', true)).toHaveValue('Bonjour [client_name], votre devis est prêt.');
    // Replié : le panneau DIT qu'une version anglaise existe, sans l'étaler.
    const bloc = p.getByRole('button', { name: BLOC_ANGLAIS, exact: true });
    await expect(bloc).toHaveAttribute('aria-expanded', 'false');
    await expect(p.getByText('Cette version n’est plus à jour.')).toHaveCount(0);
    await page.screenshot({ path: `${CAPTURES}/langue-body-en-bloc-replie.png` });
    // Un clic : le texte anglais, qui part aux clients d'un bureau en anglais, est visible et modifiable.
    await bloc.click();
    await expect(bloc).toHaveAttribute('aria-expanded', 'true');
    const valeurs = await p.locator('textarea, input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement | HTMLTextAreaElement).value));
    expect(valeurs, 'aucun champ du panneau ne porte le texte anglais de l’étape').toContain('Hi [client_name], your quote is ready.');
    const anglais = champ(p, 'Texte du message — version anglaise', false);
    await expect(anglais).toHaveValue('Hi [client_name], your quote is ready.');
    await expect(p.getByText('Part à la place du texte ci-dessus si vos messages partent en anglais. Vide = le texte ci-dessus part à tout le monde.')).toBeVisible();
    await anglais.fill('Hi [client_name], your quote is ready — reply YES.');
    // L'anglais seul a changé : rien n'est « plus à jour », aucun choix n'est demandé.
    await expect(p.getByText('Cette version n’est plus à jour.')).toHaveCount(0);
    await enregistrerEtape(p);
    const etapes = await attendreConfig(bureau, regle.id, { body: 'Bonjour [client_name], votre devis est prêt.', body_en: 'Hi [client_name], your quote is ready — reply YES.' });
    expect(Object.keys(configDe(etapes) ?? {}).sort()).toEqual(['body', 'body_en']);
    await attendreEnregistre(page);
  });

  test('[CHA-07][EDT-108] rouvrir et réenregistrer sans rien changer une étape qui porte une version anglaise ne retire rien', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: FR_AVANT, body_en: EN_AVANT });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    await expect(p.getByRole('button', { name: BLOC_ANGLAIS, exact: true })).toHaveAttribute('aria-expanded', 'false');
    await enregistrerEtape(p);
    await attendreEnregistre(page);
    expect(await etapesEnBase(bureau, regle.id)).toEqual([{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: FR_AVANT, body_en: EN_AVANT } }, suivant: null }]);
  });

  test('[CHA-07][EDT-130] corriger le texte d’une étape qui porte aussi une version anglaise ne laisse pas l’ancienne version anglaise partir : le bloc se déplie, annonce qu’elle sera retirée, et UN clic sur « Enregistrer » suffit', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: FR_AVANT, body_en: EN_AVANT });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    const bloc = p.getByRole('button', { name: BLOC_ANGLAIS, exact: true });
    await expect(bloc).toHaveAttribute('aria-expanded', 'false');
    await champ(p, 'Texte du message', true).fill(FR_APRES);

    // Rien n'est retiré sans que ce soit écrit : le bloc s'est déplié de lui-même, montre le texte anglais
    // concerné, dit qu'il n'est plus à jour, et le choix par défaut est lisible AVANT d'enregistrer.
    await expect(bloc).toHaveAttribute('aria-expanded', 'true');
    await expect(champ(p, 'Texte du message — version anglaise', false)).toHaveValue(EN_AVANT);
    await expect(p.getByText('Cette version n’est plus à jour.', { exact: true })).toBeVisible();
    await expect(p.getByLabel(RETIRER, { exact: true })).toBeChecked();
    await expect(p.getByLabel(GARDER, { exact: true })).not.toBeChecked();
    // « Enregistrer » n'est pas retenu, et aucun refus n'est écrit dans le panneau.
    await expect(boutonEnregistrer(p)).toBeEnabled();
    await expect(p.getByText(/version anglaise : mettez-la à jour/)).toHaveCount(0);
    await page.screenshot({ path: `${CAPTURES}/langue-version-anglaise-plus-a-jour.png` });

    // Un seul clic.
    await boutonEnregistrer(p).click();
    await expect(p).toBeHidden();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const etapes = await attendreEtapes(bureau, regle.id, (e) => configDe(e)?.body === FR_APRES);
    await attendreEnregistre(page);
    const config = configDe(etapes) ?? {};
    // L'écran ne montre plus qu'un texte (20 %, 1er juin). La base ne doit pas garder, à l'insu de
    // l'utilisateur, un autre texte (10 %, 1er mai) que le moteur enverra aux clients d'un bureau anglais.
    expect(config.body_en ?? null, 'version anglaise restée en base, invisible à l’écran').not.toBe(EN_AVANT);
    // Retirée, pas vidée : la clé a disparu (le moteur retombe sur `body`).
    expect(config).toEqual({ body: FR_APRES });

    // Rouvrir : un seul texte, plus de bloc.
    await carte(page, 'Envoyer un texto').click();
    const relu = panneauEtape(page);
    await expect(champ(relu, 'Texte du message', true)).toHaveValue(FR_APRES);
    await expect(relu.getByRole('button', { name: BLOC_ANGLAIS, exact: true })).toHaveCount(0);
  });

  test('[CHA-07][EDT-130] « La garder telle quelle » : le texte français corrigé est enregistré, la version anglaise reste intacte en base', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: FR_AVANT, body_en: EN_AVANT });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    await champ(p, 'Texte du message', true).fill(FR_APRES);
    await expect(p.getByLabel(RETIRER, { exact: true })).toBeChecked();
    await p.getByLabel(GARDER, { exact: true }).check();
    await expect(p.getByLabel(RETIRER, { exact: true })).not.toBeChecked();
    await expect(boutonEnregistrer(p)).toBeEnabled();
    await enregistrerEtape(p);
    await attendreConfig(bureau, regle.id, { body: FR_APRES, body_en: EN_AVANT });
    await attendreEnregistre(page);
    // Rouvrir : la version gardée est toujours annoncée, repliée.
    await carte(page, 'Envoyer un texto').click();
    await expect(panneauEtape(page).getByRole('button', { name: BLOC_ANGLAIS, exact: true })).toHaveAttribute('aria-expanded', 'false');
  });
});

/*
 * Un bureau qui ENVOIE EN ANGLAIS (Réglages des automatisations › « Messages en EN »). L'état est provoqué : la
 * lecture de la langue du bureau par l'éditeur (`company_settings.default_language`) est rendue « en » pour cet
 * onglet seulement — le bureau de test, partagé par tout le lot, reste en français en base.
 */
test.describe('messages — bureau qui envoie en anglais', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(/\/rest\/v1\/company_settings\?select=default_language(&|$)/, async (route) => {
      try {
        const r = await route.fetch();
        const j = await r.json().catch(() => null);
        const enAnglais = (x: unknown) => (x && typeof x === 'object' ? { ...(x as Record<string, unknown>), default_language: 'en' } : x);
        await route.fulfill({ response: r, json: Array.isArray(j) ? j.map(enAnglais) : enAnglais(j) });
      } catch {
        // L'onglet s'est fermé pendant le relais (fin de test) : rien à rendre.
        await route.continue().catch(() => undefined);
      }
    });
  });

  test('[CHA-07][EDT-130] le champ principal montre le texte anglais (celui qui part) ; le corriger retire la version française : il ne reste qu’un texte, sous `body`', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: FR_AVANT, body_en: EN_AVANT });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    const principal = champ(p, 'Texte du message', true);
    await expect(principal).toHaveValue(EN_AVANT);
    const bloc = p.getByRole('button', { name: BLOC_FRANCAIS, exact: true });
    await expect(bloc).toHaveAttribute('aria-expanded', 'false');
    await expect(p.getByRole('button', { name: BLOC_ANGLAIS, exact: true })).toHaveCount(0);

    await principal.fill('20% off until June 1st.');
    await expect(bloc).toHaveAttribute('aria-expanded', 'true');
    await expect(champ(p, 'Texte du message — version française', false)).toHaveValue(FR_AVANT);
    await expect(p.getByText('Cette version n’est plus à jour.', { exact: true })).toBeVisible();
    await expect(p.getByLabel(RETIRER, { exact: true })).toBeChecked();
    await expect(boutonEnregistrer(p)).toBeEnabled();
    await page.screenshot({ path: `${CAPTURES}/langue-bureau-anglais-version-francaise.png` });
    await boutonEnregistrer(p).click();
    await expect(p).toBeHidden();
    // Un seul texte reste : celui qui part, sous `body` ; `body_en` a disparu.
    await attendreConfig(bureau, regle.id, { body: '20% off until June 1st.' });
    await attendreEnregistre(page);
  });

  test('[CHA-07][EDT-130] « La garder telle quelle » : le texte anglais corrigé reste sous `body_en`, la version française reste sous `body`', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: FR_AVANT, body_en: EN_AVANT });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    const principal = champ(p, 'Texte du message', true);
    await expect(principal).toHaveValue(EN_AVANT);
    await principal.fill('20% off until June 1st.');
    await p.getByLabel(GARDER, { exact: true }).check();
    await enregistrerEtape(p);
    await attendreConfig(bureau, regle.id, { body: FR_AVANT, body_en: '20% off until June 1st.' });
    await attendreEnregistre(page);
  });

  // Défaut connu, encore ouvert (signalé par la session de correction) : la carte résume `body`, le français,
  // même quand le bureau envoie `body_en`.
  test('[CHA-07][EDT-037] la carte du canevas résume le texte qui part (l’anglais), pas la version française @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', { body: FR_AVANT, body_en: EN_AVANT });
    await ouvrirEditeur(page, regle.id);
    // Le panneau, lui, a bien lu la langue du bureau : on s'en assure avant de juger la carte.
    await carte(page, 'Envoyer un texto').click();
    await expect(champ(panneauEtape(page), 'Texte du message', true)).toHaveValue(EN_AVANT);
    await page.screenshot({ path: `${CAPTURES}/langue-bureau-anglais-carte.png` });
    await expect(carte(page, 'Envoyer un texto')).toContainText(EN_AVANT, { timeout: 5_000 });
  });
});

test.describe('messages — une automatisation fournie, convertie en parcours', () => {
  /** La forme exacte des automatisations fournies : `actions`, corps en HTML, version anglaise à côté. */
  const HTML_FR = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Vous nous avez contactés récemment.</p><p>Merci,<br/>[company_name]</p></div>';
  const HTML_EN = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hi [client_first_name],</h2><p>You reached out to us recently.</p><p>Thank you,<br/>[company_name]</p></div>';

  test('[CHA-05][CHA-03][EDT-041][EDT-075] le courriel d’une automatisation fournie, une fois converti, s’ouvre en texte lisible — pas en balises HTML', async ({ page, bureau, marque }) => {
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} fournie convertie`, trigger_event: 'lead.created', steps: null,
      actions: [{ type: 'send_email', config: { subject: 'Votre demande n’est pas oubliée', subject_en: 'We haven’t forgotten your request', body: HTML_FR, body_en: HTML_EN } }],
    });
    await ouvrirEditeur(page, regle.id);
    await expect(page.getByText('Parcours au format d’origine')).toBeVisible();
    // Cliquer l'étape la convertit (brouillon : sans question) puis l'ouvre.
    await carte(page, 'Envoyer un courriel').click();
    const p = panneauEtape(page);
    await expect(p).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('Parcours converti — il est modifiable')).toBeVisible({ timeout: 120_000 });
    // La conversion n'a rien perdu en base.
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e.length === 1);
    expect(configDe(etapes)).toEqual({ subject: 'Votre demande n’est pas oubliée', subject_en: 'We haven’t forgotten your request', body: HTML_FR, body_en: HTML_EN });
    await expect(champ(p, 'Objet', true)).toHaveValue('Votre demande n’est pas oubliée');
    await page.screenshot({ path: `${CAPTURES}/langue-courriel-html-brut.png` });
    // Attendu : le message se lit et se corrige comme un texte ; aucune balise ni style à l'écran.
    const affiche = await champ(p, 'Message', true).inputValue();
    expect(affiche, 'le champ « Message » montre du HTML brut').not.toMatch(/<div|<p>|<h2>|style=/);
  });

  test('[CHA-07][EDT-041] un texto fourni se convertit et s’ouvre tel quel', async ({ page, bureau, marque }) => {
    const regle = await creerRegle(bureau, bureau.orgA, {
      name: `${marque} texto fourni converti`, trigger_event: 'quote.sent', steps: null,
      actions: [{ type: 'send_sms', config: { body: 'Bonjour [client_first_name], votre devis vous attend : [quote_link]' } }],
    });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    await expect(p).toBeVisible({ timeout: 120_000 });
    await expect(champ(p, 'Texte du message', true)).toHaveValue('Bonjour [client_first_name], votre devis vous attend : [quote_link]');
    const etapes = await attendreEtapes(bureau, regle.id, (e) => e.length === 1);
    expect(configDe(etapes)).toEqual({ body: 'Bonjour [client_first_name], votre devis vous attend : [quote_link]' });
    await attendreEnregistre(page);
  });
});
