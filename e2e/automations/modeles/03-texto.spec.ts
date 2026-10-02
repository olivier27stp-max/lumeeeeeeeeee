/**
 * Éditeur de TEXTO dans la ligne dépliée de la liste — MSG-001 à MSG-011.
 *
 * Il n'apparaît que pour une automatisation à l'ANCIEN format (`actions`, sans
 * `steps`) : les préréglages que chaque bureau reçoit d'office.
 *
 * Ce que ce fichier prouve : le texte affiché est celui de la base ; ce qui est
 * saisi (accents, émojis, « < & " », retours à la ligne) est enregistré mot pour
 * mot et se relit identique après rechargement ; un texto vide est refusé avec
 * une phrase claire ; chaque bouton « Insérer » ajoute la bonne variable et
 * l'aperçu montre un exemple ; une variable inconnue est signalée ; le nombre
 * de SMS est annoncé ; « Annuler » revient au texte d'origine ; une panne
 * d'enregistrement est dite et ne perd pas la saisie.
 */
import type { Locator, Page } from '@playwright/test';
import {
  test, expect, ouvrirListe, creerRegle, lireRegle, deplierMessages, remettreReglagesBureau, CAPTURES,
  type Bureau, type LigneRegle,
} from './aides';

// Poste et staging partagés par plusieurs passes : les chargements sont lents par moments.
test.describe.configure({ timeout: 240_000 });

const TEXTE = 'Bonjour [client_first_name], votre rendez-vous est confirme.';

async function regleTexto(bureau: Bureau, marque: string, actions?: LigneRegle['actions'], plus: Partial<LigneRegle> = {}): Promise<LigneRegle> {
  return creerRegle(bureau, bureau.orgA, {
    name: `${marque} texto`,
    actions: actions ?? [{ type: 'send_sms', config: { body: TEXTE } }],
    ...plus,
  });
}

// Depuis #870 le bloc dit « Texto » (« Text » en anglais), comme le reste de la page — plus « SMS ».
const zone = (page: Page): Locator => page.getByRole('textbox', { name: /^(Texto envoyé au client|Text sent to client)$/ });
const enregistrer = (page: Page): Locator => page.getByRole('button', { name: /^(Enregistrer|Save)$/ });
/** Le texte de « Le client lira : … » (variables remplacées par un exemple). */
const lu = (page: Page): Locator => page.getByText(/^(Le client lira :|The client will read:)$/).first().locator('xpath=following-sibling::span[1]');
const corpsSms = async (bureau: Bureau, id: string): Promise<string[]> =>
  ((await lireRegle(bureau, id))?.actions ?? []).filter((a) => a.type === 'send_sms').map((a) => String(a.config.body));

async function ouvrirTexto(page: Page, marque: string): Promise<void> {
  await ouvrirListe(page);
  await deplierMessages(page, marque);
  await expect(zone(page).first()).toBeVisible();
}

