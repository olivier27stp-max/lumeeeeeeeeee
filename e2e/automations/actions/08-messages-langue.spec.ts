/**
 * Les messages au client (texto, courriel) : la langue et la fidélité du texte.
 *
 * Ce que le fichier prouve :
 *  · le panneau n'a qu'UN texte par message (pas de champs FR et EN distincts),
 *    et ce texte est enregistré puis relu tel quel, sans réécriture ni balise ;
 *  · quand une étape porte AUSSI une version anglaise (`body_en`, `subject_en` —
 *    c'est le cas des automatisations fournies, que « Convertir » rend
 *    modifiables), le panneau la montre : sinon on corrige un texte pendant
 *    qu'un autre, invisible, continue de partir aux clients d'un bureau anglais ;
 *  · un courriel fourni, écrit en HTML, ne s'ouvre pas en balises brutes.
 */
import { test, expect } from './_aides';
import { creerRegle } from '../_outils/banc';
import {
  CAPTURES, creerBrouillonAvecAction, ouvrirEditeur, panneauEtape, champ, boutonEnregistrer,
  attendreConfig, attendreEtapes, attendreEnregistre, carte, etapesEnBase, configDe,
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

test.describe('messages — la version anglaise d’une étape', () => {
  test('[CHA-07][EDT-108] une étape qui porte un texte anglais (`body_en`) le montre dans le panneau @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', {
      body: 'Bonjour [client_name], votre devis est prêt.', body_en: 'Hi [client_name], your quote is ready.',
    });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    await expect(champ(p, 'Texte du message', true)).toHaveValue('Bonjour [client_name], votre devis est prêt.');
    await page.screenshot({ path: `${CAPTURES}/langue-body-en-invisible.png` });
    // Attendu : le texte anglais, qui part aux clients d'un bureau en anglais, est visible et modifiable.
    const valeurs = await p.locator('textarea, input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement | HTMLTextAreaElement).value));
    expect(valeurs, 'aucun champ du panneau ne porte le texte anglais de l’étape').toContain('Hi [client_name], your quote is ready.');
  });

  test('[CHA-07][EDT-130] corriger le texte d’une étape qui porte aussi une version anglaise ne laisse pas l’ancienne version anglaise partir @defaut', async ({ page, bureau, marque }) => {
    const regle = await creerBrouillonAvecAction(bureau, marque, 'quote.sent', 'send_sms', {
      body: 'Rabais de 10 % jusqu’au 1er mai.', body_en: '10% off until May 1st.',
    });
    await ouvrirEditeur(page, regle.id);
    await carte(page, 'Envoyer un texto').click();
    const p = panneauEtape(page);
    await champ(p, 'Texte du message', true).fill('Rabais de 20 % jusqu’au 1er juin.');
    await boutonEnregistrer(p).click();
    const etapes = await attendreEtapes(bureau, regle.id, (e) => configDe(e)?.body === 'Rabais de 20 % jusqu’au 1er juin.');
    await attendreEnregistre(page);
    const config = configDe(etapes) ?? {};
    // L'écran ne montre plus qu'un texte (20 %, 1er juin). La base ne doit pas garder, à l'insu de
    // l'utilisateur, un autre texte (10 %, 1er mai) que le moteur enverra aux clients d'un bureau anglais.
    expect(config.body_en ?? null, 'version anglaise restée en base, invisible à l’écran').not.toBe('10% off until May 1st.');
  });
});

test.describe('messages — une automatisation fournie, convertie en parcours', () => {
  /** La forme exacte des automatisations fournies : `actions`, corps en HTML, version anglaise à côté. */
  const HTML_FR = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Bonjour [client_first_name],</h2><p>Vous nous avez contactés récemment.</p><p>Merci,<br/>[company_name]</p></div>';
  const HTML_EN = '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><h2>Hi [client_first_name],</h2><p>You reached out to us recently.</p><p>Thank you,<br/>[company_name]</p></div>';

  test('[CHA-05][CHA-03][EDT-041][EDT-075] le courriel d’une automatisation fournie, une fois converti, s’ouvre en texte lisible — pas en balises HTML @defaut', async ({ page, bureau, marque }) => {
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