test.describe('texto — affichage et enregistrement', () => {
  test('[MSG-001] le bloc montre le texte de la base, le compte de caractères et ce que le client lira ; « Enregistrer » est grisé tant que rien ne change', async ({ page, bureau, marque }) => {
    await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    await expect(page.getByText('Texto envoyé au client', { exact: true })).toBeVisible();
    await expect(zone(page)).toHaveValue(TEXTE);
    await expect(page.getByText(`${TEXTE.length} caractères`)).toBeVisible();
    await expect(page.getByText('Le client lira :')).toBeVisible();
    await expect(lu(page)).toHaveText('Bonjour Marie, votre rendez-vous est confirme.');
    await expect(enregistrer(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toHaveCount(0);
    await expect(page.getByText('Le message ne peut pas être vide.')).toHaveCount(0);
  });

  test('[MSG-010] une modification s’enregistre : message de succès, base à jour, texte relu identique après rechargement', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    const nouveau = 'Bonjour [client_first_name], à demain 9 h chez [company_name].';
    await zone(page).fill(nouveau);
    await expect(enregistrer(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Annuler', exact: true })).toBeVisible();
    await enregistrer(page).click();
    await expect(page.getByText('Message enregistré')).toBeVisible();
    await expect.poll(() => corpsSms(bureau, r.id)).toEqual([nouveau]);
    // Le panneau reste déplié après le rechargement de la liste, avec le nouveau texte.
    await expect(zone(page)).toHaveValue(nouveau);
    await expect(enregistrer(page)).toBeDisabled();
    await page.reload();
    await ouvrirTexto(page, marque);
    await expect(zone(page)).toHaveValue(nouveau);
    await expect(lu(page)).toHaveText('Bonjour Marie, à demain 9 h chez Votre entreprise.');
    // Le reste de la règle n'a pas bougé.
    const apres = await lireRegle(bureau, r.id);
    expect(apres).toMatchObject({ name: r.name, is_active: false, trigger_event: r.trigger_event });
  });

  test('[MSG-001][MSG-010] accents, émojis, « < & " \' », retours à la ligne : enregistrés mot pour mot, relus identiques', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    const saisi = 'Été : ça va? « Très bien » 😀👍\nLigne 2 <b>gras</b> & "guillemets" \'apostrophe\' 100 % — fin\n\nLigne 4 après un blanc';
    await zone(page).fill(saisi);
    await enregistrer(page).click();
    await expect(page.getByText('Message enregistré')).toBeVisible();
    await expect.poll(() => corpsSms(bureau, r.id)).toEqual([saisi]);
    await page.reload();
    await ouvrirTexto(page, marque);
    await expect(zone(page)).toHaveValue(saisi);
    // Rien n'est interprété comme du HTML : le texte « <b>gras</b> » reste du texte.
    await expect(lu(page)).toContainText('<b>gras</b> & "guillemets"');
  });

  test('[MSG-001][MSG-010] un texto vide (ou fait d’espaces) est refusé avec une phrase claire, et rien n’est écrit', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    // Vide pour de bon : l'aperçu montre un tiret, pas un blanc.
    await zone(page).fill('');
    await expect(lu(page)).toHaveText('—');
    for (const vide of ['', '   ', '\n\n']) {
      await zone(page).fill(vide);
      await expect(page.getByText('Le message ne peut pas être vide.')).toBeVisible();
      await expect(enregistrer(page)).toBeDisabled();
      expect(await corpsSms(bureau, r.id)).toEqual([TEXTE]);
    }
  });

  test('[MSG-001] un texto fait seulement d’espaces ou de retours à la ligne : « Le client lira » montre « — », comme pour un texto vide @defaut', async ({ page, bureau, marque }) => {
    // L'écran dit « Le message ne peut pas être vide. » (il tient donc ces textes pour vides),
    // mais « Le client lira : » reste suivi d'un blanc au lieu du tiret montré pour un champ vide.
    await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    for (const vide of ['   ', '\n\n']) {
      await zone(page).fill(vide);
      await expect(page.getByText('Le message ne peut pas être vide.')).toBeVisible();
      await expect.soft(lu(page), `texte saisi : ${JSON.stringify(vide)}`).toHaveText('—', { timeout: 3_000 });
    }
  });

  test('[MSG-011] « Annuler » revient au texte d’origine, grise « Enregistrer » et n’écrit rien', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    await zone(page).fill('Un tout autre texte');
    const annuler = page.getByRole('button', { name: 'Annuler', exact: true });
    await annuler.click();
    await expect(zone(page)).toHaveValue(TEXTE);
    await expect(enregistrer(page)).toBeDisabled();
    await expect(annuler).toHaveCount(0);
    expect(await corpsSms(bureau, r.id)).toEqual([TEXTE]);
  });

  test('[MSG-010] panne à l’enregistrement : l’erreur est dite, la saisie reste dans le champ, la base n’a pas bougé', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(/500 PATCH .*automation_rules/, 'panne simulée par page.route');
    const r = await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    await page.route('**/rest/v1/automation_rules**', (route) => (route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'canceling statement due to statement timeout', code: '57014' }) })
      : route.fallback()));
    await zone(page).fill('Texte que la panne ne doit pas perdre');
    await enregistrer(page).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-010-panne.png` });
    await expect(page.getByText('Message enregistré')).toHaveCount(0);
    await expect(zone(page)).toHaveValue('Texte que la panne ne doit pas perdre');
    await expect(enregistrer(page)).toBeEnabled();
    expect(await corpsSms(bureau, r.id)).toEqual([TEXTE]);
  });

  test('[MSG-010] le message d’une panne est compréhensible (pas une erreur SQL en anglais) @defaut', async ({ page, bureau, marque, moniteur }) => {
    moniteur.attendu(/500 PATCH .*automation_rules/, 'panne simulée par page.route');
    await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    await page.route('**/rest/v1/automation_rules**', (route) => (route.request().method() === 'PATCH'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'canceling statement due to statement timeout', code: '57014' }) })
      : route.fallback()));
    await zone(page).fill('Autre texte');
    await enregistrer(page).click();
    const toast = page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible();
    await expect(toast).not.toContainText('canceling statement');
    await expect(toast).toContainText(/Enregistrement impossible|n’a pas été enregistré|Réessayez/);
  });
});

test.describe('texto — plusieurs messages dans la même automatisation', () => {
  test('[MSG-010] modifier un texto ne touche pas à l’autre texto de la même automatisation @defaut', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque, [
      { type: 'send_sms', config: { body: 'Premier texto : confirmation.' } },
      { type: 'send_sms', config: { body: 'Second texto : rappel la veille.' } },
    ]);
    await ouvrirTexto(page, marque);
    await expect(zone(page)).toHaveCount(2);
    await expect(zone(page).nth(0)).toHaveValue('Premier texto : confirmation.');
    await expect(zone(page).nth(1)).toHaveValue('Second texto : rappel la veille.');
    await zone(page).nth(0).fill('Premier texto, corrigé.');
    await enregistrer(page).nth(0).click();
    await expect(page.getByText('Message enregistré')).toBeVisible();
    await expect.poll(async () => (await corpsSms(bureau, r.id))[0]).toBe('Premier texto, corrigé.');
    await page.screenshot({ path: `${CAPTURES}/msg-010-deux-textos-ecrases.png`, fullPage: true });
    // Le second texto n'a pas été touché par l'utilisateur : il ne doit pas changer.
    expect(await corpsSms(bureau, r.id)).toEqual(['Premier texto, corrigé.', 'Second texto : rappel la veille.']);
  });

  test('[MSG-010] modifier le texto ne touche ni au courriel ni aux autres actions de la même automatisation', async ({ page, bureau, marque }) => {
    const courriel = { type: 'send_email', config: { subject: 'Objet', body: '<div><h2>Titre</h2><p>Corps</p></div>' } };
    const tache = { type: 'create_task', config: { title: 'Rappeler le client' } };
    const r = await regleTexto(bureau, marque, [{ type: 'send_sms', config: { body: TEXTE, body_en: 'Hello' } }, courriel, tache]);
    await ouvrirTexto(page, marque);
    await zone(page).fill('Nouveau texto.');
    await enregistrer(page).first().click();
    await expect(page.getByText('Message enregistré')).toBeVisible();
    await expect.poll(async () => (await lireRegle(bureau, r.id))?.actions).toEqual([
      { type: 'send_sms', config: { body: 'Nouveau texto.', body_en: 'Hello' } }, courriel, tache,
    ]);
  });
});

test.describe('texto — boutons « Insérer » et variables', () => {
  const VARIABLES: Array<[string, string, string, string]> = [
    ['MSG-002', 'Prénom du client', 'client_first_name', 'Marie'],
    ['MSG-003', 'Nom complet', 'client_name', 'Marie Tremblay'],
    ['MSG-004', 'Votre entreprise', 'company_name', 'Votre entreprise'],
    ['MSG-005', 'N° de facture', 'invoice_number', 'FAC-1042'],
    ['MSG-006', 'Montant', 'invoice_total', '450,00 $'],
    ['MSG-007', 'N° de soumission', 'quote_number', 'SOU-218'],
    ['MSG-008', 'Date du RDV', 'appointment_date', '14 août 2026'],
    ['MSG-009', 'Heure du RDV', 'appointment_time', '9 h 00'],
  ];

  test(`${VARIABLES.map(([id]) => `[${id}]`).join('')} chaque bouton ajoute SA variable, l’aperçu en montre un exemple, et le tout s’enregistre`, async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque, [{ type: 'send_sms', config: { body: 'Texte.' } }]);
    await ouvrirTexto(page, marque);
    await expect(page.getByText('Insérer :')).toBeVisible();
    let attendu = 'Texte.';
    let exemple = 'Texte.';
    for (const [, libelle, cle, valeur] of VARIABLES) {
      const bouton = page.getByRole('button', { name: libelle, exact: true });
      await expect(bouton).toHaveAttribute('title', `[${cle}]`);
      await bouton.click();
      attendu += `[${cle}]`;
      exemple += valeur;
      await expect(zone(page)).toHaveValue(attendu);
      await expect(lu(page)).toHaveText(exemple);
    }
    await expect(page.getByText(/Variable inconnue/)).toHaveCount(0);
    await enregistrer(page).click();
    await expect(page.getByText('Message enregistré')).toBeVisible();
    await expect.poll(() => corpsSms(bureau, r.id)).toEqual([attendu]);
  });

  test('[MSG-002] « Insérer » place la variable là où est le curseur, pas en fin de texte @defaut', async ({ page, bureau, marque }) => {
    await regleTexto(bureau, marque, [{ type: 'send_sms', config: { body: 'Bonjour , à demain.' } }]);
    await ouvrirTexto(page, marque);
    await zone(page).click();
    await zone(page).evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(8, 8); });
    await page.getByRole('button', { name: 'Prénom du client', exact: true }).click();
    await page.screenshot({ path: `${CAPTURES}/msg-002-inserer-en-fin.png` });
    await expect(zone(page)).toHaveValue('Bonjour [client_first_name], à demain.');
  });

  test('[MSG-001] une variable inconnue écrite à la main est nommée et signalée ; une variable connue hors boutons ne l’est pas', async ({ page, bureau, marque }) => {
    await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    await zone(page).fill('Bonjour [prenom], facture {numero_facture}.');
    await expect(page.getByText('Variable inconnue : [prenom], [numero_facture] — sera vide dans le message envoyé.')).toBeVisible();
    await zone(page).fill('Lien : [quote_link], tél. [client_phone], job [job_name].');
    await expect(page.getByText(/Variable inconnue/)).toHaveCount(0);
    // Un crochet de texte courant n'est pas une variable.
    await zone(page).fill('Rabais [50 %] ce mois-ci.');
    await expect(page.getByText(/Variable inconnue/)).toHaveCount(0);
  });

  test('[MSG-001] avec une variable inconnue, « Le client lira » montre ce qu’il lira vraiment (un blanc), pas le crochet @defaut', async ({ page, bureau, marque }) => {
    await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    await zone(page).fill('Bonjour [prenom], à demain.');
    await expect(page.getByText(/Variable inconnue : \[prenom\]/)).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-001-variable-inconnue-apercu.png` });
    // Le serveur remplace une variable inconnue par du vide : c'est « Bonjour , à demain. » qui part.
    await expect(lu(page)).toHaveText('Bonjour , à demain.');
  });
});

test.describe('texto — longueur et nombre de SMS', () => {
  test('[MSG-001] 160 caractères simples = 1 SMS (rien d’annoncé) ; 161 = « 2 SMS » ; un seul « ê » fait passer à 70 par SMS', async ({ page, bureau, marque }) => {
    await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    const compteur = page.locator('p', { hasText: /^\d+ caractères/ });
    await zone(page).fill('a'.repeat(160));
    await expect(compteur).toHaveText('160 caractères');
    await zone(page).fill('a'.repeat(161));
    await expect(compteur).toHaveText('161 caractères · 2 SMS');
    // 161 à 306 caractères simples : 2 SMS (153 par SMS dès qu'il y en a plusieurs) ; 307 : 3.
    await zone(page).fill('a'.repeat(306));
    await expect(compteur).toHaveText('306 caractères · 2 SMS');
    await zone(page).fill('a'.repeat(307));
    await expect(compteur).toHaveText('307 caractères · 3 SMS');
    // « é » et « à » sont dans l'alphabet des SMS ; « ê » n'y est pas.
    await zone(page).fill(`Réservé à ${'a'.repeat(60)}`);
    await expect(compteur).toHaveText('70 caractères');
    // Depuis #840 (src/lib/smsSegments.ts, `libelleSegments`) rien n'est annoncé tant qu'UN seul SMS part,
    // même avec un caractère spécial ; dès le deuxième, le libellé dit pourquoi le compte grimpe plus vite.
    await zone(page).fill(`Prêt ${'a'.repeat(65)}`);
    await expect(compteur).toHaveText('70 caractères');
    await zone(page).fill(`Prêt ${'a'.repeat(66)}`);
    await expect(compteur).toHaveText('71 caractères · 2 SMS (accent spécial ou émoji : 67 caractères par SMS)');
    // 67 par SMS au-delà du premier : 134 caractères = 2 SMS, 135 = 3.
    await zone(page).fill(`Prêt ${'a'.repeat(129)}`);
    await expect(compteur).toHaveText('134 caractères · 2 SMS (accent spécial ou émoji : 67 caractères par SMS)');
    await zone(page).fill(`Prêt ${'a'.repeat(130)}`);
    await expect(compteur).toHaveText('135 caractères · 3 SMS (accent spécial ou émoji : 67 caractères par SMS)');
    // Un émoji compte double et fait aussi passer à 70 par SMS : 8 unités, un seul SMS, rien d'annoncé…
    await zone(page).fill('Merci 😀');
    await expect(compteur).toHaveText('8 caractères');
    // … et 71 unités avec l'émoji (69 lettres + 2) : 2 SMS.
    await zone(page).fill(`${'a'.repeat(69)}😀`);
    await expect(compteur).toHaveText('71 caractères · 2 SMS (accent spécial ou émoji : 67 caractères par SMS)');
  });

  test('[MSG-001] le nombre de SMS annoncé est celui du texte que le client lira, pas celui du nom des variables @defaut', async ({ page, bureau, marque }) => {
    await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    // Le client lit 150 lettres + « Marie » = 155 caractères : 1 SMS.
    await zone(page).fill(`${'a'.repeat(150)}[client_first_name]`);
    await expect(lu(page)).toHaveText(`${'a'.repeat(150)}Marie`);
    await page.screenshot({ path: `${CAPTURES}/msg-001-compte-sms-variables.png` });
    await expect(page.locator('p', { hasText: /^\d+ caractères/ })).not.toContainText('2 SMS');
  });

  test('[MSG-001][MSG-010] au-delà de 1 600 caractères (plafond d’un texto), l’écran le dit au lieu d’enregistrer un message qui ne pourra pas partir @defaut', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    const long = 'a'.repeat(1700);
    await zone(page).fill(long);
    // Rien n'est tronqué en silence dans le champ.
    await expect(zone(page)).toHaveValue(long);
    await expect(page.locator('p', { hasText: /^\d+ caractères/ })).toContainText('1700 caractères · 12 SMS');
    await page.screenshot({ path: `${CAPTURES}/msg-001-trop-long.png` });
    // L'éditeur plein écran plafonne ce champ à 1 600 (automationCatalogue.ts) : ici aussi, un refus clair est attendu.
    await expect.soft(page.getByText(/1 ?600|trop long/i)).toBeVisible({ timeout: 3_000 });
    await expect.soft(enregistrer(page)).toBeDisabled({ timeout: 3_000 });
    expect(await corpsSms(bureau, r.id)).toEqual([TEXTE]);
  });

  test('[MSG-001][MSG-010] un texto long (1 000 caractères) s’enregistre en entier, sans troncature', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    // « Début » (5) + espace + 989 « x » + espace + « fin. » (4) = 1 000. (La spec en écrivait 988, soit 999 : son propre compte tombait à faux.)
    const long = `Début ${'x'.repeat(989)} fin.`;
    await zone(page).fill(long);
    await enregistrer(page).click();
    await expect(page.getByText('Message enregistré')).toBeVisible();
    await expect.poll(() => corpsSms(bureau, r.id)).toEqual([long]);
    expect(long.length).toBe(1000);
  });
});

test.describe('texto — langue des messages, corbeille, autres formats', () => {
  test('[MSG-001][MSG-010] bureau qui écrit en ANGLAIS à ses clients : le champ montre et modifie le texte qui part (l’anglais) @defaut', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque, [{ type: 'send_sms', config: { body: 'Bonjour, votre rendez-vous est confirmé.', body_en: 'Hi, your appointment is confirmed.' } }]);
    try {
      await bureau.admin.from('company_settings').update({ default_language: 'en' }).eq('org_id', bureau.orgA);
      await ouvrirTexto(page, marque);
      // La liste dit bien que les messages partent en anglais.
      await page.screenshot({ path: `${CAPTURES}/msg-001-bureau-anglais-texte-francais.png`, fullPage: true });
      // Le moteur envoie `body_en` quand la langue du bureau est l'anglais (server/lib/actions/index.ts:187).
      await expect.soft(zone(page)).toHaveValue('Hi, your appointment is confirmed.');
      await zone(page).fill('Hi, see you tomorrow.');
      await enregistrer(page).click();
      await expect(page.getByText('Message enregistré')).toBeVisible();
      await expect.poll(async () => (await lireRegle(bureau, r.id))?.actions?.[0].config.body_en).toBe('Hi, see you tomorrow.');
    } finally {
      await remettreReglagesBureau(bureau);
    }
  });

  test('[MSG-001] dans la corbeille, le texto d’une automatisation supprimée n’est pas modifiable @defaut', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque, undefined, { deleted_at: new Date().toISOString() });
    await page.goto('/automations?onglet=corbeille');
    await expect(page.getByRole('heading', { name: 'Mes automatisations' })).toBeVisible({ timeout: 90_000 });
    await deplierMessages(page, marque);
    await expect(zone(page)).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-001-corbeille-modifiable.png`, fullPage: true });
    const modifiable = await zone(page).isEditable();
    if (modifiable) {
      await zone(page).fill('Texte modifié depuis la corbeille');
      if (await enregistrer(page).isEnabled()) await enregistrer(page).click();
    }
    // Une automatisation supprimée ne se modifie pas : il faut d'abord la restaurer.
    await expect.poll(() => corpsSms(bureau, r.id)).toEqual([TEXTE]);
    expect(modifiable, 'le champ du texto est modifiable dans la corbeille').toBe(false);
  });

  test('[MSG-001][MSG-012] l’aperçu des messages montre les variables de la même façon pour un parcours à étapes et pour une automatisation simple', async ({ page, bureau, marque }) => {
    // Constat reçu de la tournée f1 (point 1) et piste S-47.
    await creerRegle(bureau, bureau.orgA, {
      name: `${marque} parcours`,
      steps: [
        { id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour [client_first_name], merci!' } }, suivant: 'e2' },
        { id: 'e2', type: 'action', action: { type: 'send_email', config: { subject: 'Merci [client_first_name]', body: '<div><h2>Bonjour [client_first_name],</h2><p>Merci!</p></div>' } }, suivant: null },
      ],
    });
    await ouvrirListe(page);
    await deplierMessages(page, marque);
    await expect(page.getByText('Texto envoyé au client')).toBeVisible();
    await expect(page.getByText('Courriel envoyé au client')).toBeVisible();
    await page.screenshot({ path: `${CAPTURES}/msg-apercu-parcours-variables-brutes.png`, fullPage: true });
    // L'automatisation simple montre « Bonjour Marie » ; le parcours doit faire pareil (ou les deux le crochet).
    // `exact` : le courriel du même parcours dit « Bonjour Marie, Merci! » (objet + titre), et la recherche de texte ignore la casse.
    await expect.soft(page.getByText('Bonjour Marie, merci!', { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('[client_first_name]')).toHaveCount(0);
  });

  test('[MSG-001] vocabulaire : le même message ne s’appelle pas « SMS » ici et « Texto » ailleurs sur la même page', async ({ page, bureau, marque }) => {
    await regleTexto(bureau, marque);
    await ouvrirTexto(page, marque);
    // Le bandeau de la page dit « étapes texto », l'aperçu des parcours « Texto envoyé au client ».
    await expect(page.getByText('Texto envoyé au client', { exact: true })).toBeVisible({ timeout: 3_000 });
  });
});

test.describe('texto — anglais', () => {
  test.use({ langue: 'en' });

  test('[MSG-001][MSG-002][MSG-010][MSG-011] tous les libellés du bloc sont en anglais', async ({ page, bureau, marque }) => {
    const r = await regleTexto(bureau, marque);
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await deplierMessages(page, marque);
    await expect(page.getByText('Text sent to client', { exact: true })).toBeVisible();
    await expect(page.getByText(`${TEXTE.length} characters`)).toBeVisible();
    await expect(page.getByText('The client will read:')).toBeVisible();
    await expect(page.getByText('Insert:')).toBeVisible();
    for (const libelle of ['Client first name', 'Full name', 'Your company', 'Invoice #', 'Amount', 'Quote #', 'Appointment date', 'Appointment time']) {
      await expect(page.getByRole('button', { name: libelle, exact: true })).toBeVisible();
    }
    await zone(page).fill('');
    await expect(page.getByText('The message cannot be empty.')).toBeVisible();
    await zone(page).fill('Hello [prenom] ê');
    await expect(page.getByText('Unknown variable: [prenom] — will be empty in the sent message.')).toBeVisible();
    // Depuis #840 le libellé des SMS n'apparaît qu'à partir de DEUX SMS (src/lib/smsSegments.ts).
    await expect(page.locator('p', { hasText: /^\d+ characters/ })).toHaveText('16 characters');
    await zone(page).fill(`Hello [prenom] ê ${'a'.repeat(54)}`);
    await expect(page.locator('p', { hasText: /^\d+ characters/ })).toHaveText('71 characters · 2 SMS (special accent or emoji: 67 characters per SMS)');
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    await zone(page).fill('Hello there.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Message saved')).toBeVisible();
    await expect.poll(() => corpsSms(bureau, r.id)).toEqual(['Hello there.']);
  });

  test('[MSG-004][MSG-008] en anglais, les exemples de « The client will read » sont en anglais @defaut', async ({ page, bureau, marque }) => {
    await regleTexto(bureau, marque, [{ type: 'send_sms', config: { body: 'See you on [appointment_date] at [appointment_time] — [company_name]' } }]);
    await page.goto('/automations');
    await expect(page.getByRole('heading', { name: 'Workflows list' })).toBeVisible({ timeout: 90_000 });
    await deplierMessages(page, marque);
    await page.screenshot({ path: `${CAPTURES}/msg-exemples-francais-en-anglais.png`, fullPage: true });
    await expect(lu(page)).not.toContainText('Votre entreprise');
    await expect(lu(page)).not.toContainText('août');
    await expect(lu(page)).not.toContainText('9 h 00');
  });
});
